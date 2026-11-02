"""Daily absence register and coverage using the approved standby order."""
import copy, datetime, uuid, html, subprocess, os, base64
from pathlib import Path
from functools import lru_cache
from collections import defaultdict
from standby import context, signature
WEEK=['الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت','الأحد']

@lru_cache(maxsize=1)
def ministry_logo_data_uri():
    """Embed the logo so Chromium can render it in both HTTP preview and PDF files."""
    logo=Path(__file__).parent/'web'/'assets'/'moe-logo-white.png'
    try:
        return 'data:image/png;base64,'+base64.b64encode(logo.read_bytes()).decode('ascii')
    except OSError:
        return ''

@lru_cache(maxsize=512)
def hijri_date(date_text):
    """Convert the selected civil date without depending on Windows tools."""
    date=datetime.date.fromisoformat(date_text)
    try:
        from hijridate import Gregorian
        hijri=Gregorian(date.year,date.month,date.day).to_hijri()
        value=f'{hijri.day:02d}/{hijri.month:02d}/{hijri.year:04d}'
    except Exception:
        # Kept only for local development environments that have not installed
        # dependencies yet. The hosted service uses hijridate above.
        if os.name=='nt':
            command=(f'$d=[datetime]::new({date.year},{date.month},{date.day}); '
                     '$c=[System.Globalization.UmAlQuraCalendar]::new(); '
                     "'{0:00}/{1:00}/{2:0000}' -f $c.GetDayOfMonth($d),$c.GetMonth($d),$c.GetYear($d)")
            result=subprocess.run(['powershell.exe','-NoProfile','-NonInteractive','-Command',command],capture_output=True,text=True,check=True,timeout=10)
            value=result.stdout.strip()
        else:
            value=date.isoformat()
    return value.translate(str.maketrans('0123456789','٠١٢٣٤٥٦٧٨٩'))

def _standby_rank_key(value):
    try:
        return (0, int(value))
    except (TypeError, ValueError):
        return (1, 9999)


def _whole_number(value, fallback=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _is_emergency_assignment(assignment):
    return bool(assignment.get('emergency')) or assignment.get('rank')=='طوارئ'


def _discard_legacy_emergency_assignments(standby):
    """Emergency cover belongs to an absence record, never the weekly standby plan."""
    assignments=standby.get('assignments',[])
    normal=[item for item in assignments if not _is_emergency_assignment(item)]
    if len(normal)!=len(assignments):
        standby['assignments']=normal


def _weekly_coverage_counts(project, date_text, ignored_record_id=None):
    """Count actual absence coverages in the selected week, not planned standby slots."""
    reference=datetime.date.fromisoformat(date_text)
    week=reference.isocalendar()[:2]
    all_coverages=defaultdict(int)
    emergency_coverages=defaultdict(int)
    for record in project.get('absenceRecords',[]):
        if ignored_record_id and str(record.get('id'))==str(ignored_record_id):
            continue
        try:
            if datetime.date.fromisoformat(record.get('date','')).isocalendar()[:2]!=week:
                continue
        except (TypeError, ValueError):
            continue
        for entry in record.get('entries',[]):
            teacher_id=entry.get('replacementId')
            if teacher_id is None or str(teacher_id).strip() in ('', 'None', 'null'):
                continue
            all_coverages[teacher_id]+=1
            if entry.get('rank')=='طوارئ' or entry.get('rankLabel')=='طوارئ':
                emergency_coverages[teacher_id]+=1
    return all_coverages,emergency_coverages


def _emergency_choice(project, slot, absent, used, busy, teachers, standby, date_text, ignored_record_id=None):
    """Pick the fairest safe emergency cover and explain the decision."""
    day = project['slots'][slot]['day']
    same_day_covered = {teacher_id for teacher_id, used_slot in used if project['slots'][used_slot]['day'] == day}
    exclusions = set(standby.get('config', {}).get('excluded', []))
    all_coverages,emergency_coverages=_weekly_coverage_counts(project,date_text,ignored_record_id)
    candidates=[]
    for teacher in project['teachers']:
        teacher_id = teacher['id']
        if teacher_id in absent or teacher_id in exclusions:
            continue
        if (teacher_id, slot) in used:
            continue
        if slot in busy[teacher_id] or slot in teacher.get('blocked', []):
            continue
        if teacher_id in same_day_covered:
            continue
        if any(not _is_emergency_assignment(item) and item.get('teacherId') == teacher_id and project['slots'][item.get('slot')]['day'] == day for item in standby.get('assignments', [])):
            continue
        same_day_busy_slots=[other_slot for other_slot in busy[teacher_id] if project['slots'][other_slot]['day']==day]
        same_day_load=len(same_day_busy_slots)
        distance=min((abs(project['slots'][slot]['period']-project['slots'][other_slot]['period']) for other_slot in same_day_busy_slots), default=999)
        weekly_load=len(busy[teacher_id])+all_coverages[teacher_id]
        target=max(1,_whole_number(teacher.get('max'),weekly_load or 1))
        ratio=weekly_load/target
        candidates.append({'teacherId':teacher_id,'weeklyLoad':weekly_load,'target':target,
                           'ratio':ratio,'emergencies':emergency_coverages[teacher_id],
                           'sameDayLoad':same_day_load,'distance':distance})
    if not candidates:
        return None
    choice=min(candidates,key=lambda item:(item['ratio'],item['weeklyLoad'],item['emergencies'],item['sameDayLoad'],item['distance'],teachers[item['teacherId']]['name']))
    percentage=round(choice['ratio']*100)
    choice['note']=(f"تم تكليف معلم طوارئ وفق الموازنة العادلة: متاح في الحصة، "
                    f"نصابه الحالي {choice['weeklyLoad']} من {choice['target']} ({percentage}٪)، "
                    f"وتكليفات الطوارئ هذا الأسبوع {choice['emergencies']}، "
                    f"وحصصه اليوم {choice['sameDayLoad']}.")
    return choice


def distribute(project, date_text, selected, existing=None):
    date=datetime.date.fromisoformat(date_text)
    day_name=WEEK[date.weekday()]
    day=next((i for i,d in enumerate(project['days']) if d['name']==day_name),None)
    if day is None: raise ValueError('التاريخ المختار ليس من أيام الدراسة في الجدول.')
    teachers={t['id']:t for t in project['teachers']}
    if not selected or any(t not in teachers for t in selected): raise ValueError('اختر معلمًا واحدًا على الأقل من القائمة.')
    standby=project.get('standby',{})
    if not standby.get('assignments'): raise ValueError('أنشئ جدول المنتظرين واعتمده قبل تأكيد الغياب.')
    _discard_legacy_emergency_assignments(standby)
    # Older complete imports preserved the assignments but predated the local
    # approval fingerprint.  Seal that imported order once, instead of forcing
    # the school to regenerate and lose the source-system priorities.
    if standby.get('importedFromSmartTable'):
        # الاستيراد الكامل من «الجدول الذكي» يتضمن ترتيب المنتظرين المعتمد.
        # قد تضيف النسخة المدمجة بيانات وصفية للفصل بعد الحفظ؛ لا ينبغي أن
        # يحجب ذلك الغياب ما دام كل صف انتظار ما زال يشير إلى معلم وحصة صحيحين.
        valid_teachers=set(teachers)
        valid_slots=set(range(len(project.get('slots',[]))))
        imported_rows=standby.get('assignments',[])
        if not imported_rows or any(row.get('teacherId') not in valid_teachers or row.get('slot') not in valid_slots for row in imported_rows):
            raise ValueError('بيانات جدول المنتظرين المستورد غير مكتملة. أعد استيراد الجدول الكامل من الجدول الذكي.')
        standby['signature']=signature(project)
    if standby.get('signature')!=signature(project): raise ValueError('تغيّر الجدول الدراسي. أعد إنشاء جدول الانتظار واعتماده أولًا.')
    absent=set(selected)|set((existing or {}).get('teacherIds',[]))
    absent &= teachers.keys()
    busy,_=context(project);courses={c['id']:c for c in project['courses']};classes={c['id']:c for c in project['classes']}
    used=set();entries=[]
    positions=sorted(project['placements'],key=lambda v:(v['slot'],v['courseId']))
    for pos in positions:
        slot=pos['slot'];timing=project['slots'][slot];course=courses[pos['courseId']]
        if timing['day']!=day or course['teacherId'] not in absent: continue
        candidates=sorted((a for a in standby['assignments'] if a['slot']==slot and not _is_emergency_assignment(a)),key=lambda a:_standby_rank_key(a.get('rank')))
        chosen=next((a for a in candidates if a['teacherId'] in teachers and a['teacherId'] not in absent and (a['teacherId'],slot) not in used and slot not in busy[a['teacherId']] and slot not in teachers[a['teacherId']].get('blocked',[]) and a['teacherId'] not in standby.get('config',{}).get('excluded',[])),None)
        emergency_note=''
        if not chosen:
            emergency=_emergency_choice(project, slot, absent, used, busy, teachers, standby, date_text,
                                        (existing or {}).get('id'))
            if emergency is not None:
                chosen={'teacherId': emergency['teacherId'], 'slot': slot, 'rank': 'طوارئ', 'emergency': True}
                emergency_note=emergency['note']
        if chosen: used.add((chosen['teacherId'],slot))
        replacement = chosen['teacherId'] if chosen else None
        replacement_name = teachers[replacement]['name'] if replacement is not None else ''
        rank = chosen['rank'] if chosen else None
        rank_label = 'طوارئ' if chosen and chosen.get('emergency') else None
        entries.append({'absentId':course['teacherId'],'absentName':teachers[course['teacherId']]['name'],'courseId':course['id'],'slot':slot,'period':timing['period']+1,'start':timing.get('start',''),'end':timing.get('end',''),'className':classes.get(course['classId'],{}).get('name',''),'subject':course['subject'],'replacementId':replacement,'replacementName':replacement_name, 'rank':rank,'rankLabel':rank_label,'execution':'','notes': emergency_note or ('' if chosen else 'لم يتوفر منتظر صالح لهذه الحصة؛ يلزم تكليف يدوي.')})
    now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    return {'id':(existing or {}).get('id',uuid.uuid4().hex),'date':date_text,'day':day_name,'teacherIds':sorted(absent,key=lambda t:teachers[t]['name']),'teachers':[{'id':t,'name':teachers[t]['name']} for t in sorted(absent,key=lambda t:teachers[t]['name'])], 'entries':entries,'createdAt':(existing or {}).get('createdAt',now),'updatedAt':now}

def cancel_absence(project, date_text, teacher_ids):
    if not date_text:
        raise ValueError('حدد التاريخ الذي تريد إلغاء غيابه.')
    if not teacher_ids:
        raise ValueError('اختر معلمًا واحدًا على الأقل لإلغاء غيابه.')
    records=project.get('absenceRecords',[])
    record=next((item for item in records if item.get('date')==date_text),None)
    if record is None:
        raise ValueError('لا يوجد سجل غياب لهذا التاريخ.')
    target_ids={str(teacher_id) for teacher_id in teacher_ids}
    present_ids={str(teacher['id']) for teacher in record.get('teachers',[])}
    if not target_ids.intersection(present_ids):
        raise ValueError('لم يتم العثور على هذا المعلم في سجل الغياب لهذا اليوم.')
    updated=copy.deepcopy(record)
    updated['teacherIds']=[teacher_id for teacher_id in updated.get('teacherIds',[]) if str(teacher_id) not in target_ids]
    updated['teachers']=[teacher for teacher in updated.get('teachers',[]) if str(teacher['id']) not in target_ids]
    updated['entries']=[entry for entry in updated.get('entries',[]) if str(entry.get('absentId')) not in target_ids]
    updated['updatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    next_project=copy.deepcopy(project)
    # Legacy versions saved emergency cover in the permanent standby table.
    # Clean it whenever an absence is cancelled, including when this was the
    # final absence for the selected day.
    _discard_legacy_emergency_assignments(next_project.setdefault('standby',{}))
    if updated['teacherIds']:
        next_project['absenceRecords']=[item for item in records if item.get('date')!=date_text]+[updated]
        return next_project, updated
    next_project['absenceRecords']=[item for item in records if item.get('date')!=date_text]
    return next_project, None

def reconcile_missing_emergency_assignments(project, record):
    if not record or not record.get('entries'):
        return record
    if not project:
        return record
    standby=project.get('standby',{})
    _discard_legacy_emergency_assignments(standby)
    teachers={t['id']:t for t in project.get('teachers',[])}
    if not teachers:
        return record
    busy,_=context(project)
    absent=set(str(t) for t in record.get('teacherIds',[]))
    used=set()
    for entry in record.get('entries',[]):
        replacement_id=entry.get('replacementId')
        if replacement_id is None or str(replacement_id).strip() in ('', 'None', 'null'):
            continue
        used.add((str(replacement_id), int(entry.get('slot'))))
    updated=copy.deepcopy(record)
    changed=False
    for entry in updated.get('entries',[]):
        replacement_id=entry.get('replacementId')
        replacement_name=entry.get('replacementName')
        if replacement_id is not None and str(replacement_id).strip() not in ('', 'None', 'null'):
            continue
        if replacement_name and str(replacement_name).strip():
            # Existing record may still carry a stale blank ID but a valid name;
            # treat it as already covered and keep the assignment intact.
            continue
        slot=int(entry.get('slot'))
        emergency=_emergency_choice(project, slot, absent, used, busy, teachers, standby,
                                    record.get('date',''),record.get('id'))
        if emergency is None:
            continue
        emergency_id=emergency['teacherId']
        if (str(emergency_id), slot) in used:
            continue
        entry['replacementId']=emergency_id
        entry['replacementName']=teachers[emergency_id]['name']
        entry['rank']='طوارئ'
        entry['rankLabel']='طوارئ'
        entry['notes']=emergency['note']
        entry['execution']=''
        used.add((str(emergency_id), slot))
        changed=True
    if changed:
        updated['updatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
    return updated

def _legacy_official_html(project,record):
    record=reconcile_missing_emergency_assignments(project, record)
    h=lambda value:html.escape(str(value or ''))
    school=project.get('school',{});sections=[]
    administration=h(school.get('educationAdministration') or '')
    office=h(school.get('educationOffice') or '')
    school_name=h(school.get('name') or 'اسم المدرسة')
    administration_line=f'الإدارة العامة للتعليم بمنطقة {administration}' if administration else 'الإدارة العامة للتعليم بمنطقة'
    office_line=f'مكتب التعليم {office}' if office else 'مكتب التعليم'
    identity_header=f'''<div class="identityTopBand"></div><header class="identityHeader"><div class="ministryBrand"><img class="ministryLogo" src="{ministry_logo_data_uri()}" alt="وزارة التعليم"></div><div class="identityDetails"><b>{administration_line}</b><span>{office_line}</span></div></header><div class="schoolNamePlate">مدرسة {school_name}</div>'''
    for teacher in record['teachers']:
        entries=sorted((e for e in record['entries'] if e['absentId']==teacher['id']),key=lambda e:e['period'])
        rows=[]
        for e in entries:
            replacement=h(e['replacementName']) or 'لم يُكلّف منتظر'
            if e['rank']: replacement+=f'<small>ترتيبه في الانتظار: {e["rank"]}</small>'
            signature=str(e.get('signature',''))
            signed=f'<img class="signatureImage" src="{signature}" alt="توقيع المعلم">' if signature.startswith('data:image/png;base64,') else ''
            rows.append(f'<tr><td>{e["period"]}<small dir="ltr">{h(e["start"])}<br>{h(e["end"])}</small></td><td>{h(e["className"])}</td><td>{h(e["subject"])}</td><td>{replacement}</td><td>{h(e.get("execution"))}</td><td>{signed}</td><td>{h(e.get("notes"))}</td></tr>')
        if not rows: rows=['<tr><td colspan="7">لا توجد حصص تدريسية للمعلم في هذا اليوم.</td></tr>']
        row_height=min(10,125/max(1,len(entries)))
        cell_font=8 if len(entries)>8 else 9
        sections.append(f'<section class="officialSheet" style="--row-height:{row_height}mm;--cell-font:{cell_font}pt;--cell-padding:{0.7 if len(entries)>8 else 0.8}mm;--small-font:{7 if len(entries)>8 else 7.5}pt;--small-line:{1.15 if len(entries)>8 else 1.2}">{identity_header if not sections else ""}<div class="formTitle"><b>نموذج رقم (٧)</b><h1>سجل توزيع حصص الانتظار</h1><span>رمز النموذج: (و.ت.ع.ن-٠١-٠١)</span></div><div class="schoolMeta">العام الدراسي: {h(school.get("year"))} هـ &nbsp; الفصل الدراسي: {h(school.get("term"))} &nbsp; المرحلة: {h(school.get("stage"))}</div><p class="absentLine">زملائي المعلمين / نظرًا لغياب الزميل: <strong>{h(teacher["name"])}</strong></p><p>لهذا اليوم <b>{h(record["day"])}</b> الموافق <b class="hijriDate" dir="rtl"><span>{h(hijri_date(record["date"])).replace("/", "</span><span aria-hidden=\"true\"> / </span><span>")}</span></b> هـ، آمل تسديد مكانه حسب الجدول الموضح والتوقيع بالعلم، ولكم جزيل الشكر.</p><table><colgroup><col style="width:9%"><col style="width:10%"><col style="width:14%"><col style="width:23%"><col style="width:19%"><col style="width:10%"><col style="width:15%"></colgroup><thead><tr><th>الحصة</th><th>الفصل</th><th>المادة</th><th>اسم المعلم المنتظر</th><th>ما تم تنفيذه في حصة الانتظار</th><th>التوقيع</th><th>ملحوظات</th></tr></thead><tbody>{"".join(rows)}</tbody></table></section>')
    return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل توزيع حصص الانتظار</title><style>'+OFFICIAL_CSS+'</style></head><body><footer class="pageFooter"><span>وكيل الشؤون التعليمية: ........................</span><span>التوقيع: ........................</span></footer>'+''.join(sections)+'</body></html>'

def official_html(project, record):
    """Render one compact register: pack complete teacher blocks onto each page."""
    record = reconcile_missing_emergency_assignments(project, record)
    h = lambda value: html.escape(str(value or ''))
    school = project.get('school', {})
    administration = h(school.get('educationAdministration') or '')
    office = h(school.get('educationOffice') or '')
    school_name = h(school.get('name') or 'اسم المدرسة')
    administration_line = f'الإدارة العامة للتعليم بمنطقة {administration}' if administration else 'الإدارة العامة للتعليم بمنطقة'
    office_line = f'مكتب التعليم {office}' if office else 'مكتب التعليم'
    report_header = f'''<div class="identityTopBand"></div><header class="identityHeader"><div class="ministryBrand"><img class="ministryLogo" src="{ministry_logo_data_uri()}" alt="وزارة التعليم"></div><div class="identityDetails"><b>{administration_line}</b><span>{office_line}</span></div></header><div class="schoolNamePlate">مدرسة {school_name}</div><div class="formTitle"><b>نموذج رقم (٧)</b><h1>سجل توزيع حصص الانتظار</h1><span>رمز النموذج: (و.ت.ع.ن-٠١-٠١)</span></div><div class="schoolMeta">العام الدراسي: {h(school.get("year"))} هـ &nbsp; الفصل الدراسي: {h(school.get("term"))} &nbsp; المرحلة: {h(school.get("stage"))}</div>'''
    sections = []
    for teacher in record.get('teachers', []):
        entries = sorted((entry for entry in record.get('entries', []) if entry.get('absentId') == teacher.get('id')), key=lambda entry: entry.get('period', 0))
        rows = []
        for entry in entries:
            replacement = h(entry.get('replacementName')) or 'لم يُكلّف منتظر'
            if entry.get('rank'):
                replacement += f'<small>ترتيبه في الانتظار: {h(entry.get("rank"))}</small>'
            signature = str(entry.get('signature', ''))
            signed = f'<img class="signatureImage" src="{signature}" alt="توقيع المعلم">' if signature.startswith('data:image/png;base64,') else ''
            rows.append(f'<tr><td>{h(entry.get("period"))}<small dir="ltr">{h(entry.get("start"))}<br>{h(entry.get("end"))}</small></td><td>{h(entry.get("className"))}</td><td>{h(entry.get("subject"))}</td><td>{replacement}</td><td>{h(entry.get("execution"))}</td><td>{signed}</td><td>{h(entry.get("notes"))}</td></tr>')
        if not rows:
            rows = ['<tr><td colspan="7">لا توجد حصص تدريسية للمعلم في هذا اليوم.</td></tr>']
        row_height = min(9, 105 / max(1, len(entries)))
        cell_font = 7.7 if len(entries) > 6 else 8.3
        hijri = h(hijri_date(record.get('date', ''))).replace('/', '</span><span aria-hidden="true"> / </span><span>')
        sections.append(f'''<section class="officialSheet teacherSheet" style="--row-height:{row_height}mm;--cell-font:{cell_font}pt;--cell-padding:.55mm;--small-font:6.8pt;--small-line:1.1"><p class="absentLine">زملائي المعلمين / نظرًا لغياب الزميل: <strong>{h(teacher.get("name"))}</strong></p><p class="coverageLine">لهذا اليوم <b>{h(record.get("day"))}</b> الموافق <b class="hijriDate" dir="rtl"><span>{hijri}</span></b> هـ، آمل تسديد مكانه حسب الجدول الموضح والتوقيع بالعلم، ولكم جزيل الشكر.</p><table><colgroup><col style="width:9%"><col style="width:10%"><col style="width:14%"><col style="width:23%"><col style="width:19%"><col style="width:10%"><col style="width:15%"></colgroup><thead><tr><th>الحصة</th><th>الفصل</th><th>المادة</th><th>اسم المعلم المنتظر</th><th>ما تم تنفيذه في حصة الانتظار</th><th>التوقيع</th><th>ملحوظات</th></tr></thead><tbody>{''.join(rows)}</tbody></table></section>''')
    return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل توزيع حصص الانتظار</title><style>' + OFFICIAL_CSS + '</style></head><body><main class="officialRegister">' + report_header + ''.join(sections) + '</main><footer class="pageFooter"><span>وكيل الشؤون التعليمية: ........................</span><span>التوقيع: ........................</span></footer></body></html>'

OFFICIAL_CSS="""
.signatureImage{display:block;width:100%;max-height:14mm;object-fit:contain}
.hijriDate{display:inline-flex;direction:rtl;unicode-bidi:isolate;align-items:baseline;gap:.12em}.hijriDate>span{display:inline-block}
@page{size:A4 portrait;margin:10mm 10mm 22mm}*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:Tahoma,Arial,sans-serif;color:#003b49;background:#fff;font-size:9.5pt;line-height:1.4}.identityTopBand{height:4mm;margin:-10mm -10mm 0;background:linear-gradient(90deg,#218bc1 0%,#17a593 60%,#45b86c 100%)}.identityHeader{min-height:36mm;margin:0 -10mm;padding:6mm 15mm 7mm;background:#003b49;color:#fff;border-radius:0 0 13mm 13mm;display:flex;align-items:center;justify-content:space-between;gap:8mm;direction:rtl}.ministryBrand{display:flex;align-items:center;gap:3mm;direction:rtl;min-width:45mm;border-left:.6mm solid #16ab92;padding-left:5mm}.ministryBrand b{display:block;font-size:16pt;line-height:1.05}.ministryBrand small{display:block;font-family:Arial,sans-serif;font-size:6.5pt;letter-spacing:.04em;margin-top:1mm}.ministryDots{width:21mm;display:grid;grid-template-columns:repeat(4,3.2mm);gap:1.3mm;direction:ltr}.ministryDots i{display:block;width:3.2mm;height:3.2mm;border-radius:50%;background:#fff}.ministryDots i:nth-child(4n+1){transform:translateY(1.2mm)}.identityDetails{text-align:center;flex:1;line-height:1.35}.identityDetails b{display:block;font-size:13pt;font-weight:700}.identityDetails span{display:block;font-size:11pt;color:#19b4a1;margin-top:1.5mm}.schoolNamePlate{position:relative;z-index:1;width:52%;min-height:13mm;margin:-6mm auto 2mm;padding:2.3mm 5mm;border:.5mm solid #169b82;border-radius:0 0 5mm 5mm;background:#003b49;color:#fff;text-align:center;font-weight:700;font-size:13pt}.formTitle{margin-top:3mm;text-align:center;background:#e7f1eb;border-top:.4mm solid #1aa68d;padding:2mm}.formTitle h1{font-size:14pt;margin:1mm}.formTitle span,.schoolMeta{font-size:8.5pt}.schoolMeta{padding:2mm 0;border-bottom:1px solid #a7c3bc}.absentLine{margin-top:3mm}p{margin:2mm 0}table{border-collapse:collapse;table-layout:fixed;width:100%;margin-top:2mm}th,td{border:1px solid #64837e;text-align:center;padding:var(--cell-padding,.8mm) 1mm;overflow-wrap:anywhere;vertical-align:middle;font-size:var(--cell-font,9pt);line-height:1.3}th{background:#dceade;font-weight:bold;font-size:8.5pt}td{height:var(--row-height,10mm)}small{display:block;font-size:var(--small-font,7.5pt);line-height:var(--small-line,1.2)}.pageFooter{display:flex;justify-content:space-between;font-size:9pt;position:fixed;bottom:0;left:0;right:0;height:8mm;align-items:center;border-top:.45mm solid #1aa68d}.officialSheet{width:100%;margin-bottom:14mm;break-inside:avoid;page-break-inside:avoid;break-after:auto;page-break-after:auto}thead{display:table-header-group}tr{break-inside:avoid}@media screen{.pageFooter{position:static;max-width:190mm;margin:10px auto;padding:10px;order:2;background:white}body{display:flex;flex-direction:column;background:#edf2ef;padding:12px}.officialSheet{width:min(100%,190mm);margin:0 auto 16px;padding:5mm;background:white;box-shadow:0 2px 10px #0002}.identityTopBand{margin:-5mm -5mm 0}.identityHeader{margin:0 -5mm;padding:6mm 10mm}.schoolNamePlate{width:70%}}@media print{.officialSheet{padding:0;box-shadow:none}}
 .ministryBrand{display:flex;align-items:center;min-width:52mm;border-left:.6mm solid #16ab92;padding-left:5mm}.ministryLogo{display:block;width:47mm;height:auto}.ministryDots,.ministryBrand>b,.ministryBrand>small{display:none}.identityTopBand,.identityHeader{margin-left:0;margin-right:0}.officialSheet{overflow:hidden}.officialRegister{width:100%}.teacherSheet{margin:3mm 0 0;break-inside:avoid;page-break-inside:avoid}.teacherSheet .absentLine{margin:0 0 .7mm;font-size:8.8pt}.teacherSheet .coverageLine{margin:0 0 1mm;font-size:8pt}.teacherSheet table{margin-top:0}.teacherSheet th{font-size:7.4pt}.teacherSheet .signatureImage{max-height:8mm}.teacherSheet td{height:var(--row-height,9mm)}@media print{.teacherSheet{break-inside:avoid;page-break-inside:avoid}}
"""
