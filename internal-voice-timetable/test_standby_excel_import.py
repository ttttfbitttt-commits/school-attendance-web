import copy
import tempfile
import unittest
from pathlib import Path
from openpyxl import Workbook
from standby_excel_import import parse_waiting_workbook, preview_waiting_import, apply_waiting_import
from standby import signature

class WaitingImportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'waiting.xlsx'
        workbook = Workbook(); sheet = workbook.active
        for row in [
            ['الأحد'], ['الانتظار', 'الحصة 1', 'الحصة 2'],
            ['انتظار 1', 'أحمد صالح', 'خالد سالم'], ['انتظار 2', 'شاغر', 'أحمد صالح'],
        ]: sheet.append(row)
        workbook.save(self.path)
        self.project = {'days': [{'name': 'الأحد'}], 'slots': [{'day': 0, 'period': 0}, {'day': 0, 'period': 1}],
                        'teachers': [{'id': 'a', 'name': 'أحمد محمد صالح', 'short': 'أحمد صالح', 'blocked': []},
                                     {'id': 'b', 'name': 'خالد حسن سالم', 'short': 'خالد سالم', 'blocked': []}],
                        'courses': [{'id': 'c', 'teacherId': 'b', 'classId': 'class'}],
                        'placements': [{'courseId': 'c', 'slot': 0}], 'absenceRecords': [{'id': 'old'}],
                        'standby': {'config': {'target': 20, 'excluded': []}, 'assignments': [{'slot': 1, 'teacherId': 'a', 'rank': 1}]}}
    def tearDown(self): self.tmp.cleanup()

    def test_preserves_file_order_gaps_and_old_data(self):
        original = copy.deepcopy(self.project)
        parsed = parse_waiting_workbook(self.path)
        self.assertEqual(len(parsed['entries']), 3)
        preview = preview_waiting_import(self.project, parsed)
        self.assertEqual((preview['unmatched'], preview['issues']), (0, []))
        candidate = apply_waiting_import(self.project, preview)
        self.assertEqual([(r['slot'], r['teacherId'], r['rank']) for r in candidate['standby']['assignments']], [(0,'a',1), (1,'b',1), (1,'a',2)])
        self.assertEqual(candidate['standby']['signature'], signature(candidate))
        self.assertEqual(candidate['standby']['quotas'], {'a': 2, 'b': 1})
        self.assertEqual(candidate['standby']['importedSlotTargets'], {'0': 2, '1': 2})
        self.assertEqual(candidate['absenceRecords'], original['absenceRecords'])
        self.assertEqual(candidate['standby']['previousImportBackup'], original['standby'])
        self.assertEqual(self.project, original)

    def test_ambiguous_names_require_selection(self):
        self.project['teachers'].append({'id': 'c', 'name': 'أحمد علي صالح', 'short': 'أحمد صالح', 'blocked': []})
        parsed = parse_waiting_workbook(self.path)
        preview = preview_waiting_import(self.project, parsed)
        self.assertEqual(preview['unmatched'], 1)
        with self.assertRaises(ValueError): apply_waiting_import(self.project, preview)
        resolved = preview_waiting_import(self.project, parsed, {'أحمد صالح': 'a', 'خالد سالم': 'b'})
        self.assertEqual(resolved['unmatched'], 0)
        self.assertFalse(resolved['issues'])

    def test_teaching_conflict_and_exclusion_prevent_approval(self):
        self.project['courses'][0]['teacherId'] = 'a'
        self.project['standby']['config']['excluded'] = ['b']
        preview = preview_waiting_import(self.project, parse_waiting_workbook(self.path))
        self.assertTrue(any('حصة' in issue for issue in preview['issues']))
        self.assertTrue(any('مستثنى' in issue for issue in preview['issues']))
        with self.assertRaises(ValueError): apply_waiting_import(self.project, preview)

    def test_unknown_period_is_not_dropped(self):
        self.project['slots'].pop()
        preview = preview_waiting_import(self.project, parse_waiting_workbook(self.path))
        self.assertTrue(any('لا توجد حصة' in issue for issue in preview['issues']))
        with self.assertRaises(ValueError): apply_waiting_import(self.project, preview)

if __name__ == '__main__':
    unittest.main()
