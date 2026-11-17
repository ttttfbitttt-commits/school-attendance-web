import test from 'node:test'
import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { identifyStaffColumn, staffDigits } from '../src/staffSpreadsheetColumns.ts'

test('finds teacher-style headers in an Excel workbook with a title row', () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['تقرير بيانات'],
    ['اسم المعلم', 'السجل المدني', 'رقم الجوال'],
    ['معلم تجريبي', '١٠٠٠٠٠٠٠٠٠', '٠٥٥٥٥٥٥٥٥٥'],
  ]), 'البيانات')
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const parsed = XLSX.read(bytes, { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(parsed.Sheets['البيانات'], { header: 1, raw: false, defval: '', blankrows: true })
  assert.equal(identifyStaffColumn(rows[1], 'name'), 0)
  assert.equal(identifyStaffColumn(rows[1], 'identityNumber'), 1)
  assert.equal(identifyStaffColumn(rows[1], 'phone'), 2)
  assert.equal(staffDigits(rows[2][1]), '1000000000')
  assert.equal(staffDigits(rows[2][2]), '0555555555')
})

test('handles alternate headings and leaves ambiguous columns for manual selection', () => {
  assert.equal(identifyStaffColumn(['اسم الموظف', 'رقم الهوية', 'الهاتف'], 'name'), 0)
  assert.equal(identifyStaffColumn(['اسم الموظف', 'رقم الهوية', 'الهاتف'], 'identityNumber'), 1)
  assert.equal(identifyStaffColumn(['اسم الموظف', 'رقم الهوية', 'الهاتف'], 'phone'), 2)
  assert.equal(identifyStaffColumn(['الاسم', 'اسم المعلم'], 'name'), -1)
  assert.equal(identifyStaffColumn(['اسم غير معروف'], 'phone'), -1)
  assert.equal(identifyStaffColumn(['اسم المعلم كاملًا', 'الرقم المدني', 'رقم الجوال للتواصل'], 'name'), 0)
  assert.equal(identifyStaffColumn(['اسم المعلم كاملًا', 'الرقم المدني', 'رقم الجوال للتواصل'], 'phone'), 2)
})
