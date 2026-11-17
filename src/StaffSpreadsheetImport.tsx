import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import { FileUp, X } from 'lucide-react'
import { api } from './api'
import { identifyStaffColumn as identify, staffDigits as digits, type StaffColumn as Column } from './staffSpreadsheetColumns'

type Role = 'vice' | 'counselor'
type Grade = { grade: string; owner: string | null; label?: string }
type Row = { number: number; name: string; identityNumber: string; phone: string; grades: string[]; selected: boolean; saved: boolean; error: string }
const labels: Record<Column, string> = { name: 'الاسم', identityNumber: 'رقم الهوية أو السجل المدني', phone: 'رقم الجوال' }
const blankColumns = (): Record<Column, number> => ({ name: -1, identityNumber: -1, phone: -1 })

export function StaffSpreadsheetImport({ role, grades, existingIdentities, onImported }: { role: Role; grades: Grade[]; existingIdentities: string[]; onImported: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [sheets, setSheets] = useState<Array<{ name: string; rows: unknown[][] }>>([])
  const [sheetIndex, setSheetIndex] = useState(0)
  const [headerIndex, setHeaderIndex] = useState(0)
  const [columns, setColumns] = useState(blankColumns)
  const [rows, setRows] = useState<Row[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const roleLabel = role === 'vice' ? 'الوكلاء' : 'الموجّهين'
  const sheet = sheets[sheetIndex]
  const headers = sheet?.rows[headerIndex] || []
  const existing = useMemo(() => new Set(existingIdentities.map(digits)), [existingIdentities])
  const selected = rows.filter(row => row.selected && !row.saved)
  const updateRow = (number: number, patch: Partial<Row>) => setRows(current => current.map(row => row.number === number ? { ...row, ...patch, error: '' } : row))
  const detect = (nextSheets: typeof sheets, nextSheet: number, nextHeader: number) => {
    const header = nextSheets[nextSheet]?.rows[nextHeader] || []
    setSheetIndex(nextSheet); setHeaderIndex(nextHeader); setColumns({ name: identify(header, 'name'), identityNumber: identify(header, 'identityNumber'), phone: identify(header, 'phone') }); setRows([])
  }
  const readFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setMessage(''); setRows([])
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('حجم الملف يتجاوز 5 ميجابايت.')
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
      const nextSheets = book.SheetNames.map(name => {
        const worksheet = book.Sheets[name]
        const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null
        if (range && (range.e.r - range.s.r > 5000 || range.e.c - range.s.c > 150)) throw new Error('ورقة العمل كبيرة جدًا. يرجى تقليل الصفوف والأعمدة ثم إعادة الرفع.')
        return { name, rows: XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '', raw: false, blankrows: true }) }
      })
      if (!nextSheets.length || nextSheets.every(item => !item.rows.length)) throw new Error('الملف لا يحتوي على بيانات.')
      let best = { sheet: 0, row: 0, score: -1 }
      nextSheets.forEach((item, sheet) => item.rows.slice(0, 100).forEach((row, index) => {
        const score = (Object.keys(labels) as Column[]).filter(column => identify(row, column) >= 0).length
        if (score > best.score) best = { sheet, row: index, score }
      }))
      setSheets(nextSheets); detect(nextSheets, best.sheet, best.row)
      setMessage(best.score < 3 ? 'راجع صف العناوين وحدد الأعمدة غير المعروفة يدويًا.' : 'تعرّف النظام على الأعمدة. راجعها قبل المعاينة.')
    } catch (error) { setSheets([]); setMessage(error instanceof Error ? error.message : 'تعذرت قراءة ملف Excel.') }
  }
  const preview = () => {
    const values = Object.values(columns)
    if (values.some(value => value < 0) || new Set(values).size !== values.length) { setMessage('اختر ثلاثة أعمدة مختلفة للاسم والهوية والجوال.'); return }
    const result = (sheet?.rows.slice(headerIndex + 1) || []).map((row, index) => ({
      number: headerIndex + index + 2, name: String(row[columns.name] ?? '').trim(), identityNumber: digits(row[columns.identityNumber]), phone: digits(row[columns.phone]), grades: [], selected: false, saved: false, error: '',
    })).filter(row => row.name || row.identityNumber || row.phone)
    if (result.length > 500) { setMessage('الملف يحتوي على أكثر من 500 صف. يرجى تقسيمه إلى ملفات أصغر.'); return }
    setRows(result); setMessage(result.length ? 'حدد الأشخاص المطلوبين وعيّن مراحل كل شخص، ثم راجع بياناتهم قبل الإضافة.' : 'لم أجد صفوف بيانات بعد العناوين المختارة.')
  }
  const submit = async () => {
    if (!selected.length) { setMessage('حدد شخصًا واحدًا على الأقل.'); return }
    const ids = new Set<string>(), usedGrades = new Set<string>()
    for (const row of selected) {
      if (!row.name || row.identityNumber.length < 6 || !row.phone || !row.grades.length) { setMessage('أكمل الاسم والهوية والجوال والمراحل لكل شخص محدد.'); return }
      if (existing.has(row.identityNumber) || ids.has(row.identityNumber)) { setMessage('يوجد رقم هوية مكرر أو مسجل مسبقًا. راجع المحددين.'); return }
      ids.add(row.identityNumber)
      for (const grade of row.grades) {
        if (usedGrades.has(grade) || grades.some(option => option.grade === grade && option.owner)) { setMessage('إحدى المراحل محددة لأكثر من شخص أو مسندة مسبقًا.'); return }
        usedGrades.add(grade)
      }
    }
    setBusy(true); let succeeded = 0
    for (const row of selected) {
      try {
        const data = { name: row.name, identityNumber: row.identityNumber, phone: row.phone, grades: row.grades }
        if (role === 'vice') await api.createVicePrincipal(data)
        else await api.createStudentCounselor(data)
        succeeded++; setRows(current => current.map(item => item.number === row.number ? { ...item, saved: true, selected: false, error: '' } : item))
      } catch (error) {
        const code = error instanceof Error ? error.message : ''
        const reason = code.includes('identity_exists') ? 'الهوية مسجلة مسبقًا.' : code.includes('grade_taken') ? 'إحدى المراحل أُسندت لشخص آخر.' : 'تعذرت الإضافة؛ راجع البيانات وحاول مجددًا.'
        setRows(current => current.map(item => item.number === row.number ? { ...item, error: reason } : item))
      }
    }
    await onImported()
    setMessage(`تمت إضافة ${succeeded} من أصل ${selected.length}. راجع أي صف لم تتم إضافته. الحسابات تحتاج إلى تفعيل من السجل.`)
    setBusy(false)
  }
  return <>
    <button type="button" className="outline-button" onClick={() => { setOpen(true); setMessage('') }}><FileUp size={17} /> استيراد بيانات {roleLabel} من Excel</button>
    {open && <div className="counselor-dialog-backdrop"><section className="counselor-dialog" style={{ maxWidth: 900, width: 'min(96vw, 900px)', maxHeight: '90vh', overflowY: 'auto' }} dir="rtl">
      <header><h3>استيراد بيانات {roleLabel}</h3><button type="button" className="icon-button" aria-label="إغلاق" disabled={busy} onClick={() => setOpen(false)}><X size={18} /></button></header>
      <p>يدعم ملف بيانات المعلمين الذي يحتوي على الاسم والهوية والجوال. اختر الأشخاص المطلوبين وحدد مراحلهم؛ لن تُفعّل حساباتهم تلقائيًا.</p>
      <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={event => void readFile(event)} />
      <button type="button" className="outline-button" disabled={busy} onClick={() => input.current?.click()}><FileUp size={16} /> اختيار ملف Excel</button>
      {sheets.length > 0 && <div className="counselor-grade-section">
        <label>ورقة العمل<select value={sheetIndex} disabled={busy || rows.some(row => row.saved)} onChange={event => detect(sheets, Number(event.target.value), 0)}>{sheets.map((item, index) => <option key={item.name} value={index}>{item.name}</option>)}</select></label>
        <label>صف العناوين<select value={headerIndex} disabled={busy || rows.some(row => row.saved)} onChange={event => detect(sheets, sheetIndex, Number(event.target.value))}>{sheet.rows.slice(0, 100).map((row, index) => <option key={index} value={index}>الصف {index + 1}: {row.slice(0, 6).map(String).join(' | ').slice(0, 100)}</option>)}</select></label>
        {(Object.keys(labels) as Column[]).map(column => <label key={column}>{labels[column]}<select value={columns[column]} disabled={busy || rows.some(row => row.saved)} onChange={event => { setColumns(current => ({ ...current, [column]: Number(event.target.value) })); setRows([]) }}><option value={-1}>اختر العمود</option>{headers.map((header, index) => <option key={index} value={index}>{String(header || `عمود ${index + 1}`)}</option>)}</select></label>)}
        <button type="button" className="outline-button" disabled={busy || rows.some(row => row.saved)} onClick={preview}>معاينة البيانات</button>
      </div>}
      {message && <p className="teacher-notice" role="status">{message}</p>}
      {rows.length > 0 && <div className="teacher-account-list">{rows.map(row => {
        const duplicate = existing.has(row.identityNumber) && !row.saved
        return <article key={row.number} style={{ display: 'block' }}>
          <label><input type="checkbox" checked={row.selected} disabled={busy || row.saved || (duplicate && !row.selected)} onChange={event => updateRow(row.number, { selected: event.target.checked })} /> صف {row.number} {row.saved ? '— تمت الإضافة' : duplicate ? '— الهوية مسجلة مسبقًا' : ''}</label>
          <div className="counselor-grade-section"><label>الاسم<input value={row.name} disabled={busy || row.saved} onChange={event => updateRow(row.number, { name: event.target.value })} /></label><label>الهوية<input value={row.identityNumber} inputMode="numeric" disabled={busy || row.saved} onChange={event => updateRow(row.number, { identityNumber: digits(event.target.value) })} /></label><label>الجوال<input value={row.phone} inputMode="tel" disabled={busy || row.saved} onChange={event => updateRow(row.number, { phone: digits(event.target.value) })} /></label></div>
          {row.selected && <div className="counselor-grade-picker"><strong>المراحل المسؤولة:</strong>{grades.map(option => {
            const reserved = Boolean(option.owner) || rows.some(other => other.number !== row.number && other.selected && other.grades.includes(option.grade))
            return <label key={option.grade}><input type="checkbox" checked={row.grades.includes(option.grade)} disabled={busy || (reserved && !row.grades.includes(option.grade))} onChange={event => updateRow(row.number, { grades: event.target.checked ? [...row.grades, option.grade] : row.grades.filter(grade => grade !== option.grade) })} /> {option.label || option.grade}{option.owner ? ' (مسندة)' : ''}</label>
          })}{!grades.length && <p>استورد الطلاب أولًا لتظهر المراحل المتاحة.</p>}</div>}
          {row.error && <p className="teacher-notice error">{row.error}</p>}
        </article>
      })}</div>}
      <footer><button type="button" className="outline-button" disabled={busy} onClick={() => setOpen(false)}>إغلاق</button><button type="button" className="primary-button" disabled={busy || !selected.length} onClick={() => void submit()}>{busy ? 'جارٍ الإضافة…' : `إضافة المحددين (${selected.length})`}</button></footer>
    </section></div>}
  </>
}
