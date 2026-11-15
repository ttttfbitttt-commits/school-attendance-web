import unittest
from asc_import import parse_asc, build_project
HEADER = b'MIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n'
HTML = '''<table><tr><td></td><td>الأحد</td><td>الاثنين</td></tr><tr><td>الشعبة</td><td>1</td><td>2</td><td>1</td><td>2</td></tr><tr><td>1/1</td><td>رياضيات<br>أحمد سالم</td><td></td><td>علوم<br>محمد علي</td><td></td></tr></table>'''
class AscTests(unittest.TestCase):
 def test_schedule_and_editable_names(self):
  p=parse_asc(HEADER+HTML.encode()); self.assertEqual((len(p['classes']),len(p['teachers']),len(p['lessons'])),(1,2,2))
  current={'slots':[{'day':0,'period':0,'start':'07:00','end':'07:45'}]}; r=build_project(p,current,{n:n+' كامل' for n in p['teachers']},{'1/1':'أول 1'})
  self.assertEqual(len(r['placements']),2); self.assertEqual(r['slots'][0]['start'],'07:00'); self.assertEqual(r['slots'][1]['start'],''); self.assertEqual(len(current['slots']),1)
 def test_conflicts_and_missing_names(self):
  p=parse_asc(HEADER+HTML.encode())
  with self.assertRaises(ValueError): build_project(p,{}, {},{'1/1':'أول 1'})
  p['lessons'].append({**p['lessons'][0],'className':'2/1'});p['classes'].append('2/1')
  with self.assertRaises(ValueError): build_project(p,{}, {n:n for n in p['teachers']},{'1/1':'أول 1','2/1':'أول 2'})
 def test_incomplete_cell(self):
  p=parse_asc(HEADER+HTML.replace('رياضيات<br>أحمد سالم','غير واضح').encode()); self.assertEqual(len(p['issues']),1)
  with self.assertRaises(ValueError): build_project(p,{}, {n:n for n in p['teachers']},{'1/1':'أول 1'})
 def test_wrong_format(self):
  with self.assertRaises(ValueError): parse_asc(b'not a timetable')
if __name__=='__main__':unittest.main()
