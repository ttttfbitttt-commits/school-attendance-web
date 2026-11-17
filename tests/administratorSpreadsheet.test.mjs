import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import * as XLSX from 'xlsx'
import ts from 'typescript'
import { staffDigits } from '../src/staffSpreadsheetColumns.ts'

const source = fs.readFileSync(new URL('../src/administratorSpreadsheet.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const exports = {}
vm.runInNewContext(compiled, { exports, require: name => {
  if (name === 'xlsx') return XLSX
  if (name === './staffSpreadsheetColumns') return { staffDigits }
  throw new Error('Unexpected import: ' + name)
} })
const { parseAdministrators } = exports

test('selects the employee name instead of the earlier employee grade column', () => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['تقرير وزارة التعليم'], [],
    ['درجة الموظف', 'تاريخ الهوية', 'رقم الهوية', 'اسم الموظف', 'الجوال (هاتف التواصل)'],
    ['', '1440/01/01', '١٠٠٠٠٠٠٠٠٠', 'اسم تجريبي', '0555555555'],
  ]), 'التقرير')
  const result = parseAdministrators(book)
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'اسم تجريبي')
  assert.equal(result[0].identityNumber, '1000000000')
  assert.equal(result[0].phone, '0555555555')
})

test('supports earlier column names and leaves unrelated sheets alone', () => {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['تقرير']]), 'عنوان')
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['الاسم', 'السجل المدني', 'الهاتف'], ['مستخدم تجريبي', '1234567890', '0500000000'],
  ]), 'بيانات')
  const result = parseAdministrators(book)
  assert.equal(result.length, 1)
  assert.equal(result[0].name, 'مستخدم تجريبي')
  assert.equal(result[0].identityNumber, '1234567890')
})

test('reads the supplied ministry report without exposing personal data', { skip: !process.env.ADMIN_EXCEL_FIXTURE }, () => {
  const workbook = XLSX.read(fs.readFileSync(process.env.ADMIN_EXCEL_FIXTURE), { type: 'buffer' })
  const result = parseAdministrators(workbook)
  assert.equal(result.length, 6)
  assert.ok(result.every(row => row.name && row.identityNumber.length === 10 && row.phone))
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false, defval: '', blankrows: true })
  for (let index = 0; index < 6; index++) {
    assert.equal(result[index].name, String(rows[16 + index][31]).trim())
    assert.equal(result[index].identityNumber, staffDigits(rows[16 + index][30]))
    assert.equal(result[index].phone, String(rows[16 + index][10]).trim())
  }
})
