import unittest
from standby import signature
from absence import distribute,official_html,cancel_absence,reconcile_missing_emergency_assignments
class AbsenceTests(unittest.TestCase):
    def school(self):
        p={'days':[{'name':'الأحد'}],'slots':[{'day':0,'period':0,'start':'07:00','end':'07:45'}],'teachers':[{'id':t,'name':t,'blocked':[]} for t in ['a','b','c','d']], 'courses':[{'id':'x','teacherId':'a','classId':'one','subject':'رياضيات'},{'id':'y','teacherId':'b','classId':'two','subject':'علوم'}], 'classes':[{'id':'one','name':'أول'},{'id':'two','name':'ثان'}], 'placements':[{'courseId':'x','slot':0},{'courseId':'y','slot':0}]}
        p['standby']={'assignments':[{'teacherId':'b','slot':0,'rank':1},{'teacherId':'c','slot':0,'rank':2},{'teacherId':'d','slot':0,'rank':3}], 'signature':signature(p)}
        return p
    def test_absent_replacements_excluded_and_no_simultaneous_double(self):
        r=distribute(self.school(),'2026-10-25',['a','b'])
        self.assertEqual({e['replacementId'] for e in r['entries']},{'c','d'})
        self.assertEqual(len(r['teachers']),2)
    def test_same_date_merges_without_duplicates_and_reallocates(self):
        p=self.school();old=distribute(p,'2026-10-25',['a'])
        r=distribute(p,'2026-10-25',['a','b'],old)
        self.assertEqual(r['id'],old['id']);self.assertEqual(len(r['teacherIds']),2)
        self.assertEqual({e['replacementId'] for e in r['entries']},{'c','d'})
    def test_mixed_numeric_and_emergency_ranks_sort_stably(self):
        p=self.school();p['courses']=[{'id':'x','teacherId':'a','classId':'one','subject':'رياضيات'}];p['placements']=[{'courseId':'x','slot':0}];p['standby']['assignments']=[{'teacherId':'b','slot':0,'rank':1},{'teacherId':'c','slot':0,'rank':'طوارئ'}];p['standby']['signature']=signature(p)
        r=distribute(p,'2026-10-25',['a'])
        self.assertEqual(r['entries'][0]['replacementId'],'b')
        self.assertEqual(r['entries'][0]['rank'],1)
    def test_uncovered_explicit_and_weekend_rejected(self):
        r=distribute(self.school(),'2026-10-25',['a','b','c','d'])
        self.assertTrue(all(e['replacementId'] is None and e['notes'] for e in r['entries']))
        with self.assertRaises(ValueError):distribute(self.school(),'2026-10-23',['a'])
    def test_emergency_falls_back_to_closest_available_teacher(self):
        p=self.school();p['teachers'][0]['blocked']=[0];p['teachers'][1]['blocked']=[0];p['teachers'][2]['blocked']=[0];p['teachers'][3]['blocked']=[0]
        p['teachers'].append({'id':'e','name':'e','blocked':[]})
        p['standby']={'assignments':[{'teacherId':'b','slot':0,'rank':1},{'teacherId':'c','slot':0,'rank':2},{'teacherId':'d','slot':0,'rank':3}], 'signature':signature(p)}
        r=distribute(p,'2026-10-25',['a'])
        self.assertEqual(r['entries'][0]['replacementId'], 'e')
        self.assertEqual(r['entries'][0]['rank'], 'طوارئ')

    def test_emergency_allows_other_same_day_classes(self):
        p=self.school()
        p['slots'].append({'day':0,'period':1,'start':'07:45','end':'08:30'})
        p['teachers'][1]['blocked']=[0]
        p['teachers'][2]['blocked']=[0]
        p['teachers'][3]['blocked']=[0]
        p['teachers'].append({'id':'e','name':'e','blocked':[]})
        p['courses'].append({'id':'z','teacherId':'e','classId':'three','subject':'جغرافيا'})
        p['placements'].append({'courseId':'z','slot':1})
        p['standby']={'assignments':[{'teacherId':'b','slot':0,'rank':1},{'teacherId':'c','slot':0,'rank':2},{'teacherId':'d','slot':0,'rank':3}], 'signature':signature(p)}
        r=distribute(p,'2026-10-25',['a'])
        self.assertEqual(r['entries'][0]['replacementId'], 'e')
        self.assertEqual(r['entries'][0]['rank'], 'طوارئ')
    def test_emergency_prefers_lower_same_day_load(self):
        p=self.school()
        p['slots'].extend([
            {'day':0,'period':1,'start':'07:45','end':'08:30'},
            {'day':0,'period':2,'start':'08:30','end':'09:15'},
        ])
        p['teachers'][1]['blocked']=[0]
        p['teachers'][2]['blocked']=[0]
        p['teachers'][3]['blocked']=[0]
        p['teachers'].extend([{'id':'e','name':'e','blocked':[]},{'id':'f','name':'f','blocked':[]}])
        p['courses'].extend([
            {'id':'z','teacherId':'f','classId':'three','subject':'تاريخ'},
            {'id':'w','teacherId':'f','classId':'four','subject':'فيزياء'}
        ])
        p['placements'].extend([
            {'courseId':'z','slot':1},
            {'courseId':'w','slot':2}
        ])
        p['standby']={'assignments':[{'teacherId':'b','slot':0,'rank':1},{'teacherId':'c','slot':0,'rank':2},{'teacherId':'d','slot':0,'rank':3},{'teacherId':'e','slot':0,'rank':4},{'teacherId':'f','slot':0,'rank':5}], 'signature':signature(p)}
        r=distribute(p,'2026-10-25',['a'])
        self.assertEqual(r['entries'][0]['replacementId'], 'e')

    def test_emergency_balances_weekly_load_before_daily_load(self):
        p=self.school()
        p['teachers'][1]['blocked']=[0]
        p['teachers'][2]['blocked']=[0]
        p['teachers'][3]['blocked']=[0]
        p['teachers'].extend([
            {'id':'high','name':'نصاب مرتفع','max':24,'blocked':[]},
            {'id':'low','name':'نصاب منخفض','max':12,'blocked':[]},
        ])
        for period in range(1,9):
            p['slots'].append({'day':0,'period':period,'start':'08:00','end':'08:45'})
        p['courses'].extend([
            {'id':f'h{period}','teacherId':'high','classId':'one','subject':'مادة'} for period in range(1,7)
        ]+[
            {'id':f'l{period}','teacherId':'low','classId':'two','subject':'مادة'} for period in range(7,9)
        ])
        p['placements'].extend([
            {'courseId':f'h{period}','slot':period} for period in range(1,7)
        ]+[
            {'courseId':f'l{period}','slot':period} for period in range(7,9)
        ])
        p['standby']['signature']=signature(p)
        r=distribute(p,'2026-10-25',['a'])
        entry=r['entries'][0]
        self.assertEqual(entry['replacementId'],'low')
        self.assertIn('نصابه الحالي 2 من 12',entry['notes'])
        self.assertIn('الموازنة العادلة',entry['notes'])

    def test_legacy_emergency_entry_does_not_override_fair_emergency_choice(self):
        p=self.school()
        for teacher in p['teachers'][1:]:
            teacher['blocked']=[0]
        p['teachers'].extend([
            {'id':'high','name':'نصاب مرتفع','max':24,'blocked':[]},
            {'id':'low','name':'نصاب منخفض','max':12,'blocked':[]},
        ])
        for period in range(1,9):
            p['slots'].append({'day':0,'period':period,'start':'08:00','end':'08:45'})
        p['courses'].extend([
            {'id':f'h{period}','teacherId':'high','classId':'one','subject':'مادة'} for period in range(1,7)
        ]+[
            {'id':f'l{period}','teacherId':'low','classId':'two','subject':'مادة'} for period in range(7,9)
        ])
        p['placements'].extend([{'courseId':f'h{period}','slot':period} for period in range(1,7)]+[{'courseId':f'l{period}','slot':period} for period in range(7,9)])
        p['standby']['assignments'].append({'teacherId':'high','slot':0,'rank':'طوارئ','emergency':True})
        p['standby']['signature']=signature(p)
        record=distribute(p,'2026-10-25',['a'])
        self.assertEqual(record['entries'][0]['replacementId'],'low')
        self.assertFalse(any(item.get('rank')=='طوارئ' for item in p['standby']['assignments']))
    def test_cancel_absence_removes_teacher_and_waiters_from_record(self):
        p=self.school();record=distribute(p,'2026-10-25',['a','b']);p['absenceRecords']=[record]
        updated,_=cancel_absence(p,'2026-10-25',['a'])
        self.assertEqual([teacher['id'] for teacher in updated['absenceRecords'][0]['teachers']], ['b'])
        self.assertEqual([entry['absentId'] for entry in updated['absenceRecords'][0]['entries']], ['b'])
        updated2,_=cancel_absence(updated,'2026-10-25',['b'])
        self.assertEqual(updated2['absenceRecords'], [])

    def test_cancel_absence_cleans_legacy_emergency_standby_entries(self):
        p=self.school();record=distribute(p,'2026-10-25',['a']);p['absenceRecords']=[record]
        p['standby']['assignments'].append({'teacherId':'d','slot':0,'rank':'طوارئ','emergency':True})
        updated,_=cancel_absence(p,'2026-10-25',['a'])
        self.assertEqual(updated['absenceRecords'],[])
        self.assertFalse(any(item.get('rank')=='طوارئ' for item in updated['standby']['assignments']))
    def test_reconcile_missing_emergency_assignments(self):
        p=self.school();p['teachers'].append({'id':'e','name':'e','blocked':[]})
        p['standby']['signature']=signature(p)
        record=distribute(p,'2026-10-25',['a'])
        record['entries'][0]['replacementId']=None
        record['entries'][0]['replacementName']=''
        record['entries'][0]['rank']=None
        record['entries'][0]['rankLabel']=None
        record['entries'][0]['notes']='لم يكلف منتظر'
        fixed=reconcile_missing_emergency_assignments(p, record)
        self.assertIn(fixed['entries'][0]['replacementId'], {'b','c','d','e'})
        self.assertEqual(fixed['entries'][0]['rank'], 'طوارئ')
        self.assertIn('طوارئ', fixed['entries'][0]['notes'])

    def test_reconcile_missing_emergency_assignments_with_blank_id(self):
        p=self.school();p['teachers'].append({'id':'e','name':'e','blocked':[]})
        p['standby']['signature']=signature(p)
        record=distribute(p,'2026-10-25',['a'])
        record['entries'][0]['replacementId']=''
        record['entries'][0]['replacementName']=''
        record['entries'][0]['rank']=''
        record['entries'][0]['rankLabel']=''
        record['entries'][0]['notes']='لم يكلف منتظر'
        fixed=reconcile_missing_emergency_assignments(p, record)
        self.assertIn(fixed['entries'][0]['replacementId'], {'b','c','d','e'})
        self.assertEqual(fixed['entries'][0]['rank'], 'طوارئ')
        self.assertIn('طوارئ', fixed['entries'][0]['notes'])

    def test_imported_zero_waiting_quota_never_gets_emergency_cover(self):
        p=self.school()
        p['standby']['importedFromSmartTable']=True
        p['standby']['config']={'target':24,'excluded':[],'importedFromSmartTable':True}
        p['teachers'].append({'id':'zero','name':'مستثنى','blocked':[]})
        for teacher in p['teachers'][1:4]: teacher['blocked']=[0]
        p['standby']['signature']=signature(p)
        result=distribute(p,'2026-10-25',['a'])
        self.assertIsNone(result['entries'][0]['replacementId'])

    def test_reconcile_replaces_zero_quota_emergency_and_covers_multiple_periods(self):
        p=self.school()
        p['slots'].append({'day':0,'period':1,'start':'07:45','end':'08:30'})
        p['courses'].append({'id':'z','teacherId':'a','classId':'one','subject':'رياضيات'})
        p['placements'].append({'courseId':'z','slot':1})
        p['standby']['assignments'].extend([
            {'teacherId':'b','slot':1,'rank':1},
            {'teacherId':'c','slot':1,'rank':2},
        ])
        p['standby']['importedFromSmartTable']=True
        p['standby']['config']={'target':24,'excluded':[],'importedFromSmartTable':True}
        p['teachers'].append({'id':'zero','name':'مستثنى','blocked':[]})
        p['standby']['signature']=signature(p)
        record=distribute(p,'2026-10-25',['a'])
        for entry in record['entries']:
            entry.update({'replacementId':None,'replacementName':'','rank':None,'rankLabel':None})
        record['entries'][0].update({'replacementId':'zero','replacementName':'مستثنى','rank':'طوارئ','rankLabel':'طوارئ'})
        fixed=reconcile_missing_emergency_assignments(p,record)
        replacements=[entry['replacementId'] for entry in fixed['entries']]
        self.assertNotIn('zero',replacements)
        self.assertTrue(all(replacements))
    def test_stale_schedule_rejected(self):
        p=self.school();p['teachers'][0]['blocked']=[0]
        with self.assertRaises(ValueError):distribute(p,'2026-10-25',['a'])
    def test_one_section_per_absent_and_form_columns(self):
        p=self.school();r=distribute(p,'2026-10-25',['a','b']);markup=official_html(p,r)
        self.assertEqual(markup.count('<section class="officialSheet"'),2)
        self.assertIn('ما تم تنفيذه في حصة الانتظار',markup)
    def test_confirm_endpoint_saves_register_atomically(self):
        import json,tempfile,threading,urllib.request
        from pathlib import Path
        from unittest.mock import patch
        from http.server import ThreadingHTTPServer
        import server
        p=self.school();p['revision']=1
        with tempfile.TemporaryDirectory() as folder:
            state=Path(folder)/'project.json';state.write_text(json.dumps(p),encoding='utf-8')
            with patch.object(server,'STATE',state):
                http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
                thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
                try:
                    request=urllib.request.Request(f'http://127.0.0.1:{http.server_port}/api/absence-confirm',data=json.dumps({'project':p,'date':'2026-10-25','teacherIds':['a','b']}).encode(),headers={'Content-Type':'application/json'})
                    result=json.load(urllib.request.urlopen(request))
                    stored=json.loads(state.read_text(encoding='utf-8'))
                    self.assertEqual(stored['revision'],2)
                    self.assertEqual(len(stored['absenceRecords']),1)
                    self.assertEqual(len(result['record']['teachers']),2)
                finally:http.shutdown();http.server_close();thread.join()
    def test_official_date_uses_umm_al_qura_for_existing_records(self):
        from absence import hijri_date
        self.assertEqual(hijri_date('2026-10-25'),'١٤/٠٥/١٤٤٨')
        p=self.school();record=distribute(p,'2026-10-25',['a'])
        markup=official_html(p,record)
        self.assertIn('<b class="hijriDate" dir="rtl"><span>١٤</span>',markup)
        self.assertIn('<span>٠٥</span>',markup)
        self.assertIn('<span>١٤٤٨</span>',markup)
        self.assertNotIn('2026-10-25',markup)
        self.assertIn('</b> هـ،',markup)
if __name__=='__main__':unittest.main()
