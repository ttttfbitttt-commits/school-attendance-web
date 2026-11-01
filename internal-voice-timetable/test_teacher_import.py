import base64
import io
import unittest
import openpyxl
from teacher_import import teacher_preview


class TeacherImportTests(unittest.TestCase):
    def read_rows(self, rows, cover=False):
        workbook = openpyxl.Workbook()
        sheet = workbook.active
        if cover:
            sheet.append(['صفحة الغلاف'])
            sheet = workbook.create_sheet('بيانات')
        for row in rows:
            sheet.append(row)
        stream = io.BytesIO()
        workbook.save(stream)
        return teacher_preview(base64.b64encode(stream.getvalue()).decode())

    def test_extra_columns_reordered_and_automatic_short(self):
        result = self.read_rows([
            ['تقرير المعلمين'],
            ['الإسنادات', 'عدد الحصص', 'الاختصار', 'إسم المعلم'],
            ['لا يستورد', 18, 'اختصار خارجي', 'راشد ناصر الربيعي'],
        ], cover=True)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['max'], 18)
        self.assertEqual(result[0]['short'], 'راشد الربيعي')
        self.assertEqual(result[0]['blocked'], [])

    def test_two_columns(self):
        result = self.read_rows([['اسم المعلم', 'النصاب'], ['هشام فهد السهلي', 20]])
        self.assertEqual(result[0]['max'], 20)

    def test_missing_limit_does_not_guess(self):
        with self.assertRaises(ValueError):
            self.read_rows([['المعلم', 'الإسنادات'], ['راشد ناصر', 'رياضيات']])

    def test_duplicate_limit_headers_rejected(self):
        with self.assertRaises(ValueError):
            self.read_rows([['المعلم', 'النصاب', 'عدد الحصص'], ['راشد ناصر', 20, 12]])

    def test_fractional_limit_rejected(self):
        with self.assertRaises(ValueError):
            self.read_rows([['المعلم', 'النصاب'], ['راشد ناصر', 12.5]])


if __name__ == '__main__':
    unittest.main()
