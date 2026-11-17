export type StaffColumn = 'name' | 'identityNumber' | 'phone'
const aliases: Record<StaffColumn, string[]> = {
  name: ['الاسم', 'اسمالمعلم', 'اسمالموظف', 'اسمالموجه', 'اسمالوكيل', 'الاسمالكامل', 'fullname', 'name'],
  identityNumber: ['رقمالهويه', 'رقمالهوية', 'الهويه', 'السجلالمدني', 'الرقمالمدني', 'رقمالاقامه', 'رقمالإقامة', 'identitynumber', 'nationalid'],
  phone: ['رقمالجوال', 'الجوال', 'رقمالهاتف', 'الهاتف', 'المحمول', 'رقمالاتصال', 'التواصل', 'mobile', 'phone'],
}
const normalize = (value: unknown) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[^\p{L}\p{N}]/gu, '')
export const staffDigits = (value: unknown) => String(value ?? '').replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit))).replace(/\D/g, '')
export const identifyStaffColumn = (headers: unknown[], column: StaffColumn) => {
  const normalized = headers.map((header, index) => ({ index, value: normalize(header) }))
  const exact = normalized.filter(({ value }) => value && aliases[column].some(alias => value === normalize(alias)))
  if (exact.length) return exact.length === 1 ? exact[0].index : -1
  const approximate = normalized.filter(({ value }) => value && aliases[column].some(alias => { const key = normalize(alias); return key.length >= 5 && value.startsWith(key) }))
  return approximate.length === 1 ? approximate[0].index : -1
}
