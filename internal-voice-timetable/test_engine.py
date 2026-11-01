import copy, unittest
from engine import solve, validate, swap_options

def fixture():
    return {'days':[{'name':'الأحد','count':2},{'name':'الاثنين','count':2}], 'slots':[{'day':d,'period':p,'start':f'{8+p:02}:00','end':f'{9+p:02}:00'} for d in range(2) for p in range(2)],'teachers':[{'id':str(i),'name':f'T{i}','short':f'T{i}','max':4,'blocked':[]} for i in range(2)],'classes':[{'id':str(i),'name':f'C{i}'} for i in range(2)],'courses':[{'id':f'{c}-{t}','classId':str(c),'teacherId':str(t),'subject':f'S{t}','short':f'S{t}','count':2,'pairs':0,'room':''} for c in range(2) for t in range(2)],'placements':[],'locks':[]}

class EngineTest(unittest.TestCase):
    def test_swap_alternatives_preserve_source_and_constraints(self):
        d=fixture();d['placements']=solve(d,1)['placements'];p=d['placements'][0]
        target=next(s for s in range(4) if not any(q['courseId']==p['courseId'] and q['slot']==s for q in d['placements']))
        move={'courseId':p['courseId'],'sourceSlot':p['slot'],'slot':target}
        result=swap_options(d,move,1,2);self.assertTrue(result['options'])
        keys=[]
        for option in result['options']:
            self.assertEqual(validate(d,option['placements']),[])
            self.assertNotIn(p,option['placements'])
            self.assertIn({'courseId':p['courseId'],'slot':target},option['placements'])
            keys.append(frozenset((q['courseId'],q['slot']) for q in option['placements']))
            self.assertIn(option['kind'],['بسيط','مركب','مركب مضاعف'])
        self.assertEqual(len(keys),len(set(keys)))
        self.assertEqual(
            [(option['movedLessons'],option['affectedTeachers']) for option in result['options']],
            sorted((option['movedLessons'],option['affectedTeachers']) for option in result['options']),
        )
    def test_swap_respects_locked_source(self):
        d=fixture();d['placements']=solve(d,1)['placements'];p=d['placements'][0];d['locks']=[p]
        result=swap_options(d,{'courseId':p['courseId'],'sourceSlot':p['slot'],'slot':(p['slot']+1)%4},1)
        self.assertEqual(result['options'],[])
    def test_manual_swap_ignores_availability_and_locks(self):
        d=fixture();d['placements']=solve(d,1)['placements'];p=d['placements'][0]
        d['locks']=[p];d['teachers'][int(d['courses'][0]['teacherId'])]['blocked']=list(range(4))
        result=swap_options(d,{'courseId':p['courseId'],'sourceSlot':p['slot'],'slot':(p['slot']+1)%4},1,manual_edit=True)
        self.assertTrue(result['options'])
        self.assertEqual(validate(d,result['options'][0]['placements'],manual_edit=True),[])
    def test_blank_draft(self):
        d=fixture();d['teachers']=[];d['classes']=[];d['courses']=[]
        self.assertEqual(validate(d,require_assignments=False),[])
        self.assertTrue(validate(d))
    def test_unassigned_class_draft(self):
        d=fixture();d['teachers']=[]
        for c in d['courses']: c['teacherId']=''
        self.assertEqual(validate(d,require_assignments=False),[])
        self.assertTrue(validate(d))
    def test_complete(self):
        d=fixture(); r=solve(d,2); self.assertIn(r['status'],['OPTIMAL','FEASIBLE']);self.assertEqual(len(r['placements']),8); self.assertEqual(validate(d,r['placements']),[])
    def test_capacity(self):
        d=fixture();d['teachers'][0]['blocked']=[0];self.assertTrue(validate(d));self.assertEqual(solve(d,1)['status'],'INVALID')
    def test_soft_constraint_is_reported_only_when_relaxed(self):
        d=fixture();d['teachers'][0]['softBlocked']=[0]
        self.assertEqual(solve(d,2,strict_soft=True)['status'],'INFEASIBLE')
        result=solve(d,2,relax_soft=True)
        self.assertIn(result['status'],['OPTIMAL','FEASIBLE'])
        self.assertEqual(len(result['exceptions']),1)
        self.assertEqual(result['exceptions'][0]['teacherId'],'0')
    def test_teacher_collision_detected(self):
        d=fixture();r=solve(d,2);p=r['placements'];a=next(x for x in p if x['courseId']=='0-0');b=next(x for x in p if x['courseId']=='1-0');b['slot']=a['slot'];self.assertIn('تعارض معلم',validate(d,p))
    def test_forced_move(self):
        d=fixture();r=solve(d,2);d['placements']=r['placements'];p=d['placements'][0];target=next(s for s in range(4) if not any(q['courseId']==p['courseId'] and q['slot']==s for q in d['placements']));result=solve(d,2,forced={'courseId':p['courseId'],'slot':target},baseline=d['placements']);self.assertIn(result['status'],['OPTIMAL','FEASIBLE']);self.assertIn({'courseId':p['courseId'],'slot':target},result['placements']);self.assertEqual(validate(d,result['placements']),[])
    def test_locked_conflict(self):
        d=fixture();d['locks']=[{'courseId':'0-0','slot':0},{'courseId':'1-0','slot':0}];self.assertEqual(solve(d,2)['status'],'INFEASIBLE')
    def test_double(self):
        d=fixture();d['courses'][0]['pairs']=1;r=solve(d,2);self.assertIn(r['status'],['OPTIMAL','FEASIBLE']);s=[d['slots'][p['slot']] for p in r['placements'] if p['courseId']=='0-0'];self.assertEqual(s[0]['day'],s[1]['day'])
    def test_overlap(self):
        d=fixture();d['slots'][1]['start']='08:30';self.assertIn('تداخل بين أوقات حصص اليوم.',validate(d))
    def test_shared_room(self):
        d=fixture();
        for c in d['courses']: c['room']='lab'
        self.assertEqual(solve(d,2)['status'],'INFEASIBLE')

if __name__=='__main__':unittest.main()
