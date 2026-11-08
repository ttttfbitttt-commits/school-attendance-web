"""Local timetable model. No network calls or changes to source workbooks."""
from collections import Counter, defaultdict
from ortools.sat.python import cp_model
import copy
import json
import time
import openpyxl

DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

def import_workbook(path):
    w = openpyxl.load_workbook(path, data_only=True)
    def records(sheet):
        vals = list(w[sheet].values)
        return [dict(zip(vals[0], r)) for r in vals[1:]]
    config = records('Workdays')[0]
    counts = json.loads(config['per_day_classes'])
    days = [{'name': DAYS[i], 'count': int(counts.get(str(i+1), 0))} for i in range(7)]
    days = [d for d in days if d['count']]
    width = int(config['number_of_classes'])
    slots = []
    timing = records('ClassBase')
    old_to_new = {}
    def clock_minutes(value):
        hour, minute = map(int, str(value).split(':'))
        return hour * 60 + minute
    def format_minutes(value):
        return f'{value // 60:02}:{value % 60:02}'
    for di, day in enumerate(days):
        previous_end = -1
        for p in range(day['count']):
            # Some الجدول الذكي exports declare "common" timing but still
            # store the actual rows under weekdays 1..5. Prefer that explicit
            # time and fall back to the shared row when it truly exists.
            t = next((t for t in timing if t['order'] == p and t['weekday'] == di + 1), None)
            if t is None:
                t = next((t for t in timing if t['order'] == p and t['weekday'] in (None, '')), None)
            start = t['start_time'] if t else ''
            end = t['end_time'] if t else ''
            # A few exports encode 12:30 and 1:15 as 00:30 and 01:15.
            # They occur after a morning period, so restore the intended
            # school-day clock rather than rejecting a valid exported table.
            if start and end:
                start_minutes, end_minutes = clock_minutes(start), clock_minutes(end)
                if start_minutes < previous_end and start_minutes < 180 and previous_end >= 600:
                    start_minutes += 720
                    end_minutes += 720
                if end_minutes <= start_minutes and end_minutes < 180 and start_minutes >= 600:
                    end_minutes += 720
                start, end = format_minutes(start_minutes), format_minutes(end_minutes)
                previous_end = end_minutes
            old = di*width+p
            old_to_new[old] = len(slots)
            slots.append({'day': di, 'period': p, 'start': start, 'end': end})
    teachers = [{'id': str(i), 'name': t['name'], 'short': t['nickname'] or t['name'], 'max': int(t['max_classes']), 'blocked': []} for i,t in enumerate(records('Teachers'))]
    teacher_ids = {t['name']: t['id'] for t in teachers}
    for o in records('OffCells'):
        if not o['activate'] and o['cell_number'] in old_to_new and o['teacher_name'] in teacher_ids:
            teachers[int(teacher_ids[o['teacher_name']])]['blocked'].append(old_to_new[o['cell_number']])
    classes = [{'id': str(i), 'name': c['name']} for i,c in enumerate(records('Classrooms'))]
    class_ids = {c['name']: c['id'] for c in classes}
    courses = [{'id': str(c['row_id']), 'classId': class_ids[c['classroom_name']], 'subject': c['name'], 'short': c['name'], 'teacherId': teacher_ids.get(c['teacher_name'], ''), 'count': int(c['odd_classes'] or 0)+2*int(c['even_classes'] or 0), 'pairs': int(c['even_classes'] or 0), 'room': c['special_place_name'] or ''} for c in records('Courses')]
    known = {c['id'] for c in courses}
    placements, locks = [], []
    for cell in records('Cells'):
        cid = str(cell['course_row_id'])
        if cid in known and cell['cell_number'] in old_to_new and cell['activate']:
            item = {'courseId': cid, 'slot': old_to_new[cell['cell_number']]}
            placements.append(item)
            if cell['is_locked']: locks.append(item.copy())
    meta = dict(list(w['_META'].values)[1:])
    data = {'school': {'name': meta.get('source_school_name', ''), 'director': '', 'year': '1448', 'stage': 'ثانوي', 'term': 'الأول', 'plan': 'توزيع المدرسة المستورد — قابل للتخصيص'}, 'days': days, 'slots': slots, 'teachers': teachers, 'classes': classes, 'courses': courses, 'placements': [], 'referencePlacements': placements, 'locks': locks, 'revision': 1}
    return data


def import_smarttable_project(path):
    """Read a full Al-Jadwal Al-Thaki export, including its saved schedule.

    The ordinary ``import_workbook`` helper deliberately leaves placements empty
    because it is also used when importing availability constraints.  A complete
    import is different: the school explicitly wants to keep the timetable and
    the existing general standby order exactly as exported.
    """
    data = import_workbook(path)
    workbook = openpyxl.load_workbook(path, data_only=True)

    def records(sheet):
        values = list(workbook[sheet].values)
        if not values:
            return []
        return [dict(zip(values[0], row)) for row in values[1:] if any(value is not None for value in row)]

    required = {'_META', 'Workdays', 'WCTeachers', 'WCTStaticGeneral'}
    missing = required.difference(workbook.sheetnames)
    if missing:
        raise ValueError('ملف الجدول الذكي غير مكتمل.')

    workdays = records('Workdays')[0]
    width = int(workdays['number_of_classes'])
    counts = json.loads(workdays['per_day_classes'])
    old_to_new = {}
    new_slot = 0
    for day_index in range(7):
        for period in range(int(counts.get(str(day_index + 1), 0))):
            old_to_new[day_index * width + period] = new_slot
            new_slot += 1

    # General waiting duties are stored as teacher-row, old cell-number, and a
    # priority.  Convert them to the application's stable slot indices without
    # reordering the priority supplied by الجدول الذكي.
    teacher_ids = {teacher['name']: teacher['id'] for teacher in data['teachers']}
    waiting_teacher_ids = {
        row['row_id']: teacher_ids.get(row.get('teacher_name'))
        for row in records('WCTeachers')
    }
    by_slot = defaultdict(list)
    skipped_waiting = 0
    for sequence, row in enumerate(records('WCTStaticGeneral')):
        teacher_id = waiting_teacher_ids.get(row.get('wct_row_id'))
        slot = old_to_new.get(row.get('cell_number'))
        if teacher_id is None or slot is None:
            skipped_waiting += 1
            continue
        priority = row.get('priority')
        try:
            priority = int(priority)
        except (TypeError, ValueError):
            priority = 10_000
        by_slot[slot].append((priority, sequence, teacher_id))

    assignments = []
    for slot, rows in by_slot.items():
        used = set()
        rank = 1
        for _, _, teacher_id in sorted(rows):
            if teacher_id in used:
                continue
            used.add(teacher_id)
            assignments.append({'slot': slot, 'teacherId': teacher_id, 'rank': rank})
            rank += 1

    teaching_load = Counter(course['teacherId'] for placement in data['referencePlacements']
                            for course in data['courses'] if course['id'] == placement['courseId'])
    waiting_load = Counter(row['teacherId'] for row in assignments)
    excluded_waiting = [teacher['id'] for teacher in data['teachers'] if waiting_load[teacher['id']] == 0]
    target = max([20, *(teaching_load[teacher['id']] + waiting_load[teacher['id']] for teacher in data['teachers'])])
    maximum_rank = max((row['rank'] for row in assignments), default=1)
    meta = dict(list(workbook['_META'].values)[1:])

    data['placements'] = copy.deepcopy(data['referencePlacements'])
    data['manualOverrideMode'] = True
    data['setupStep'] = 6
    data['activeScheduleName'] = meta.get('table_name') or 'جدول مستورد من الجدول الذكي'
    data['standby'] = {
        'config': {
            'target': target,
            'count': maximum_rank,
            # In the source timetable, having no waiting row means a deliberate
            # zero waiting quota. Preserve that rule for normal and emergency
            # allocation instead of silently drafting the teacher later.
            'excluded': excluded_waiting,
            'emergency': True,
            'farEmergency': True,
            'maxDistance': 3,
            'importedFromSmartTable': True,
        },
        'assignments': assignments,
        'ruleVersion': 2,
        'importedFromSmartTable': True,
    }
    # The absence workflow only acts on an approved standby table.  A complete
    # import is already an approved table from the source system, so seal it
    # with the same fingerprint used after a local approval.
    from standby import signature as standby_signature
    data['standby']['signature'] = standby_signature(data)
    data['smartTableImport'] = {
        'sourceSchool': meta.get('source_school_name', ''),
        'sourceTable': meta.get('table_name', ''),
        'teachers': len(data['teachers']),
        'classes': len(data['classes']),
        'lessons': len(data['placements']),
        'waitingAssignments': len(assignments),
        'skippedWaitingAssignments': skipped_waiting,
    }
    return data

def validate(data, placements=None, require_assignments=True, manual_edit=False):
    errors = []
    try:
        slots, courses, teachers, classes = (data[k] for k in ['slots','courses','teachers','classes'])
        ts, cs = {t['id']:t for t in teachers}, {c['id']:c for c in classes}
        if not slots or (require_assignments and (not classes or not teachers)): errors.append('أكمل الأيام والفصول والمعلمين.')
        for seq in [teachers, classes, courses]:
            if len({i['id'] for i in seq}) != len(seq): errors.append('يوجد معرف مكرر في البيانات.')
        load, demand = Counter(), Counter()
        for c in courses:
            if not isinstance(c['count'], int) or c['count'] < 0 or not isinstance(c.get('pairs',0),int) or not 0 <= 2*c.get('pairs',0) <= c['count']: errors.append('عدد حصص غير صالح: '+c['subject']); continue
            if c['classId'] not in cs: errors.append('فصل غير معروف: '+c['subject']); continue
            demand[c['classId']] += c['count']
            if c['teacherId'] not in ts:
                if require_assignments: errors.append('إسناد غير مكتمل: '+c['subject'])
                continue
            load[c['teacherId']] += c['count']
        for t in teachers:
            available = len(slots) if manual_edit else len(slots)-len(set(t['blocked']))
            if any(not isinstance(s,int) or s<0 or s>=len(slots) for s in t['blocked']): errors.append('إغلاق خارج التوقيت: '+t['name'])
            if any(not isinstance(s,int) or s<0 or s>=len(slots) for s in t.get('softBlocked', [])): errors.append('قيد مرن خارج التوقيت: '+t['name'])
            if load[t['id']] > t['max']: errors.append(f"{t['name']}: الإسناد {load[t['id']]} يتجاوز النصاب {t['max']}.")
            if load[t['id']] > available: errors.append(f"{t['name']}: الإسناد {load[t['id']]} والمتاح {available} فقط.")
        shorts=[t.get('short','').strip() for t in teachers]
        if any(not s for s in shorts) or len(set(shorts))!=len(shorts): errors.append('اختصارات المعلمين يجب أن تكون غير فارغة وغير متطابقة.')
        for c in classes:
            if demand[c['id']] != len(slots): errors.append(f"{c['name']}: الخطة {demand[c['id']]} حصة، والأسبوع {len(slots)}؛ يجب إكمال التوزيع أو تعديل التوقيت.")
        def minutes(v):
            h,m = map(int,v.split(':')); return h*60+m
        for i,s in enumerate(slots):
            if not 0 <= s['day'] < len(data['days']) or minutes(s['start']) >= minutes(s['end']): errors.append('توقيت غير صالح.'); continue
            for t in slots[:i]:
                if s['day']==t['day'] and minutes(s['start']) < minutes(t['end']) and minutes(t['start']) < minutes(s['end']): errors.append('تداخل بين أوقات حصص اليوم.')
        if placements is not None:
            byid = {c['id']:c for c in courses}; seen_t,seen_c,seen_r=set(),set(),set(); actual=Counter()
            for p in placements:
                c=byid.get(p['courseId']); s=p['slot']
                if c is None or not isinstance(s,int) or not 0<=s<len(slots): errors.append('موضع حصة غير صالح.'); continue
                actual[c['id']]+=1
                if not manual_edit and s in ts[c['teacherId']]['blocked']: errors.append('حصة في وقت مغلق: '+ts[c['teacherId']]['name'])
                for key,seen,label in [((c['teacherId'],s),seen_t,'تعارض معلم'),((c['classId'],s),seen_c,'تعارض فصل')]:
                    if key in seen: errors.append(label)
                    seen.add(key)
                if c.get('room'):
                    k=(c['room'],s)
                    if k in seen_r: errors.append('تعارض مكان')
                    seen_r.add(k)
            for c in courses:
                if actual[c['id']] != c['count']: errors.append('نصاب غير مكتمل: '+c['subject']+' / '+cs[c['classId']]['name'])
                if not manual_edit and c.get('pairs',0):
                    occupied=sorted(p['slot'] for p in placements if p['courseId']==c['id']); used=set(); pairs=0
                    for s in occupied:
                        if s not in used and s+1 in occupied and s+1 not in used and slots[s]['day']==slots[s+1]['day'] and slots[s]['end']==slots[s+1]['start']:
                            pairs+=1;used.update([s,s+1])
                    if pairs<c['pairs']: errors.append('الجلسات المزدوجة غير مكتملة: '+c['subject'])
            positions={(p['courseId'],p['slot']) for p in placements}
            if not manual_edit:
                for lock in data.get('locks',[]):
                    if (lock['courseId'],lock['slot']) not in positions: errors.append('حصة مثبتة تغير موقعها.')
    except (KeyError, TypeError, ValueError, IndexError):
        errors.append('بنية البيانات أو التوقيت غير صالحة.')
    return list(dict.fromkeys(errors))

def solve(data, seconds=20, forced=None, baseline=None, excluded=None, first_feasible=False, no_repeats=False, relax_soft=False, strict_soft=False, manual_edit=False, movable_course_ids=None):
    start=time.monotonic(); errors=validate(data, manual_edit=manual_edit)
    if errors: return {'status':'INVALID','errors':errors}
    slots, courses = data['slots'], data['courses']; teachers={t['id']:t for t in data['teachers']}
    model=cp_model.CpModel(); x={}; by_t=defaultdict(list); by_c=defaultdict(list); by_r=defaultdict(list); penalties=[]; soft_penalties=[]; assumptions={}; availability={}
    for c in courses:
        for s in range(len(slots)):
            v=model.new_bool_var(f"x_{c['id']}_{s}"); x[c['id'],s]=v
            teacher=teachers[c['teacherId']]
            soft=set(teacher.get('softBlocked',[]))
            if not manual_edit and (s in teacher['blocked'] or (strict_soft and s in soft)):
                model.add(v==0)
            elif not manual_edit and relax_soft and s in soft:
                soft_penalties.append(v)
            by_t[c['teacherId'],s].append(v); by_c[c['classId'],s].append(v)
            if c.get('room'): by_r[c['room'],s].append(v)
        model.add(sum(x.get((c['id'],s),0) for s in range(len(slots)))==c['count'])
        pairvars=[]
        if not manual_edit and c.get('pairs',0):
            for s in range(len(slots)-1):
                if slots[s]['day']==slots[s+1]['day'] and slots[s]['end']==slots[s+1]['start'] and (c['id'],s) in x and (c['id'],s+1) in x:
                    v=model.new_bool_var(f"pair_{c['id']}_{s}"); model.add(v<=x[c['id'],s]); model.add(v<=x[c['id'],s+1]); pairvars.append((s,v))
            model.add(sum(v for _,v in pairvars)==c['pairs'])
            for s in range(len(slots)): model.add(sum(v for p,v in pairvars if p<=s<=p+1)<=1)
        for d in range(len(data['days'])):
            n=sum(x.get((c['id'],s),0) for s,t in enumerate(slots) if t['day']==d)
            excess=model.new_int_var(0,len(slots),'repeat'); model.add(excess>=n-1-sum(v for s,v in pairvars if slots[s]['day']==d)); penalties.append(excess*100)
            if no_repeats:model.add(excess==0)
    for values in by_t.values(): model.add_at_most_one(values)
    for values in by_r.values(): model.add_at_most_one(values)
    for cl in data['classes']:
        for s in range(len(slots)): model.add_exactly_one(by_c[cl['id'],s])
    if movable_course_ids is not None and baseline is not None:
        movable=set(movable_course_ids)
        for p in baseline:
            if p['courseId'] not in movable:
                model.add(x.get((p['courseId'],p['slot']),0)==1)
    fixed=([forced] if forced else []) if manual_edit else data.get('locks',[])+([forced] if forced else [])
    for p in fixed: model.add(x.get((p['courseId'],p['slot']),0)==1)
    if forced and 'sourceSlot' in forced:
        model.add(x.get((forced['courseId'],forced['sourceSlot']),0)==0)
    for previous in excluded or []:
        model.add(sum(x.get((p['courseId'],p['slot']),0) for p in previous)<len(previous))
    hints={(p['courseId'],p['slot']) for p in (data.get('placements') or data.get('solverHint',[]))}
    for key,v in x.items(): model.add_hint(v,int(key in hints))
    soft_cost=sum(soft_penalties)*100000
    if baseline is not None:
        model.minimize(sum(1-x.get((p['courseId'],p['slot']),0) for p in baseline)*1000000+soft_cost+sum(penalties))
    else: model.minimize(soft_cost+sum(penalties))
    solver=cp_model.CpSolver(); solver.parameters.max_time_in_seconds=seconds
    solver.parameters.num_search_workers=1 if manual_edit else 8
    solver.parameters.random_seed=42
    solver.parameters.randomize_search=False
    solver.parameters.stop_after_first_solution=first_feasible
    status=solver.solve(model); name=solver.status_name(status)
    result={'status':name,'elapsed':round(time.monotonic()-start,2)}
    if status in (cp_model.FEASIBLE,cp_model.OPTIMAL):
        placements=[{'courseId':cid,'slot':s} for (cid,s),v in x.items() if solver.value(v)]
        failures=validate(data,placements,manual_edit=manual_edit)
        if failures: return {'status':'VALIDATION_FAILED','errors':failures}
        exceptions=[]
        byid={c['id']:c for c in courses}
        for p in placements:
            course=byid[p['courseId']]; teacher=teachers[course['teacherId']]
            if p['slot'] in teacher.get('softBlocked',[]):
                slot=slots[p['slot']]
                exceptions.append({'teacherId':teacher['id'],'teacher':teacher['name'],'courseId':course['id'],'classId':course['classId'],'className':next(c['name'] for c in data['classes'] if c['id']==course['classId']),'subject':course['subject'],'slot':p['slot'],'day':data['days'][slot['day']]['name'],'period':slot['period']+1})
        result.update(placements=placements,errors=[],objective=solver.objective_value,exceptions=exceptions)
    else:
        result['errors']=['الشروط لا تسمح بحل.' if name=='INFEASIBLE' else 'انتهى وقت البحث دون حسم. يمكنك زيادة المدة.']
        if name=='INFEASIBLE':
            core=[assumptions[i]['name'] for i in solver.sufficient_assumptions_for_infeasibility() if i in assumptions]
            result['conflictTeachers']=core
            if core: result['errors'].append(f'توجد مجموعة تعارض تشمل إتاحة {len(core)} معلمًا مع الإسنادات. لم يُتجاوز أي إغلاق. افتح تفاصيل التشخيص للمراجعة.')
    return result


def swap_options(data, move, seconds=5, limit=None, manual_edit=False):
    start=time.monotonic(); before=data.get('placements',[])
    errors=validate(data,before,manual_edit=manual_edit)
    if errors:return {'status':'INVALID','errors':errors,'options':[]}
    byid={c['id']:c for c in data['courses']}
    cid=move.get('courseId');source=move.get('sourceSlot');target=move.get('slot')
    if cid not in byid or {'courseId':cid,'slot':source} not in before or not isinstance(target,int) or not 0<=target<len(data['slots']) or target==source:
        return {'status':'INVALID','errors':['موضع النقل غير صالح.'],'options':[]}
    baseline={(p['courseId'],p['slot']) for p in before}; options=[];excluded=[]
    selected=byid[cid]
    target_class_course=next((byid[p['courseId']] for p in before if p['slot']==target and byid[p['courseId']]['classId']==selected['classId']),None)
    related_teachers={selected['teacherId']}
    if target_class_course: related_teachers.add(target_class_course['teacherId'])
    if selected.get('room'):
        for p in before:
            candidate=byid[p['courseId']]
            if p['slot']==target and candidate.get('room')==selected['room']:
                related_teachers.add(candidate['teacherId'])
    related_classes={selected['classId']}
    movable={c['id'] for c in data['courses'] if c['classId'] in related_classes or c['teacherId'] in related_teachers}
    def add(positions):
        key={(p['courseId'],p['slot']) for p in positions}
        if any(key=={(p['courseId'],p['slot']) for p in o['placements']} for o in options):return
        moved=[p for p in positions if (p['courseId'],p['slot']) not in baseline]
        count=len(moved); kind='بسيط' if count<=2 else 'مركب' if count<=4 else 'مركب مضاعف'
        affected=sorted({byid[p['courseId']]['teacherId'] for p in moved})
        options.append({'placements':positions,'kind':kind,'movedLessons':count,'affectedTeachers':len(affected),'affectedTeacherIds':affected})
        excluded.append(positions)
    other=next((p for p in before if p['slot']==target and byid[p['courseId']]['classId']==byid[cid]['classId']),None)
    if other:
        direct=[dict(p,slot=target if p['courseId']==cid and p['slot']==source else source if p==other else p['slot']) for p in before]
        if not validate(data,direct,manual_edit=manual_edit):add(direct)
    last=None
    exhaustive=False
    while limit is None or len(options)<limit:
        remaining=seconds-(time.monotonic()-start)
        if remaining<0.15:break
        last=solve(data,min(.45,remaining),forced=move,baseline=before,excluded=excluded,manual_edit=manual_edit,first_feasible=True,movable_course_ids=movable)
        if not last.get('placements'):
            exhaustive=last.get('status')=='INFEASIBLE'
            break
        add(last['placements'])
    options.sort(key=lambda o:(o['movedLessons'],o['affectedTeachers']))
    return {'status':'FOUND' if options else (last or {}).get('status','UNKNOWN'),'options':options,'elapsed':round(time.monotonic()-start,2),'exhaustive':exhaustive,'errors':[] if options else (last or {}).get('errors',['لم يُعثر على بديل خلال مهلة البحث.'])}
