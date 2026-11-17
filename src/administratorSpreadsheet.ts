import * as XLSX from 'xlsx'
import { staffDigits } from './staffSpreadsheetColumns'

export type ImportedAdministrator = { name: string; identityNumber: string; phone: string }
const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[^\p{L}\p{N}]/gu, '')

// Prefer the complete column title. Matching the bare word "الموظف" as a
// substring incorrectly selects columns such as "درجة الموظف".
function column(headers: unknown[], names: string[]) {
  const values = headers.map(normalize)
  const keys = names.map(normalize)
  for (const key of keys) {
    const matches = values.flatMap((value, index) => value === key ? [index] : [])
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) return -1
  }
  const matches = values.flatMap((value, index) => value && keys.some(key => key.length >= 5 && value.startsWith(key)) ? [index] : [])
  return matches.length === 1 ? matches[0] : -1
}
const nameHeaders = ['اسم الموظف', 'الاسم الكامل', 'اسم الإداري', 'اسم المعلم', 'الاسم', 'الموظف']
const identityHeaders = ['رقم الهوية', 'رقم الهوية الوطنية', 'رقم السجل المدني', 'السجل المدني', 'الرقم المدني', 'الهوية', 'رقم الإقامة']
const phoneHeaders = ['رقم الجوال', 'الجوال', 'رقم الهاتف', 'الهاتف', 'هاتف التواصل', 'التواصل']

export function parseAdministrators(workbook: XLSX.WorkBook): ImportedAdministrator[] {
  const result: ImportedAdministrator[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false, blankrows: false })
    const headerIndex = rows.findIndex(row => column(row, nameHeaders) >= 0 && column(row, identityHeaders) >= 0)
    if (headerIndex < 0) continue
    const headers = rows[headerIndex], nameIndex = column(headers, nameHeaders)
    const identityIndex = column(headers, identityHeaders), phoneIndex = column(headers, phoneHeaders)
    for (const row of rows.slice(headerIndex + 1)) {
      const name = String(row[nameIndex] ?? '').replace(/\s+/g, ' ').trim()
      const identityNumber = staffDigits(row[identityIndex])
      const phone = phoneIndex < 0 ? '' : String(row[phoneIndex] ?? '').trim()
      if (name && identityNumber) result.push({ name, identityNumber, phone })
    }
  }
  return result
}
