"""Weekly standby allocation, independent from teaching placements."""
from collections import Counter, defaultdict
from ortools.sat.python import cp_model

def context(p):
    courses={c['id']:c for c in p['courses']}
    busy=defaultdict(set)
    for v in p['placements']:
        if v['courseId'] in courses: busy[courses[v['courseId']]['teacherId']].add(v['slot'])
    loads={t['id']:len(busy[t['id']]) for t in p['teachers']}
    return busy,loads

def generate(p, config):
    target=int(config.get('target',20)); count=int(config.get('count',3))
    if not 1<=target<=100 or not 1<=count<=20: raise ValueError('settings')
    if not p.get('placements'): raise ValueError('schedule')
    busy,loads=context(p); excluded=set(config.get('excluded',[])); slots=p['slots']
    last={d:max(s['period'] for s in slots if s['day']==d) for d in {s['day'] for s in slots}}
    model=cp_model.CpModel(); variables={}; cost=[]
    emergency=bool(config.get('emergency',False))
    max_distance=int(config.get('maxDistance',2))
    if not 1<=max_distance<=12: raise ValueError('distance')
    far_emergency=bool(config.get('farEmergency',False))
    for t in p['teachers']:
        tid=t['id']; quota=max(0,target-loads[tid])
        if tid in excluded or not quota: continue
        for si,s in enumerate(slots):
            if si in busy[tid] or si in t.get('blocked',[]): continue
            teaching=[slots[b]['period'] for b in busy[tid] if slots[b]['day']==s['day']]
            distance=min((abs(s['period']-period) for period in teaching),default=len(slots)+1)
            if distance>max_distance and not far_emergency: continue
            end=max(teaching,default=-1)
            late=s['period']>end
            if late and s['period']!=last[s['day']] and not emergency: continue
            v=model.NewBoolVar(f'{tid}_{si}'); variables[tid,si]=v
            cost.append(v*distance*20)
            if distance>max_distance: cost.append(v*500)
            if late: cost.append(v*(10+max(0,s['period']-end)))
        own=[v for (i,_),v in variables.items() if i==tid]
        model.Add(sum(own)<=quota)
        for d in last:
            daily=[v for (i,si),v in variables.items() if i==tid and slots[si]['day']==d]
            if emergency:
                extra=model.NewIntVar(0,len(slots),'extra');model.Add(extra>=sum(daily)-1);cost.append(extra*100)
            else: model.Add(sum(daily)<=1)
    # Cover every period once before adding depth. Final periods have their own
    # cap of three; a school-wide target of eight must not consume eight there.
    base=[]; final=[]; depth=[]
    for si,s in enumerate(slots):
        current=[v for (tid,j),v in variables.items() if j==si]
        is_final=s['period']==last[s['day']]
        cap=min(count,3) if is_final else count
        model.Add(sum(current)<=cap)
        for level in range(1,cap+1):
            reached=model.NewBoolVar(f'coverage_{si}_{level}')
            model.Add(sum(current)>=level).OnlyEnforceIf(reached)
            model.Add(sum(current)<level).OnlyEnforceIf(reached.Not())
            if level==1: base.append(reached)
            if is_final: final.append(reached)
            else: depth.append(reached*(count-level+1))
    # Lexicographic weights: basic coverage, then final coverage up to three,
    # then balanced depth in earlier periods, then exception costs.
    bound=(len(p['teachers'])+1)*(len(slots)+1)*1000
    depth_bound=len(slots)*count*(count+1)//2
    final_weight=(depth_bound+1)*bound
    base_weight=(len(last)*min(count,3)+1)*final_weight
    model.Maximize(sum(base)*base_weight+sum(final)*final_weight+sum(depth)*bound-sum(cost))
    solver=cp_model.CpSolver();solver.parameters.max_time_in_seconds=8;solver.parameters.num_search_workers=4
    status=solver.Solve(model)
    if status not in (cp_model.OPTIMAL,cp_model.FEASIBLE): raise ValueError('no solution')
    ranks=defaultdict(Counter); rows=[]
    for si,s in enumerate(slots):
        chosen=[tid for (tid,j),v in variables.items() if j==si and solver.Value(v)]
        for rank in range(1,len(chosen)+1):
            tid=min(chosen,key=lambda i:(ranks[i][rank],sum(ranks[i].values()),i));chosen.remove(tid);ranks[tid][rank]+=1
            rows.append({'slot':si,'teacherId':tid,'rank':rank})
    quotas={t['id']:(0 if t['id'] in excluded else max(0,target-loads[t['id']])) for t in p['teachers']}
    return {'config':config,'assignments':rows,'quotas':quotas,'signature':signature(p),'ruleVersion':2}

def legacy_signature(p):
    import json,hashlib
    data={k:p.get(k) for k in ['placements','slots','teachers','courses']}
    return hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def signature(p):
    """Fingerprint scheduling inputs, excluding names and other descriptive metadata."""
    import json,hashlib
    data={
        'placements': sorted((str(v.get('courseId','')),v.get('slot')) for v in p.get('placements',[])),
        'slots': [{k:v.get(k) for k in ('day','period','start','end')} for v in p.get('slots',[])],
        'teachers': sorted((str(t.get('id','')),sorted(t.get('blocked',[]))) for t in p.get('teachers',[])),
        'courses': sorted((str(c.get('id','')),str(c.get('teacherId','')),str(c.get('classId',''))) for c in p.get('courses',[])),
    }
    return 'v2:'+hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def approved_signature_matches(p, stored):
    if stored in (signature(p),legacy_signature(p)):
        return True
    # Old fingerprints included descriptive fields. Recover only if an intact
    # approved snapshot proves that the scheduling inputs themselves are equal.
    for item in p.get('savedSchedules',[]):
        snapshot=item.get('snapshot',{})
        if snapshot.get('standby',{}).get('signature') != stored:
            continue
        if stored in (signature(snapshot),legacy_signature(snapshot)) and signature(snapshot)==signature(p):
            return True
    return False
