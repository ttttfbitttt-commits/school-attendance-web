import io
import unittest
from openpyxl import load_workbook
from excel_timetable import export_timetable
P={'days':[{'name':'الأحد'}], 'slots':[{'day':0,'period':0}], 'teachers':[{'id':'t','name':'معلم'}], 'classes':[{'id':'c','name':'فصل'}], 'courses':[{'id':'x','teacherId':'t','classId':'c','subject':'=1+1'}], 'placements':[{'courseId':'x','slot':0}]}
class Tests(unittest.TestCase):
 def test_four_formats(self):
  for kind in ('teachers-general','classes-general','teachers-individual','classes-individual'):
   sheet=load_workbook(io.BytesIO(export_timetable(P,kind))).active
   self.assertTrue(sheet.sheet_view.rightToLeft); self.assertTrue(sheet['B3'].value.startswith("'")); self.assertNotEqual(sheet['B3'].data_type,'f')
 def test_conflicts(self):
  with self.assertRaises(ValueError): export_timetable({**P,'placements':P['placements']*2},'teachers-general')
if __name__=='__main__': unittest.main()
