import unittest
from standby import generate, context

class StandbyTests(unittest.TestCase):
    def school(self):
        return {'teachers':[{'id':'a','blocked':[]},{'id':'b','blocked':[1]}], 'courses':[{'id':'x','teacherId':'a'},{'id':'y','teacherId':'b'}], 'placements':[{'courseId':'x','slot':0},{'courseId':'y','slot':0}], 'slots':[{'day':0,'period':i} for i in range(3)]}
    def test_constraints_and_final_priority(self):
        p=self.school();r=generate(p,{'target':20,'count':2,'excluded':[],'emergency':False})
        self.assertEqual({(a['teacherId'],a['slot']) for a in r['assignments']},{('a',2),('b',2)})
    def test_exclusion_and_zero_quota(self):
        p=self.school();r=generate(p,{'target':1,'count':3,'excluded':['a'],'emergency':True})
        self.assertEqual(r['assignments'],[])
    def test_emergency_still_respects_blocks_and_quota(self):
        p=self.school();r=generate(p,{'target':3,'count':2,'excluded':[],'emergency':True}); pairs={(a['teacherId'],a['slot']) for a in r['assignments']}
        self.assertIn(('a',1),pairs);self.assertNotIn(('b',1),pairs);self.assertNotIn(('a',0),pairs)
    def balanced_school(self,n):
        return {'teachers':[{'id':str(i),'blocked':[]} for i in range(n)], 'courses':[{'id':str(i),'teacherId':str(i)} for i in range(n)], 'placements':[{'courseId':str(i),'slot':1} for i in range(n)], 'slots':[{'day':0,'period':i} for i in range(4)]}
    def test_eight_requested_caps_final_at_three(self):
        from collections import Counter
        p=self.balanced_school(8)
        r=generate(p,{'target':20,'count':8,'excluded':[],'emergency':False})
        counts=Counter(a['slot'] for a in r['assignments'])
        self.assertEqual(counts[3],3)
        self.assertEqual(counts[0],5)
    def test_scarcity_allows_one_final_and_covers_earlier(self):
        from collections import Counter
        p=self.balanced_school(2)
        r=generate(p,{'target':20,'count':8,'excluded':[],'emergency':False})
        counts=Counter(a['slot'] for a in r['assignments'])
        self.assertEqual(counts[3],1)
        self.assertEqual(counts[0],1)
    def test_far_final_requires_separate_extreme_permission(self):
        p={'teachers':[{'id':'a','blocked':[]}], 'courses':[{'id':'x','teacherId':'a'}], 'placements':[{'courseId':'x','slot':0}], 'slots':[{'day':0,'period':i} for i in range(7)]}
        config={'target':20,'count':1,'emergency':False}
        self.assertEqual(generate(p,config)['assignments'],[])
        config['farEmergency']=True
        self.assertEqual(generate(p,config)['assignments'][0]['slot'],6)
    def test_all_generated_waits_within_distance(self):
        p=self.balanced_school(8)
        config={'target':20,'count':8,'emergency':True,'maxDistance':1}
        r=generate(p,config)
        self.assertTrue(r['assignments'])
        for a in r['assignments']: self.assertLessEqual(abs(p['slots'][a['slot']]['period']-1),1)
if __name__=='__main__': unittest.main()
