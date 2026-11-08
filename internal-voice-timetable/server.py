from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from urllib.request import Request, urlopen
from http.cookies import SimpleCookie
import copy, json, threading, uuid, os, base64, io, datetime, html, subprocess, tempfile, secrets, hmac, contextvars, time
import openpyxl
from teacher_import import teacher_preview
from teacher_contacts import contact_preview, apply_contacts
from term_workspaces import ensure as ensure_terms, refresh_active as refresh_active_term, create_next as create_term_workspace, switch as switch_term_workspace, public_list as public_term_list
import copilot_auth
import auth as sound_auth
from engine import import_workbook, import_smarttable_project, validate, solve, swap_options
from standby import generate as generate_standby, signature as standby_signature
from schedules import sync_schedule
from absence import distribute as distribute_absence, official_html as absence_html, cancel_absence as cancel_absence_record, reconcile_missing_emergency_assignments
from signature_tasks import prepare_tasks, find_task as find_signature_task, public_task as public_signature_task, submit_signature, normalize_phone

ROOT=Path(__file__).parent.resolve(); DATA=ROOT/'data'; DATA.mkdir(exist_ok=True)
SOURCE=Path.home()/'Downloads'/'الفزاري الثانوية.xlsx'
STATE=DATA/'project.json'; lock=threading.Lock(); jobs={}; swap_cache={}
COPILOT_COOKIE='nasq_copilot_session'; copilot_sessions={}; copilot_sessions_lock=threading.RLock()
AUTH_REQUIRED=os.environ.get('SOUNDTABLE_AUTH','0')=='1'; AUTH_COOKIE='soundtable_session'; request_user_id=contextvars.ContextVar('request_user_id',default=None)
HASR_EMBEDDED=os.environ.get('HASR_EMBEDDED','0')=='1'; EMBEDDED_DATA=DATA/'hasr-schools'
if HASR_EMBEDDED: EMBEDDED_DATA.mkdir(exist_ok=True)
if AUTH_REQUIRED: sound_auth.init_db()
def empty_project(revision=1):
    days=[{'name':n,'count':c} for n,c in zip(['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس'],[7,7,6,6,6])]
    def fmt(n): return f'{n//60:02}:{n%60:02}'
    slots=[{'day':d,'period':p,'start':fmt(420+p*45+(15 if p>=3 else 0)),'end':fmt(465+p*45+(15 if p>=3 else 0))} for d,v in enumerate(days) for p in range(v['count'])]
    return {'setupVersion':2,'setupStep':0,'school':{'name':'','director':'','year':'1448','stage':'ثانوي','term':'الأول','plan':''},'days':days,'slots':slots,'teachers':[],'classes':[],'courses':[],'placements':[],'referencePlacements':[],'locks':[],'revision':revision}
if not STATE.exists(): STATE.write_text(json.dumps(empty_project(),ensure_ascii=False),encoding='utf-8')
elif json.loads(STATE.read_text(encoding='utf-8')).get('setupVersion')!=2:
    backup=DATA/('legacy-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.json')
    backup.write_bytes(STATE.read_bytes())
    STATE.write_text(json.dumps(empty_project(),ensure_ascii=False),encoding='utf-8')


def embedded_state_path():
    """One private timetable file per authenticated 7asr school."""
    user_id=str(request_user_id.get() or '')
    school_id=user_id.removeprefix('hasr:')
    try: school_id=str(uuid.UUID(school_id))
    except (ValueError, AttributeError): raise PermissionError('هوية المدرسة غير صالحة.')
    return EMBEDDED_DATA/f'{school_id}.json'

def write_embedded_project(user_id, project):
    school_id=str(user_id or '').removeprefix('hasr:')
    try: school_id=str(uuid.UUID(school_id))
    except (ValueError, AttributeError): raise PermissionError('هوية المدرسة غير صالحة.')
    state=EMBEDDED_DATA/f'{school_id}.json'; temp=state.with_suffix('.tmp')
    temp.write_text(json.dumps(project,ensure_ascii=False),encoding='utf-8'); temp.replace(state)

def read():
    if HASR_EMBEDDED:
        state=embedded_state_path()
        if not state.exists(): return ensure_terms(empty_project())
        return ensure_terms(json.loads(state.read_text(encoding='utf-8')))
    user_id=request_user_id.get()
    project=sound_auth.load_project(user_id,empty_project) if user_id else json.loads(STATE.read_text(encoding='utf-8'))
    return ensure_terms(project)
def write(d):
    refresh_active_term(d)
    if HASR_EMBEDDED:
        write_embedded_project(request_user_id.get(),d); return
    user_id=request_user_id.get()
    if user_id:
        sound_auth.save_project(user_id,d)
        return
    temp=STATE.with_suffix('.tmp'); temp.write_text(json.dumps(d,ensure_ascii=False),encoding='utf-8'); temp.replace(STATE)

def sync_hasr_lesson_flow(project, date_text):
    """Publish the automatic standby layer for one school/date to HSR.

    This is intentionally available only to the embedded copy. The standalone
    product keeps its own data and never calls into نظام الحصر.
    """
    if not HASR_EMBEDDED: return
    bridge_url=os.environ.get('HASR_BRIDGE_URL','').strip()
    bridge_secret=os.environ.get('VOICE_TIMETABLE_BRIDGE_SECRET','').strip()
    school_id=str(request_user_id.get() or '').removeprefix('hasr:')
    try: school_id=str(uuid.UUID(school_id))
    except (ValueError, AttributeError): raise RuntimeError('تعذر التحقق من هوية المدرسة لمزامنة سير الحصص.')
    if not bridge_url or not bridge_secret:
        raise RuntimeError('إعداد ربط سير الحصص غير مكتمل.')
    entries=[]
    for record in project.get('absenceRecords',[]):
        if str(record.get('date',''))!=str(date_text): continue
        for entry in record.get('entries',[]):
            replacement=str(entry.get('replacementName') or '').strip()
            if not replacement: continue
            entries.append({
                'recordId':str(record.get('id','')),
                'entryKey':f"{entry.get('absentId','')}:{entry.get('slot','')}",
                'period':entry.get('period'),
                'className':entry.get('className',''),
                'subject':entry.get('subject',''),
                'absentName':entry.get('absentName',''),
                'replacementName':replacement,
            })
    payload=json.dumps({'schoolId':school_id,'date':date_text,'entries':entries},ensure_ascii=False).encode('utf-8')
    request=Request(bridge_url,data=payload,headers={
        'Content-Type':'application/json; charset=utf-8',
        'X-Voice-Bridge-Secret':bridge_secret,
    },method='POST')
    try:
        with urlopen(request,timeout=10) as response:
            if response.status!=200: raise RuntimeError(f'حالة المزامنة {response.status}')
    except Exception as error:
        raise RuntimeError('تعذر مزامنة التكليفات مع سير الحصص. لم يُحفظ تغيير الغياب.') from error

def sync_existing_embedded_coverages():
    """Restore the automatic layer after a service restart without user action."""
    if not HASR_EMBEDDED: return
    for attempt in range(4):
        try:
            for state in EMBEDDED_DATA.glob('*.json'):
                try: project=ensure_terms(json.loads(state.read_text(encoding='utf-8')))
                except (OSError,json.JSONDecodeError): continue
                token=request_user_id.set(f'hasr:{state.stem}')
                try:
                    for date_text in {str(record.get('date','')) for record in project.get('absenceRecords',[]) if record.get('date')}:
                        sync_hasr_lesson_flow(project,date_text)
                finally:
                    request_user_id.reset(token)
            return
        except Exception:
            # API and timetable containers may start in either order. Retrying
            # keeps this reconciliation invisible to the school administrator.
            time.sleep(2)

def signature_project(token):
    if HASR_EMBEDDED:
        # توقيع المعلم يفتح من جواله بلا جلسة الحصر؛ الرمز العشوائي هو التفويض.
        for state in EMBEDDED_DATA.glob('*.json'):
            try: project=ensure_terms(json.loads(state.read_text(encoding='utf-8')))
            except (OSError,json.JSONDecodeError): continue
            found=find_signature_task(project,token)
            if found: return (f'hasr:{state.stem}',project,project,found[0],project.get('activeTermId'))
        return None
    if AUTH_REQUIRED:
        return sound_auth.find_project_by_signature_token(token)
    project=read(); found=find_signature_task(project,token)
    return ('local',project,project,found[0],project.get('activeTermId')) if found else None

def write_signature_project(resolved, project):
    user_id,root,_,_,workspace_id=resolved
    if workspace_id and root.get('termWorkspaces'):
        if workspace_id==root.get('activeTermId'):
            registry=copy.deepcopy(root['termWorkspaces'])
            root=copy.deepcopy(project); root['termWorkspaces']=registry; root['activeTermId']=workspace_id; root['termVersion']=1
        else:
            root=copy.deepcopy(root)
            workspace=next((item for item in root['termWorkspaces'] if item.get('id')==workspace_id),None)
            if workspace: workspace['snapshot']=copy.deepcopy(project)
        root['revision']=root.get('revision',0)+1
        refresh_active_term(root)
        if HASR_EMBEDDED: write_embedded_project(user_id,root)
        elif AUTH_REQUIRED: sound_auth.save_project(user_id,root)
        else: write(root)
        return
    if HASR_EMBEDDED: write_embedded_project(user_id,project)
    elif AUTH_REQUIRED: sound_auth.save_project(user_id,project)
    else: write(project)

def uploaded_xlsx(encoded):
    """Decode one small browser-uploaded workbook into an auto-cleaned file."""
    try:
        payload=base64.b64decode(str(encoded), validate=True)
    except Exception as error:
        raise ValueError('تعذر قراءة ملف Excel المرفوع.') from error
    if not payload or len(payload)>3_000_000:
        raise ValueError('حجم ملف Excel يجب أن يكون بين 1 بايت و3 ميجابايت.')
    temporary=tempfile.NamedTemporaryFile(prefix='soundtable-smarttable-',suffix='.xlsx',delete=False)
    try:
        temporary.write(payload)
        return Path(temporary.name)
    finally:
        temporary.close()

def smarttable_summary(project):
    details=project.get('smartTableImport',{})
    return {
        'school': project.get('school',{}).get('name',''),
        'tableName': project.get('activeScheduleName',''),
        'teachers': details.get('teachers',len(project.get('teachers',[]))),
        'classes': details.get('classes',len(project.get('classes',[]))),
        'lessons': details.get('lessons',len(project.get('placements',[]))),
        'waitingAssignments': details.get('waitingAssignments',0),
        'skippedWaitingAssignments': details.get('skippedWaitingAssignments',0),
        'days': len(project.get('days',[])),
        'slots': len(project.get('slots',[])),
        'validationErrors': validate(project,project.get('placements',[]),manual_edit=True),
    }

PRINT_TITLES={'teachers-general':'الجدول العام حسب المعلمين','classes-general':'الجدول العام حسب الفصول','teachers-individual':'جداول المعلمين','classes-individual':'جداول الفصول'}
SUBJECT_SHORTS={'التقنية الرقمية':'رقمية','علوم الأرض والفضاء':'علم الأرض','علم الأرض والفضاء':'علم الأرض','التربية الصحية والبدنية':'بدنية','القرآن الكريم وتفسيره':'القرآن','القرآن وتفسيره':'القرآن','الكفايات اللغوية':'كفايات','التفكير الناقد':'تفكير ناقد','البحث ومصادر المعلومات':'البحث','المجال الاختياري':'اختياري','اللغة الإنجليزية':'إنجليزي'}

def h(value): return html.escape(str(value or ''))
def class_code(name):
    words=str(name or '').split()
    grades={'اول':'1','أول':'1','ثاني':'2','ثالث':'3'}
    return f"{grades.get(words[0],words[0] if words else '')}-{words[-1] if words else ''}"
def subject_short(course):
    subject=course.get('subject','')
    custom=course.get('short','')
    return (custom if custom and custom!=subject else SUBJECT_SHORTS.get(subject)) or subject
def print_grid(project, kind, owner=None):
    teachers={x['id']:x for x in project.get('teachers',[])}; classes={x['id']:x for x in project.get('classes',[])}
    courses={x['id']:x for x in project.get('courses',[])}; slots=list(enumerate(project.get('slots',[])))
    # الحصة الزمنية الواحدة تحتوي دروسًا متوازية لفصول ومعلمين مختلفين؛ لذلك
    # لا يصح فهرستها بالوقت وحده وإلا حُفظ آخر درس فقط.
    teacher_at={}; class_at={}
    for position in project.get('placements',[]):
        course=courses.get(position.get('courseId'))
        if not course: continue
        slot=position.get('slot')
        teacher_at[(course.get('teacherId'),slot)]=course
        class_at[(course.get('classId'),slot)]=course
    days=project.get('days',[])
    last_slot_by_day={day_index:max((index for index,slot in slots if slot.get('day')==day_index),default=None) for day_index in range(len(days))}
    if kind.endswith('general'):
        by_day=[]
        for day_index,day in enumerate(days):
            current=[(index,slot) for index,slot in slots if slot.get('day')==day_index]
            by_day.append((day,current))
        rows=project.get('teachers',[]) if kind=='teachers-general' else project.get('classes',[])
        header=''.join(f'<th colspan="{len(day_slots)}">{h(day.get("name"))}</th>' for day,day_slots in by_day)
        periods=''.join(f'<th class="dayEnd">{slot.get("period",0)+1}</th>' if slot_index==last_slot_by_day.get(slot.get('day')) else f'<th>{slot.get("period",0)+1}</th>' for _,day_slots in by_day for slot_index,slot in day_slots)
        body=[]
        for row in rows:
            is_teacher=kind=='teachers-general'; label=row.get('short') if is_teacher else class_code(row.get('name'))
            cells=[]
            for slot_index,slot in slots:
                course=(teacher_at if is_teacher else class_at).get((row.get('id'),slot_index))
                cell_class=' class="dayEnd"' if slot_index==last_slot_by_day.get(slot.get('day')) else ''
                if not course:
                    cells.append(f'<td{cell_class}></td>'); continue
                if is_teacher:
                    text=f'<b>{h(class_code(classes.get(course.get("classId"),{}).get("name")))}</b><small>{h(subject_short(course))}</small>'
                else:
                    text=f'<b>{h(subject_short(course))}</b><small>{h(teachers.get(course.get("teacherId"),{}).get("short"))}</small>'
                cells.append(f'<td{cell_class}>{text}</td>')
            body.append(f'<tr><th class="owner">{h(label)}</th>{"".join(cells)}</tr>')
        label='المعلم' if kind=='teachers-general' else 'الفصل'
        return f'<table class="printGrid general"><thead><tr><th class="owner" rowspan="2">{label}</th>{header}</tr><tr>{periods}</tr></thead><tbody>{"".join(body)}</tbody></table>'
    is_teacher=kind=='teachers-individual'; current=owner
    rows=[]
    max_period=max((slot.get('period',0) for _,slot in slots),default=-1)+1
    for day_index,day in enumerate(days):
        cells=[]
        for period in range(max_period):
            slot_index=next((i for i,s in slots if s.get('day')==day_index and s.get('period')==period),None)
            course=(teacher_at if is_teacher else class_at).get((current.get('id'),slot_index)) if slot_index is not None else None
            valid=bool(course)
            cell_class=' class="dayEnd"' if slot_index==last_slot_by_day.get(day_index) else ''
            if valid:
                other=classes.get(course.get('classId'),{}) if is_teacher else teachers.get(course.get('teacherId'),{})
                label=class_code(other.get('name')) if is_teacher else other.get('short')
                cells.append(f'<td{cell_class}><span class="lessonTitle">{h(subject_short(course))}</span><br><span class="lessonDetail">{h(label)}</span></td>')
            else: cells.append(f'<td{cell_class}></td>')
        rows.append(f'<tr><th>{h(day.get("name"))}</th>{"".join(cells)}</tr>')
    label=current.get('short') if is_teacher else class_code(current.get('name'))
    title=f'جدول المعلم {label}' if is_teacher else f'جدول الفصل {label}'
    headers=''.join(f'<th>{n+1}</th>' for n in range(max_period))
    return f'<section class="individual"><h2>{h(title)}</h2><table class="printGrid"><thead><tr><th>اليوم / الحصة</th>{headers}</tr></thead><tbody>{"".join(rows)}</tbody></table></section>'

def standby_print_html(project):
    standby=project.get('standby',{}); teachers={t['id']:t for t in project.get('teachers',[])}
    assignments=standby.get('assignments',[]); slots=list(enumerate(project.get('slots',[])))
    by_slot_rank={(row['slot'],row['rank']):row for row in assignments}
    ranks=max((row.get('rank',0) for row in assignments),default=1)
    groups=[]
    for day_index,day in enumerate(project.get('days',[])):
        day_slots=[(slot_index,slot) for slot_index,slot in slots if slot.get('day')==day_index]
        groups.append((day,day_slots))
    day_header=''.join(f'<th colspan="{len(day_slots)}">{h(day.get("name"))}</th>' for day,day_slots in groups)
    period_header=''.join(f'<th>{slot.get("period",0)+1}</th>' for _,day_slots in groups for _,slot in day_slots)
    rows=[]
    for rank in range(1,ranks+1):
        cells=[]
        for slot_index,_ in slots:
            assignment=by_slot_rank.get((slot_index,rank))
            cells.append(f'<td>{h(teachers.get(assignment.get("teacherId"),{}).get("name")) if assignment else "—"}</td>')
        rows.append(f'<tr><th>{rank}</th>{"".join(cells)}</tr>')
    school=h(project.get('school',{}).get('name') or 'المدرسة'); director=h(project.get('school',{}).get('director') or 'غير محدد')
    return f'''<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>جدول المنتظرين</title><style>
@page{{size:A3 landscape;margin:6mm}}*{{box-sizing:border-box}}body{{font-family:Tahoma,Arial,sans-serif;color:#173e37;margin:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}}h1{{text-align:center;font-size:15pt;margin:0 0 2mm}}p{{text-align:center;font-size:8pt;margin:0 0 3mm}}table{{border-collapse:collapse;table-layout:fixed;width:100%}}th,td{{border:.18mm solid #718e84;text-align:center;padding:.7mm .25mm;overflow-wrap:anywhere;font-size:5.5pt;line-height:1.18;height:9mm}}th{{background:#e5f2ec;font-weight:bold;font-size:6.2pt}}.rank{{width:12mm}}footer{{margin-top:3mm;font-size:8pt;display:flex;justify-content:space-between}}</style><body><h1>جدول المنتظرين الأسبوعي</h1><p>{school} — جميع الأيام في نموذج واحد</p><table><thead><tr><th class="rank" rowspan="2">ترتيب الانتظار</th>{day_header}</tr><tr>{period_header}</tr></thead><tbody>{''.join(rows)}</tbody></table><footer><span>مدير المدرسة: {director}</span><span>تاريخ الطباعة: {datetime.datetime.now().strftime('%d/%m/%Y')}</span></footer></body></html>'''

def make_print_html(project, kind, paper):
    if kind=='absence': return absence_html(project,project['absencePrintRecord'])
    if kind=='standby': return standby_print_html(project)
    title=PRINT_TITLES[kind]; is_a3=paper=='a3'; size='420mm 297mm' if is_a3 else '297mm 210mm'
    school=h(project.get('school',{}).get('name') or 'المدرسة'); term=h(project.get('school',{}).get('term') or '')
    body=print_grid(project,kind) if kind.endswith('general') else ''.join(print_grid(project,kind,x) for x in (project.get('teachers',[]) if kind=='teachers-individual' else project.get('classes',[])))
    director=h(project.get('school',{}).get('director') or 'غير محدد')
    created=datetime.datetime.now().strftime('%d/%m/%Y')
    footer=f'<footer class="printFooter"><span>مدير المدرسة: <b>{director}</b></span><span>تاريخ إنشاء الجدول: <b>{created}</b></span></footer>'
    font='5.7pt' if is_a3 else '4.25pt'
    return f'''<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@page{{size:{size};margin:4mm}} *{{box-sizing:border-box}} html,body{{margin:0;padding:0;color:#102c37;font-family:Arial,"Tahoma",sans-serif;print-color-adjust:exact;-webkit-print-color-adjust:exact}} h1{{font-size:12pt;text-align:center;margin:0 0 1mm}} .meta{{text-align:center;font-size:7pt;margin-bottom:2mm}} table{{border-collapse:collapse;table-layout:fixed;width:100%}} th,td{{border:.18mm solid #59787a;text-align:center;vertical-align:middle;height:5.8mm;padding:.3mm;font-size:{font};overflow:hidden}} th{{background:#dceeea;font-weight:700}} .dayEnd{{background:#f0f2f3!important}} td b,td small{{display:block;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:clip}} td small{{font-size:.88em;color:#375861;margin-top:.25mm}} .lessonTitle{{font-weight:700;color:#102c37;line-height:1.15}} .lessonDetail{{font-size:7pt;color:#375861;line-height:1.15}} .owner{{width:17mm;white-space:nowrap}} .general th{{height:5mm}} .printFooter{{display:flex;justify-content:space-between;direction:rtl;margin-top:3mm;padding-top:1.5mm;border-top:.18mm solid #59787a;font-size:7pt}} .printFooter b{{font-weight:700}} .individual{{break-after:page;page-break-after:always}} .individual:last-child{{break-after:auto;page-break-after:auto}} .individual h2{{font-size:12pt;text-align:center;margin:0 0 3mm}} .individual td,.individual th{{height:18mm;font-size:8.5pt}} </style></head><body><h1>{h(title)}</h1><div class="meta">{school} — الفصل الدراسي {term}</div>{body}{footer}</body></html>'''

def render_pdf(project, kind, paper):
    candidates=[
        os.environ.get('CHROME_BIN',''),
        str(Path(os.environ.get('PROGRAMFILES',r'C:\\Program Files'))/'Google/Chrome/Application/chrome.exe'),
        r'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    ]
    chrome=next((Path(value) for value in candidates if value and Path(value).exists()),None)
    if chrome is None: raise RuntimeError('chrome')
    with tempfile.TemporaryDirectory(prefix='nasq-print-') as folder:
        folder=Path(folder); source=folder/'print.html'; target=folder/'print.pdf'
        source.write_text(make_print_html(project,kind,paper),encoding='utf-8')
        result=subprocess.run([str(chrome),'--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-pdf-header-footer',f'--print-to-pdf={target}',source.as_uri()],capture_output=True,timeout=45)
        if result.returncode or not target.exists() or target.stat().st_size<1000: raise RuntimeError('pdf')
        return target.read_bytes()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT/'web'),**kwargs)
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def reply(self,obj,status=200,headers=None):
        body=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(status); self.send_header('Content-Type','application/json; charset=utf-8'); self.send_header('Cache-Control','no-store')
        for name,value in (headers or {}).items(): self.send_header(name,value)
        self.end_headers(); self.wfile.write(body)
    def auth_token(self):
        cookies=SimpleCookie(); cookies.load(self.headers.get('Cookie',''))
        morsel=cookies.get(AUTH_COOKIE)
        return morsel.value if morsel else None
    def auth_user(self):
        # The embedded edition is reachable only through the parent application's
        # authenticated reverse proxy.  Its school id becomes the tenant key.
        if os.environ.get('HASR_EMBEDDED')=='1':
            school_id=self.headers.get('X-Voice-School-Id','').strip()
            if len(school_id)==36: return {'id':f'hasr:{school_id}','email':'','verified':True}
            return None
        return sound_auth.session_user(self.auth_token()) if AUTH_REQUIRED else {'id':'local','email':'local','verified':True}
    def auth_cookie(self,token,max_age=2592000):
        secure='; Secure' if os.environ.get('SOUNDTABLE_PUBLIC_URL','').startswith('https://') or os.environ.get('SOUNDTABLE_COOKIE_SECURE')=='1' else ''
        return f'{AUTH_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}'
    def clear_auth_cookie(self):
        return f'{AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'
    def require_auth(self):
        user=self.auth_user()
        if AUTH_REQUIRED and not user:
            return None
        if user and user.get('id')!='local': request_user_id.set(user['id'])
        return user
    def copilot_browser_session(self,create=False):
        cookies=SimpleCookie(); cookies.load(self.headers.get('Cookie',''))
        morsel=cookies.get(COPILOT_COOKIE); session_id=morsel.value if morsel else None
        with copilot_sessions_lock:
            csrf=copilot_sessions.get(session_id) if session_id else None
            if csrf: return session_id,csrf,None
            if not create: return None,None,None
            session_id=secrets.token_urlsafe(32); csrf=secrets.token_urlsafe(32); copilot_sessions[session_id]=csrf
        secure='; Secure' if copilot_auth.redirect_uri().startswith('https://') else ''
        cookie=f'{COPILOT_COOKIE}={session_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000{secure}'
        return session_id,csrf,cookie
    def valid_copilot_csrf(self,session_id):
        with copilot_sessions_lock: expected=copilot_sessions.get(session_id,'')
        supplied=self.headers.get('X-CSRF-Token','')
        return bool(expected and supplied and hmac.compare_digest(expected,supplied))
    def reply_pdf(self,body,filename):
        self.send_response(200); self.send_header('Content-Type','application/pdf'); self.send_header('Content-Disposition',f'attachment; filename="{filename}"'); self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        path=urlparse(self.path).path
        if AUTH_REQUIRED and path=='/':
            self.send_response(303); self.send_header('Location','/index.html' if self.auth_user() else '/landing.html'); self.end_headers(); return
        if AUTH_REQUIRED and path=='/index.html' and not self.auth_user():
            self.send_response(303); self.send_header('Location','/landing.html'); self.end_headers(); return
        if path=='/api/auth/session':
            user=self.auth_user(); return self.reply({'authenticated':bool(user),'user':user if user and user.get('id')!='local' else None})
        if path=='/api/signature-task':
            token=(parse_qs(urlparse(self.path).query).get('token') or [''])[0]
            resolved=signature_project(token)
            if not resolved: return self.reply({'errors':['رابط التوقيع غير صالح أو تم استخدامه.']},404)
            _,_,project,_,_=resolved; found=find_signature_task(project,token)
            if not found: return self.reply({'errors':['رابط التوقيع غير صالح أو تم استخدامه.']},404)
            task,record,_=found
            return self.reply({'task':{**public_signature_task(project,task),'school':project.get('school',{}).get('name','المدرسة'),'recordId':record.get('id')}})
        if AUTH_REQUIRED and path.startswith('/api/') and not path.startswith('/api/auth/') and path not in ['/api/health','/api/templates']:
            if not self.require_auth(): return self.reply({'errors':['يجب تسجيل الدخول أولًا.']},401)
        if path=='/api/copilot/status':
            session_id,csrf,cookie=self.copilot_browser_session(create=True)
            result={**copilot_auth.status(session_id),'csrfToken':csrf,'scope':'local browser session only'}
            headers={'Set-Cookie':cookie} if cookie else None
            return self.reply(result,headers=headers)
        if path=='/auth/copilot/callback':
            query=parse_qs(urlparse(self.path).query); code=(query.get('code') or [''])[0]; state=(query.get('state') or [''])[0]
            session_id,_,_=self.copilot_browser_session()
            try:
                if not session_id or not code or not state: raise copilot_auth.CopilotAuthError('طلب تسجيل الدخول غير مكتمل.')
                copilot_auth.finish_login(session_id,state,code)
                self.send_response(303); self.send_header('Location','/?copilot=connected'); self.send_header('Cache-Control','no-store'); self.end_headers(); return
            except copilot_auth.CopilotAuthError:
                self.send_response(303); self.send_header('Location','/?copilot=error'); self.send_header('Cache-Control','no-store'); self.end_headers(); return
        if path=='/api/project': return self.reply(read())
        if path.startswith('/api/jobs/'):
            return self.reply(jobs.get(path.rsplit('/',1)[1],{'status':'NOT_FOUND'}))
        if path=='/api/health': return self.reply({'ok':True})
        if path=='/api/templates':
            secondary=[{'القرآن الكريم وتفسيره':4,'الرياضيات':5,'اللغة الإنجليزية':5,'الكيمياء':3,'الأحياء':3,'التقنية الرقمية':3,'الكفايات اللغوية':4,'التفكير الناقد':3,'التربية الصحية والبدنية':2},{'الرياضيات':5,'اللغة الإنجليزية':5,'الكيمياء':5,'الأحياء':4,'التاريخ':3,'الكفايات اللغوية':4,'الفيزياء':4,'النشاط':2},{'الرياضيات':4,'اللغة الإنجليزية':4,'الكيمياء':3,'علوم الأرض والفضاء':3,'التقنية الرقمية':2,'المجال الاختياري':5,'الفيزياء':5,'التربية الصحية والبدنية':3,'البحث ومصادر المعلومات':2,'النشاط':1}]
            primary=[
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':8,'الرياضيات':5,'العلوم':3,'اللغة الإنجليزية':3,'التربية الفنية':2,'التربية البدنية والدفاع عن النفس':3,'المهارات الحياتية والأسرية':1,'النشاط':3},
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':7,'الرياضيات':6,'العلوم':3,'اللغة الإنجليزية':3,'التربية الفنية':2,'التربية البدنية والدفاع عن النفس':3,'المهارات الحياتية والأسرية':1,'النشاط':3},
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':6,'الرياضيات':6,'العلوم':4,'اللغة الإنجليزية':3,'التربية الفنية':2,'التربية البدنية والدفاع عن النفس':3,'المهارات الحياتية والأسرية':1,'النشاط':3},
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':5,'الدراسات الاجتماعية':2,'الرياضيات':6,'العلوم':4,'اللغة الإنجليزية':3,'المهارات الرقمية':2,'التربية الفنية':1,'التربية البدنية والدفاع عن النفس':2,'المهارات الحياتية والأسرية':1,'النشاط':2},
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':5,'الدراسات الاجتماعية':2,'الرياضيات':6,'العلوم':4,'اللغة الإنجليزية':3,'المهارات الرقمية':2,'التربية الفنية':1,'التربية البدنية والدفاع عن النفس':2,'المهارات الحياتية والأسرية':1,'النشاط':2},
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':5,'الدراسات الاجتماعية':2,'الرياضيات':6,'العلوم':4,'اللغة الإنجليزية':3,'المهارات الرقمية':2,'التربية الفنية':1,'التربية البدنية والدفاع عن النفس':2,'المهارات الحياتية والأسرية':1,'النشاط':2},
            ]
            middle=[
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':5,'الدراسات الاجتماعية':3,'الرياضيات':6,'العلوم':4,'اللغة الإنجليزية':4,'المهارات الرقمية':2,'التربية الفنية':2,'التربية البدنية والدفاع عن النفس':2,'المهارات الحياتية والأسرية':1,'النشاط':1},
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':5,'الدراسات الاجتماعية':3,'الرياضيات':6,'العلوم':4,'اللغة الإنجليزية':4,'المهارات الرقمية':2,'التربية الفنية':2,'التربية البدنية والدفاع عن النفس':2,'المهارات الحياتية والأسرية':1,'النشاط':1},
                {'القرآن الكريم والدراسات الإسلامية':5,'اللغة العربية':4,'الدراسات الاجتماعية':2,'الرياضيات':6,'العلوم':4,'اللغة الإنجليزية':4,'المهارات الرقمية':2,'التربية الفنية':2,'التربية البدنية والدفاع عن النفس':2,'المهارات الحياتية والأسرية':1,'التفكير الناقد':2,'النشاط':1},
            ]
            plans={
                'ثانوي':{'label':'قالب الفزاري — ثانوي عام — الفصل الأول (قابل للتعديل)','grades':secondary},
                'متوسط':{'label':'دليل الخطط الدراسية — متوسط تعليم عام — الأنصبة الأسبوعية المكافئة للحد الأعلى السنوي','grades':middle},
                'ابتدائي':{'label':'دليل الخطط الدراسية — ابتدائي تعليم عام — الأنصبة الأسبوعية المكافئة للحد الأعلى السنوي','grades':primary},
            }
            return self.reply({'plans':plans,'label':plans['ثانوي']['label'],'grades':secondary})
        return super().do_GET()
    def do_POST(self):
        port=os.environ.get('NASQ_PORT','8767')
        allowed_origins={f'http://127.0.0.1:{port}',f'http://localhost:{port}'}
        public_url=os.environ.get('SOUNDTABLE_PUBLIC_URL','').rstrip('/')
        if public_url:
            parsed_public=urlparse(public_url); allowed_origins.add(f'{parsed_public.scheme}://{parsed_public.netloc}')
            # يعمل نظام الحصر على النطاقين الأساسي وwww؛ يجب قبول كليهما للحفظ.
            if parsed_public.hostname:
                alternate_host=parsed_public.hostname.removeprefix('www.') if parsed_public.hostname.startswith('www.') else f'www.{parsed_public.hostname}'
                alternate_port=f':{parsed_public.port}' if parsed_public.port else ''
                allowed_origins.add(f'{parsed_public.scheme}://{alternate_host}{alternate_port}')
        if self.headers.get('Origin') and self.headers['Origin'] not in allowed_origins: return self.reply({'errors':['Origin rejected']},403)
        try:
            size=int(self.headers.get('Content-Length',0))
            if size>5_000_000: return self.reply({'errors':['الملف كبير جدًا.']},413)
            body=json.loads(self.rfile.read(size)); path=urlparse(self.path).path
            if path=='/api/auth/register':
                try: return self.reply(sound_auth.register(body.get('email',''),body.get('password','')))
                except sound_auth.AuthError as error: return self.reply({'errors':[str(error)]},422)
            if path=='/api/auth/resend':
                try: return self.reply(sound_auth.resend_verification(body.get('email','')))
                except sound_auth.AuthError as error: return self.reply({'errors':[str(error)]},422)
            if path=='/api/auth/verify':
                try:
                    user,token=sound_auth.verify(body.get('token',''))
                    return self.reply({'authenticated':True,'user':user},headers={'Set-Cookie':self.auth_cookie(token)})
                except sound_auth.AuthError as error: return self.reply({'errors':[str(error)]},422)
            if path=='/api/auth/login':
                try:
                    user,token=sound_auth.authenticate(body.get('email',''),body.get('password',''))
                    return self.reply({'authenticated':True,'user':user},headers={'Set-Cookie':self.auth_cookie(token)})
                except sound_auth.EmailNotVerified as error: return self.reply({'errors':[str(error)],'needsVerification':True},403)
                except sound_auth.AuthError as error: return self.reply({'errors':[str(error)]},401)
            if path=='/api/auth/logout':
                sound_auth.delete_session(self.auth_token())
                return self.reply({'authenticated':False},headers={'Set-Cookie':self.clear_auth_cookie()})
            if path=='/api/signature-submit':
                token=str(body.get('token',''))
                with lock:
                    resolved=signature_project(token)
                    if not resolved: return self.reply({'errors':['رابط التوقيع غير صالح أو تم استخدامه.']},404)
                    _,_,current,_,_=resolved
                    try: task=submit_signature(current,token,body.get('signature',''))
                    except ValueError as error: return self.reply({'errors':[str(error)]},422)
                    current['revision']=current.get('revision',0)+1; write_signature_project(resolved,current)
                return self.reply({'task':task})
            if AUTH_REQUIRED and not self.require_auth(): return self.reply({'errors':['يجب تسجيل الدخول أولًا.']},401)
            if path=='/api/term-create':
                with lock:
                    current=read()
                    if body.get('revision')!=current.get('revision'):
                        return self.reply({'errors':['تغيرت بيانات المدرسة. حدّث الصفحة ثم أعد إنشاء الفصل الدراسي.']},409)
                    try: project=create_term_workspace(current,body.get('term',''))
                    except ValueError as error: return self.reply({'errors':[str(error)]},422)
                    write(project)
                return self.reply({'project':project,'terms':public_term_list(project)})
            if path=='/api/term-switch':
                with lock:
                    current=read()
                    if body.get('revision')!=current.get('revision'):
                        return self.reply({'errors':['تغيرت بيانات المدرسة. حدّث الصفحة ثم أعد فتح الفصل الدراسي.']},409)
                    try: project=switch_term_workspace(current,body.get('termId',''))
                    except ValueError as error: return self.reply({'errors':[str(error)]},422)
                    write(project)
                return self.reply({'project':project,'terms':public_term_list(project)})
            if path=='/api/reset-project':
                if body.get('confirm') is not True:
                    return self.reply({'errors':['يجب تأكيد مسح كافة البيانات أولًا.']},422)
                with lock:
                    current=read()
                    if body.get('revision')!=current['revision']:
                        return self.reply({'errors':['تغيرت البيانات. أعد تحميل الصفحة ثم راجع طلب المسح.']},409)
                    project=empty_project(current['revision']+1)
                    write(project)
                    swap_cache.clear()
                return self.reply({'project':project})
            if path in ['/api/copilot/login','/api/copilot/disconnect','/api/copilot/test','/api/copilot/chat']:
                session_id,_,_=self.copilot_browser_session()
                if not session_id: return self.reply({'errors':['حدّث الصفحة لبدء جلسة اتصال آمنة.']},401)
                if not self.valid_copilot_csrf(session_id): return self.reply({'errors':['انتهت جلسة الأمان. حدّث الصفحة ثم أعد المحاولة.']},403)
                if path=='/api/copilot/login':
                    try:
                        auth_url,_=copilot_auth.begin_login(session_id)
                        return self.reply({'authUrl':auth_url})
                    except copilot_auth.CopilotAuthError as error: return self.reply({'errors':[str(error)]},503)
                if path=='/api/copilot/disconnect':
                    copilot_auth.disconnect(session_id)
                    return self.reply({'connected':False})
                prompt='Reply with exactly: Copilot connection works.' if path=='/api/copilot/test' else str(body.get('prompt','')).strip()
                if not prompt or len(prompt)>4000: return self.reply({'errors':['اكتب طلبًا لا يتجاوز 4000 حرف.']},422)
                try:return self.reply(copilot_auth.ask(session_id,prompt,read()))
                except copilot_auth.CopilotAuthError as error:return self.reply({'errors':[str(error)]},502)
            if path=='/api/import-teachers':
                try:return self.reply({'teachers':teacher_preview(body['file'])})
                except Exception:return self.reply({'errors':['تعذر قراءة الملف. يجب أن يحتوي جدول واحد على عمود «اسم المعلم» أو «المعلم»، وعمود «النصاب» أو «عدد الحصص». اكتب نصابًا صحيحًا من 0 إلى 100 لكل معلم، وتجنب تكرار أعمدة الاسم أو النصاب. تُتجاهل الأعمدة الأخرى.']},422)
            if path in ['/api/teacher-contacts-preview','/api/teacher-contacts-import']:
                with lock:
                    current=read()
                    if path=='/api/teacher-contacts-preview':
                        try: return self.reply(contact_preview(body.get('file',''),current.get('teachers',[])))
                        except ValueError as error: return self.reply({'errors':[str(error)]},422)
                    if body.get('revision')!=current.get('revision'):
                        return self.reply({'errors':['تغيرت بيانات المدرسة. حدّث الصفحة ثم أعد الاستيراد.']},409)
                    project=copy.deepcopy(current)
                    try: project,summary=apply_contacts(project,body.get('file',''),body.get('mappings',{}))
                    except ValueError as error: return self.reply({'errors':[str(error)]},422)
                    if not summary['imported']:
                        return self.reply({'errors':['لم تتطابق أي أسماء من الملف مع قائمة معلمي المدرسة؛ لم يُحفظ شيء.']},422)
                    project['teacherContactsImport']={'sheet':summary['source']['sheet'],'importedAt':datetime.datetime.now().isoformat(timespec='seconds'),'imported':summary['imported'],'unmatched':len(summary['unmatched']),'ambiguous':len(summary['ambiguous'])}
                    project['revision']=current.get('revision',0)+1
                    write(project)
                return self.reply({'project':project,'summary':summary})
            if path=='/api/teacher-contacts-save':
                with lock:
                    current=read()
                    if body.get('revision')!=current.get('revision'):
                        return self.reply({'errors':['تغيرت بيانات المدرسة. حدّث الصفحة ثم أعد الحفظ.']},409)
                    project=copy.deepcopy(current); teachers={teacher.get('id'):teacher for teacher in project.get('teachers',[])}
                    try:
                        for teacher_id, phone in (body.get('phones') or {}).items():
                            if teacher_id not in teachers: continue
                            value=str(phone or '').strip()
                            if value: teachers[teacher_id]['whatsapp']=normalize_phone(value)
                            else: teachers[teacher_id].pop('whatsapp',None)
                    except ValueError as error: return self.reply({'errors':[str(error)]},422)
                    project['revision']=current.get('revision',0)+1; write(project)
                return self.reply({'project':project})
            if path in ['/api/smarttable-preview','/api/smarttable-import']:
                temporary=None
                try:
                    temporary=uploaded_xlsx(body.get('file',''))
                    imported=import_smarttable_project(temporary)
                    summary=smarttable_summary(imported)
                    if path=='/api/smarttable-preview':
                        return self.reply({'summary':summary})
                    with lock:
                        current=read()
                        if body.get('revision')!=current.get('revision'):
                            return self.reply({'errors':['تغيرت المسودة الحالية. حدّث الصفحة ثم راجع الاستيراد مرة أخرى.']},409)
                        backup=DATA/('before-smarttable-import-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.json')
                        backup.write_text(json.dumps(current,ensure_ascii=False),encoding='utf-8')
                        imported['revision']=current['revision']+1
                        imported['importBackup']=backup.name
                        write(imported)
                    return self.reply({'project':imported,'summary':summary,'backup':backup.name})
                except ValueError as error:
                    return self.reply({'errors':[str(error)]},422)
                except Exception:
                    return self.reply({'errors':['تعذر قراءة تصدير الجدول الذكي. ارفع ملف Excel الأصلي الذي يحتوي أوراق Teachers وCourses وCells وWCTStaticGeneral.']},422)
                finally:
                    if temporary:
                        temporary.unlink(missing_ok=True)
            if path=='/api/import-availability':
                if not SOURCE.exists(): return self.reply({'errors':['لم يُعثر على ملف الجدول الذكي في مجلد التنزيلات.']},404)
                try:
                    source=import_workbook(SOURCE)
                    source_teachers={t['name']:t for t in source['teachers']}
                    target_by_slot={(s['day'],s['period']):i for i,s in enumerate(read()['slots'])}
                    source_by_slot={i:(s['day'],s['period']) for i,s in enumerate(source['slots'])}
                except Exception:
                    return self.reply({'errors':['تعذر قراءة قيود الإتاحة من ملف الجدول الذكي.']},422)
                with lock:
                    old=read(); project=copy.deepcopy(old)
                    target_by_slot={(s['day'],s['period']):i for i,s in enumerate(project['slots'])}
                    matched=[]; blocked_total=0; unmapped=0
                    for teacher in project['teachers']:
                        source_teacher=source_teachers.get(teacher['name'])
                        if source_teacher is None: continue
                        mapped=[]
                        for source_slot in source_teacher.get('blocked',[]):
                            key=source_by_slot.get(source_slot)
                            target_slot=target_by_slot.get(key)
                            if target_slot is None: unmapped+=1
                            else: mapped.append(target_slot)
                        teacher['softBlocked']=sorted(set(mapped)); matched.append(teacher)
                        blocked_total+=len(teacher['softBlocked'])
                    if not matched: return self.reply({'errors':['لم تتطابق أسماء معلمي المشروع مع ملف الجدول الذكي.']},422)
                    backup=DATA/('before-smartble-availability-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.json')
                    backup.write_bytes(STATE.read_bytes())
                    previous=project.get('placements',[])
                    if previous: project['solverHint']=previous
                    project['placements']=[]
                    project['availabilityImport']={'source':'الفزاري الثانوية.xlsx','importedAt':datetime.datetime.now().isoformat(timespec='seconds'),'teachersMatched':len(matched),'blockedSlots':blocked_total,'mode':'flexible'}
                    project['revision']=old['revision']+1
                    errors=validate(project)
                    write(project)
                return self.reply({'project':project,'stats':{'teachersMatched':len(matched),'teachersWithBlocks':sum(bool(t.get('softBlocked',[])) for t in matched),'blockedSlots':blocked_total,'unmappedSlots':unmapped,'backup':backup.name,'validationErrors':errors}})
            if path=='/api/enable-smartble-exceptions':
                with lock:
                    old=read()
                    if not old.get('availabilityImport'): return self.reply({'errors':['لا توجد قيود مستوردة لتحويلها إلى قيود مرنة.']},422)
                    project=copy.deepcopy(old)
                    backup=DATA/('before-flexible-constraints-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.json')
                    backup.write_bytes(STATE.read_bytes())
                    moved=0
                    for teacher in project['teachers']:
                        inherited=set(teacher.get('softBlocked',[])); inherited.update(teacher.get('blocked',[]))
                        moved+=len(set(teacher.get('blocked',[])))
                        teacher['softBlocked']=sorted(inherited); teacher['blocked']=[]
                    project['placements']=[]
                    project['availabilityImport']['mode']='flexible'
                    project['availabilityImport']['convertedAt']=datetime.datetime.now().isoformat(timespec='seconds')
                    project['revision']=old['revision']+1; write(project)
                return self.reply({'project':project,'stats':{'movedBlocks':moved,'backup':backup.name}})
            if path=='/api/validate': return self.reply({'errors':validate(body,body.get('placements') if body.get('checkSchedule') else None,manual_edit=bool(body.get('manualOverrideMode')))})
            if path=='/api/absence-confirm':
                with lock:
                    current=read(); submitted=body.get('project',{})
                    if submitted.get('revision')!=current['revision']: return self.reply({'errors':['تغيرت البيانات. أعد تحميل البرنامج قبل تسجيل الغياب.']},409)
                    if standby_signature(current)!=standby_signature(submitted): return self.reply({'errors':['احفظ تعديل الجدول الدراسي قبل تسجيل الغياب.']},422)
                    date=body.get('date',''); records=current.get('absenceRecords',[])
                    previous=next((r for r in records if r['date']==date),None)
                    try: record=distribute_absence(current,date,body.get('teacherIds',[]),previous)
                    except ValueError as error: return self.reply({'errors':[str(error)]},422)
                    current['absenceRecords']=[r for r in records if r['date']!=date]+[record]
                    current['revision']+=1
                    sync_hasr_lesson_flow(current,date)
                    write(current)
                record=reconcile_missing_emergency_assignments(current, record)
                return self.reply({'project':current,'record':record})
            if path=='/api/signature-tasks':
                with lock:
                    current=read()
                    if body.get('revision')!=current.get('revision'):
                        return self.reply({'errors':['تغيرت البيانات. حدّث الصفحة ثم أعد تجهيز التكليفات.']},409)
                    project=copy.deepcopy(current)
                    try:
                        public_url=os.environ.get('SOUNDTABLE_PUBLIC_URL','http://127.0.0.1:8767').rstrip('/')
                        # النسخة المضمنة تعمل خلف /voice-table؛ لا تُنشئ روابط
                        # على جذر نظام الحصر حتى لا يعود المعلم إلى لوحة الحصر.
                        if HASR_EMBEDDED: public_url += '/voice-table'
                        project,tasks=prepare_tasks(project,body.get('recordId',''),body.get('senderPhone',''),body.get('phones',{}),public_url)
                    except ValueError as error:
                        return self.reply({'errors':[str(error)]},422)
                    project['revision']=current.get('revision',0)+1; write(project)
                return self.reply({'project':project,'tasks':tasks})
            if path=='/api/absence-cancel':
                date=body.get('date',''); teacher_ids=body.get('teacherIds',[])
                with lock:
                    current=read();
                    submitted=body.get('project',{})
                    if submitted.get('revision')!=current['revision']: return self.reply({'errors':['تغيرت البيانات. أعد تحميل المشروع قبل إلغاء غياب المعلم.']},409)
                    try:
                        updated, record=cancel_absence_record(current, date, teacher_ids)
                    except ValueError as error:
                        return self.reply({'errors':[str(error)]},422)
                    updated['revision']=current['revision']+1
                    sync_hasr_lesson_flow(updated,date)
                    write(updated)
                    if record:
                        record=reconcile_missing_emergency_assignments(updated, record)
                    return self.reply({'project':updated,'record':record})
            if path in ['/api/absence-preview','/api/absence-print']:
                project=read(); record=next((r for r in project.get('absenceRecords',[]) if r['id']==body.get('recordId')),None)
                if not record: return self.reply({'errors':['لم يُعثر على سجل الغياب.']},422)
                record=reconcile_missing_emergency_assignments(project, record)
                if path=='/api/absence-print':
                    return self.reply_pdf(render_pdf({**project,'absencePrintRecord':record},'absence','a4'),'absence-'+record['date']+'.pdf')
                content=absence_html(project,record).encode('utf-8');self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content);return
            if path=='/api/standby-print':
                project=body.get('project',{})
                if not project.get('standby',{}).get('assignments'): return self.reply({'errors':['أنشئ جدول الانتظار أولًا.']},422)
                return self.reply_pdf(render_pdf(project,'standby','a4'),'standby-weekly.pdf')
            if path=='/api/print-pdf':
                kind=body.get('kind'); paper=body.get('paper','a4'); project=body.get('project',{})
                if kind not in PRINT_TITLES or paper not in ['a4','a3'] or not project.get('placements'):
                    return self.reply({'errors':['بيانات الطباعة غير مكتملة. أنشئ الجدول أولًا ثم أعد المحاولة.']},422)
                return self.reply_pdf(render_pdf(project,kind,paper),f"{kind}-{paper}-landscape.pdf")
            if path=='/api/standby':
                return self.reply(generate_standby(body['project'],body['config']))
            if path=='/api/save':
                manual_edit=bool(body.get('manualOverrideMode'))
                errors=validate(body,require_assignments=False,manual_edit=manual_edit)
                if errors: return self.reply({'errors':errors},422)
                with lock:
                    old=read()
                    if body.get('revision')!=old['revision']: return self.reply({'errors':['تغيرت النسخة. أعد تحميل المشروع.']},409)
                    if body.get('placements'):
                        errors=validate(body,body['placements'],manual_edit=manual_edit)
                        if errors: return self.reply({'errors':errors},422)
                    if old.get('placements') and not old.get('savedSchedules'):
                        sync_schedule(old)
                        body.setdefault('savedSchedules',old['savedSchedules'])
                        body.setdefault('activeScheduleId',old['activeScheduleId'])
                        body.setdefault('activeScheduleName',old['activeScheduleName'])
                    try: sync_schedule(body)
                    except ValueError as error: return self.reply({'errors':[str(error)]},422)
                    body['revision']=old['revision']+1; write(body)
                return self.reply(body)
            if path in ['/api/solve','/api/swaps']:
                data=body['project']; errors=validate(data,manual_edit=path=='/api/swaps')
                if errors: return self.reply({'errors':errors},422)
                jid=uuid.uuid4().hex; jobs[jid]={'status':'RUNNING'}
                cache_key=None
                if path=='/api/swaps':
                    cache_key=json.dumps({'move':body['move'],'placements':data.get('placements',[])},sort_keys=True,ensure_ascii=False)
                    cached=swap_cache.get(cache_key)
                    if cached is not None:
                        jobs[jid]=copy.deepcopy(cached)
                        return self.reply({'jobId':jid})
                def run():
                    try:
                        if path=='/api/swaps':
                            budget=min(30,max(1,float(body.get('seconds',2))))
                            result=swap_options(data,body['move'],seconds=budget,manual_edit=True)
                            if len(swap_cache)>=100: swap_cache.clear()
                            swap_cache[cache_key]=copy.deepcopy(result)
                            jobs[jid]=result
                        else:
                            budget=min(120,max(1,float(body.get('seconds',20))))
                            allow_exceptions=bool(body.get('allowExceptions'))
                            result=solve(data,seconds=min(3,budget),no_repeats=True,strict_soft=allow_exceptions)
                            if not result.get('placements'):
                                spent=result.get('elapsed',0)
                                result=solve(data,seconds=max(.1,budget-spent),first_feasible=not allow_exceptions,relax_soft=allow_exceptions)
                                result['elapsed']=round(result.get('elapsed',0)+spent,2)
                            jobs[jid]=result
                    except Exception: jobs[jid]={'status':'ERROR','errors':['تعذر تشغيل محرك الجدولة.']}
                threading.Thread(target=run,daemon=True).start(); return self.reply({'jobId':jid})
            return self.reply({'errors':['مسار غير معروف']},404)
        except Exception:
            return self.reply({'errors':['طلب غير صالح. تحقق من المدخلات.']},400)
    def log_message(self,format,*args): pass

if __name__=='__main__':
    port=int(os.environ.get('NASQ_PORT','8767'))
    bind=os.environ.get('NASQ_BIND','127.0.0.1')
    print(f'Local timetable: http://{bind}:{port}',flush=True)
    if HASR_EMBEDDED:
        threading.Thread(target=sync_existing_embedded_coverages,daemon=True).start()
    ThreadingHTTPServer((bind,port),Handler).serve_forever()
