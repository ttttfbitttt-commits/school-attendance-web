import unittest
from schedules import sync_schedule
class ScheduleTests(unittest.TestCase):
    def test_first_schedule_is_named_and_snapshot_not_recursive(self):
        p={'placements':[{'courseId':'a','slot':0}],'revision':2,'absenceRecords':[{'id':'daily'}]}
        sync_schedule(p)
        self.assertEqual(p['activeScheduleName'],'جدول 1')
        snap=p['savedSchedules'][0]['snapshot']
        self.assertNotIn('savedSchedules',snap);self.assertNotIn('absenceRecords',snap)
        p['placements'][0]['slot']=1
        self.assertEqual(snap['placements'][0]['slot'],0)
    def test_new_schedule_preserves_old_and_renaming_updates_same_id(self):
        p={'placements':[{'slot':0}]};sync_schedule(p);original=p['savedSchedules'][0]['id']
        p.update(activeScheduleId='new',activeScheduleName='جدول 2',placements=[{'slot':1}]);sync_schedule(p)
        self.assertEqual(len(p['savedSchedules']),2)
        self.assertEqual(next(v for v in p['savedSchedules'] if v['id']==original)['snapshot']['placements'],[{'slot':0}])
        p['activeScheduleName']='جدول بديل';sync_schedule(p)
        self.assertEqual(len(p['savedSchedules']),2)
        self.assertEqual(next(v for v in p['savedSchedules'] if v['id']=='new')['name'],'جدول بديل')
    def test_duplicate_names_rejected(self):
        p={'placements':[{'slot':0}]};sync_schedule(p)
        p['activeScheduleId']='other'
        with self.assertRaises(ValueError):sync_schedule(p)
    def test_empty_draft_does_not_replace_saved_schedule(self):
        p={'placements':[{'slot':0}]};sync_schedule(p);p['placements']=[];sync_schedule(p)
        self.assertEqual(p['savedSchedules'][0]['snapshot']['placements'],[{'slot':0}])
if __name__=='__main__':unittest.main()
