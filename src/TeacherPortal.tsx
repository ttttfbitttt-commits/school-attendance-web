import { useEffect, useState } from 'react'
import { BookOpenCheck, Check, FileSpreadsheet, KeyRound, LogOut, Plus, Printer, Save, Trash2, UserRound } from 'lucide-react'
import { api, type Account, type TeacherLesson, type TeacherNote, type TeacherPortalDashboard, type TeacherPortalScheduleItem, type TeacherSheetColumn, type TeacherSheetConfig } from './api'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate } from './dateUtils'
import * as XLSX from 'xlsx'

const notes: TeacherNote[] = ['هروب من الحصة', 'نائم أثناء الدرس', 'لم يحل الواجب', 'لم يشارك', 'مشارك فعال', 'لم يحضر الكتاب أو المذكرة', 'استخدام الجوال أثناء الحصة']
const dayNames = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const periodLabel = (period: number) => `الحصة ${['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'][period] || period}`
const weekdayForDate = (value: string) => { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return day === 0 ? 1 : day + 1 }
const dateForWeekday = (value: string, weekday: number) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + weekday - weekdayForDate(value)); return date.toISOString().slice(0, 10) }

type StudentState = { status: 'present' | 'absent'; note: TeacherNote | ''; sheetValues: Record<string, string | number | boolean> }

const sheetTemplates: Array<{ label: string; columns: TeacherSheetColumn[] }> = [
  { label: 'متابعة', columns: [{ id: 'follow-up', label: 'المتابعة', type: 'choice', maxScore: null, choices: ['ممتاز', 'جيد', 'يحتاج متابعة'] }] },
  { label: 'واجبات 4 خانات', columns: [1, 2, 3, 4].map(number => ({ id: `homework-${number}`, label: `واجب ${number}`, type: 'score' as const, maxScore: 10, choices: [] })) },
  { label: 'اختبارات 4 خانات', columns: [1, 2, 3, 4].map(number => ({ id: `test-${number}`, label: `اختبار ${number}`, type: 'score' as const, maxScore: 10, choices: [] })) },
]

function TeacherSheetWizard({ sheets, onClose, onSaved }: { sheets: TeacherSheetConfig[]; onClose: () => void; onSaved: (config: TeacherSheetConfig) => void }) {
  const [subjectIndex, setSubjectIndex] = useState(() => Math.max(0, sheets.findIndex(sheet => sheet.version === 0)))
  const [columns, setColumns] = useState<TeacherSheetColumn[]>(() => sheets[Math.max(0, sheets.findIndex(sheet => sheet.version === 0))]?.columns || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const subject = sheets[subjectIndex]

  useEffect(() => { setColumns(subject?.columns || []); setError('') }, [subjectIndex, sheets])

  const applyTemplate = (template: TeacherSheetColumn[]) => setColumns(template.map(column => ({ ...column, id: `${column.id}-${Date.now()}-${Math.random()}` })))
  const updateColumn = (index: number, update: Partial<TeacherSheetColumn>) => setColumns(current => current.map((column, columnIndex) => columnIndex === index ? { ...column, ...update } : column))
  const addColumn = () => setColumns(current => [...current, { id: `column-${Date.now()}`, label: `خانة ${current.length + 1}`, type: 'text', maxScore: null, choices: [] }])
  const save = async () => {
    if (!subject || !columns.length) { setError('أضف خانة واحدة على الأقل قبل التأكيد.'); return }
    setBusy(true)
    setError('')
    try {
      const result = await api.saveTeacherSheetConfig(subject.subject, columns)
      onSaved(result.config)
      if (subjectIndex < sheets.length - 1) setSubjectIndex(current => current + 1)
      else onClose()
    } catch { setError('تعذر حفظ الكشف. تحقق من الاتصال ثم أعد المحاولة.') } finally { setBusy(false) }
  }

  if (!subject) return <section className="teacher-card teacher-sheet-wizard"><h2>كشوف المعلمين</h2><p className="teacher-empty">لا توجد مواد مسندة إلى حسابك حالياً.</p><button type="button" className="outline-button" onClick={onClose}>إغلاق</button></section>
  return <section className="teacher-card teacher-sheet-wizard">
    <div className="teacher-section-head"><div><span>إعداد الكشوف {subjectIndex + 1} من {sheets.length}</span><h2>{subject.subject}</h2><p>اختر قالباً جاهزاً أو عدّل الخانات ثم أكد للانتقال للمادة التالية.</p></div><button type="button" className="outline-button" onClick={onClose}>إغلاق</button></div>
    <div className="teacher-sheet-templates">{sheetTemplates.map(template => <button type="button" className="outline-button" key={template.label} onClick={() => applyTemplate(template.columns)}>{template.label}</button>)}</div>
    <div className="teacher-sheet-columns"><div className="teacher-sheet-columns-head"><strong>خانات الكشف</strong><button type="button" className="outline-button" onClick={addColumn}><Plus size={16} /> إضافة خانة</button></div>{columns.map((column, index) => <div className="teacher-sheet-column-row" key={column.id}><input value={column.label} onChange={event => updateColumn(index, { label: event.target.value })} aria-label={`اسم الخانة ${index + 1}`} /><select value={column.type} onChange={event => updateColumn(index, { type: event.target.value as TeacherSheetColumn['type'], maxScore: event.target.value === 'score' ? (column.maxScore ?? 10) : null })}><option value="score">درجة</option><option value="text">نص</option><option value="choice">اختيار</option><option value="boolean">نعم أو لا</option></select>{column.type === 'score' && <input className="teacher-sheet-score-input" type="number" min="0" max="1000" value={column.maxScore ?? 10} onChange={event => updateColumn(index, { maxScore: Number(event.target.value) })} aria-label="الدرجة العظمى" />}{column.type === 'choice' && <input value={column.choices.join('، ')} onChange={event => updateColumn(index, { choices: event.target.value.split('،').map(choice => choice.trim()).filter(Boolean) })} placeholder="الخيارات مفصولة بفاصلة" aria-label="خيارات الخانة" />}<button type="button" className="icon-button danger" onClick={() => setColumns(current => current.filter((_, columnIndex) => columnIndex !== index))} title="حذف الخانة"><Trash2 size={16} /></button></div>)}</div>
    {error && <p className="teacher-notice error" role="alert">{error}</p>}
    <button type="button" className="primary-button" onClick={() => void save()} disabled={busy}><Check size={17} /> {busy ? 'جارٍ الحفظ…' : subjectIndex < sheets.length - 1 ? 'تأكيد وحفظ والانتقال للمادة التالية' : 'تأكيد وحفظ الكشوف'}</button>
  </section>
}

export function TeacherPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [date, setDate] = useState(today())
  const [dashboard, setDashboard] = useState<TeacherPortalDashboard | null>(null)
  const [lesson, setLesson] = useState<TeacherLesson | null>(null)
  const [selected, setSelected] = useState<TeacherPortalScheduleItem | null>(null)
  const [states, setStates] = useState<Record<string, StudentState>>({})
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordChanged, setPasswordChanged] = useState(!account.mustChangePassword)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [sheets, setSheets] = useState<TeacherSheetConfig[]>([])
  const [showSheets, setShowSheets] = useState(false)
  const [activeLessonDate, setActiveLessonDate] = useState(date)

  const loadDashboard = async () => {
    setBusy('dashboard')
    setError('')
    try { setDashboard(await api.teacherDashboard(date)) } catch { setError('تعذر تحميل جدولك. اطلب من الإدارة التأكد من ربط حسابك بالجدول.') } finally { setBusy('') }
  }

  useEffect(() => { void loadDashboard() }, [date])
  useEffect(() => { void api.teacherSheets().then(result => setSheets(result.sheets)).catch(() => setSheets([])) }, [])

  const openLesson = async (item: TeacherPortalScheduleItem) => {
    setBusy(`lesson-${item.assignmentId}`)
    setError('')
    const targetDate = dateForWeekday(date, item.weekday)
    try {
      const next = await api.teacherLesson(item.classroomId, targetDate, item.periodNumber)
      setLesson(next)
      setSelected(item)
      setActiveLessonDate(targetDate)
      setStates(Object.fromEntries(next.students.map(student => [student.id, { status: student.status, note: student.note, sheetValues: student.sheetValues }])))
    } catch {
      setError('تعذر فتح طلاب الفصل. اطلب من الإدارة مطابقة الصف والفصل مع بيانات الطلاب أولًا.')
    } finally { setBusy('') }
  }

  const updateStudent = (studentId: string, update: Partial<StudentState>) => {
    setStates(current => ({ ...current, [studentId]: { ...current[studentId], ...update } }))
  }
  const updateSheetValue = (studentId: string, columnId: string, value: string | number | boolean) => setStates(current => {
    const state = current[studentId] || { status: 'present' as const, note: '' as const, sheetValues: {} }
    return { ...current, [studentId]: { ...state, sheetValues: { ...state.sheetValues, [columnId]: value } } }
  })
  const exportSheet = () => {
    if (!lesson || !selected) return
    const columns = lesson.sheetConfig?.columns || []
    const rows = [['الطالب', 'الحالة', 'الملاحظة', ...columns.map(column => column.label)], ...lesson.students.map(student => {
      const state = states[student.id] || { status: 'present' as const, note: '', sheetValues: {} }
      return [student.name, state.status === 'present' ? 'حاضر' : 'غائب', state.note || '', ...columns.map(column => state.sheetValues[column.id] ?? '')]
    })]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'الكشف')
    XLSX.writeFile(workbook, `كشف-${lesson.assignment.subject}-${activeLessonDate}.xlsx`)
  }
  const printSheet = () => {
    if (!lesson || !selected) return
    const columns = lesson.sheetConfig?.columns || []
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
    const rows = lesson.students.map(student => {
      const state = states[student.id] || { status: 'present' as const, note: '', sheetValues: {} }
      return `<tr><td>${escape(student.name)}</td><td>${state.status === 'present' ? 'حاضر' : 'غائب'}</td><td>${escape(state.note || '')}</td>${columns.map(column => `<td>${escape(state.sheetValues[column.id] ?? '')}</td>`).join('')}</tr>`
    }).join('')
    const popup = window.open('', '_blank')
    if (!popup) return
    popup.document.write(`<html dir="rtl"><head><title>كشف ${escape(lesson.assignment.subject)}</title><style>body{font-family:Arial,sans-serif;padding:24px}h1{font-size:20px}p{color:#475569}table{width:100%;border-collapse:collapse;direction:rtl}th,td{border:1px solid #94a3b8;padding:8px;text-align:right}th{background:#e2e8f0}@media print{@page{size:landscape;margin:10mm}}</style></head><body><h1>كشف ${escape(lesson.assignment.subject)} - ${escape(selected.classroom)}</h1><p>${escape(dayNames[selected.weekday])} · ${escape(formatHijriDate(activeLessonDate))}</p><table><thead><tr><th>الطالب</th><th>الحالة</th><th>الملاحظة</th>${columns.map(column => `<th>${escape(column.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }

  const saveLesson = async () => {
    if (!lesson || !selected) return
    setBusy('save')
    setNotice('')
    setError('')
    try {
      const result = await api.saveTeacherLesson({
        classroomId: selected.classroomId,
        date: activeLessonDate,
        periodNumber: selected.periodNumber,
        students: lesson.students.map(student => ({ studentId: student.id, ...(states[student.id] || { status: 'present', note: '', sheetValues: {} }) })),
      })
      setNotice(`تم حفظ متابعة ${result.saved} طالبًا. يُسجّل الحاضر بلا ملاحظة كمشارك فعال.`)
    } catch { setError('تعذر حفظ المتابعة. تحقق من اتصالك ثم أعد المحاولة.') } finally { setBusy('') }
  }

  const savePassword = async () => {
    if (password.length < 8 || password !== passwordConfirm) { setError('اكتب كلمة مرور من 8 أحرف على الأقل، وتأكد من تطابقها.'); return }
    setBusy('password')
    try {
      await api.changeTeacherPassword(password)
      setPassword('')
      setPasswordConfirm('')
      setPasswordChanged(true)
      setNotice('تم حفظ كلمة المرور الجديدة.')
    } catch { setError('تعذر تغيير كلمة المرور.') } finally { setBusy('') }
  }


  return <main className="teacher-portal" dir="rtl">
    <header className="teacher-topbar">
      <div><span>بوابة المعلم</span><h1>{dashboard?.schoolName || 'نظام حصر الطلاب'}</h1></div>
      <div className="teacher-topbar-actions"><button className="primary-button" onClick={() => setShowSheets(true)}><BookOpenCheck size={17} /> {sheets.some(sheet => sheet.version === 0) ? 'إعداد الكشوف' : 'إعادة بناء الكشوف'}</button><button className="outline-button" onClick={onLogout}><LogOut size={17} /> تسجيل الخروج</button></div>
    </header>
    <section className="teacher-welcome">
      <div><UserRound size={27} /><div><strong>{dashboard?.teacher.name || account.displayName}</strong><small>يعرض هذا الحساب جدولك وطلاب فصولك فقط.</small></div></div>
      <HijriDatePicker label="التاريخ الهجري" value={date} max={today()} onChange={value => { setDate(value); setLesson(null); setSelected(null) }} />
    </section>

    {!passwordChanged && <section className="teacher-security-card">
      <div><KeyRound size={22} /><div><h2>غيّر كلمة المرور المؤقتة</h2><p>لا يمكن استخدام بوابة المعلم قبل اختيار كلمة مرورك الخاصة.</p></div></div>
      <div className="teacher-password-form"><input type="password" placeholder="كلمة المرور الجديدة" value={password} onChange={event => setPassword(event.target.value)} /><input type="password" placeholder="تأكيد كلمة المرور" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} /><button onClick={() => void savePassword()} disabled={busy === 'password'}>حفظ كلمة المرور</button></div>
    </section>}

    {notice && <div className="teacher-notice success">{notice}</div>}
    {error && <div className="teacher-notice error">{error}</div>}
    {showSheets && <TeacherSheetWizard sheets={sheets} onClose={() => setShowSheets(false)} onSaved={config => setSheets(current => current.map(sheet => sheet.subject === config.subject ? config : sheet))} />}

    <section className="teacher-card">
      <div className="teacher-section-head"><div><span>الجدول الكامل</span><h2>{formatHijriDate(date)}</h2></div><BookOpenCheck size={26} /></div>
      {busy === 'dashboard' ? <p className="teacher-empty">جارٍ تحميل الجدول…</p> : !dashboard?.weekSchedule.length ? <p className="teacher-empty">لا توجد حصص مسندة لك.</p> : <div className="teacher-schedule-grid">
        {dashboard.weekSchedule.map(item => <button key={item.assignmentId} className={`teacher-schedule-card ${selected?.assignmentId === item.assignmentId ? 'selected' : ''}`} onClick={() => void openLesson(item)}>
          <strong>{dayNames[item.weekday]} · {periodLabel(item.periodNumber)}</strong><span>{item.classroom}</span><small>{item.subject || 'بدون مادة محددة'}{item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : ''}</small>
        </button>)}
      </div>}
    </section>

    {lesson && selected && <section className="teacher-card teacher-roster-card">
      <div className="teacher-section-head"><div><span>{lesson.assignment.subject} · {lesson.mapping.grade} · الفصل {lesson.mapping.classroom}</span><h2>{dayNames[selected.weekday]} · {periodLabel(selected.periodNumber)} — {selected.classroom}</h2></div><div className="teacher-report-actions"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={() => void saveLesson()} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ الكشف'}</button></div></div>
      <p className="teacher-help">اختيار الحالة والملاحظة هنا خاص بمتابعة المعلم، ولا يغيّر سجل الحضور والغياب الإداري.</p>
      <div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>الطالب</th><th>الحالة</th><th>الملاحظة</th>{lesson.sheetConfig?.columns.map(column => <th key={column.id}>{column.label}{column.type === 'score' && column.maxScore !== null ? ` / ${column.maxScore}` : ''}</th>)}</tr></thead><tbody>
        {lesson.students.map(student => { const state = states[student.id] || { status: 'present' as const, note: '' as const }; return <tr key={student.id}>
          <td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>
          <td><div className="teacher-status-toggle"><button className={state.status === 'present' ? 'active present' : ''} onClick={() => updateStudent(student.id, { status: 'present' })}>حاضر</button><button className={state.status === 'absent' ? 'active absent' : ''} onClick={() => updateStudent(student.id, { status: 'absent', note: '' })}>غائب</button></div></td>
          <td><select value={state.note} disabled={state.status === 'absent'} onChange={event => updateStudent(student.id, { note: event.target.value as TeacherNote | '' })}><option value="">مشارك فعال عند الحفظ</option>{notes.map(note => <option key={note} value={note}>{note}</option>)}</select></td>
          {lesson.sheetConfig?.columns.map(column => <td key={column.id} className="teacher-sheet-cell">{column.type === 'score' && <input type="number" min="0" max={column.maxScore ?? undefined} value={String(state.sheetValues[column.id] ?? '')} onChange={event => updateSheetValue(student.id, column.id, event.target.value)} aria-label={`${column.label} لـ ${student.name}`} />}{column.type === 'text' && <input value={String(state.sheetValues[column.id] ?? '')} onChange={event => updateSheetValue(student.id, column.id, event.target.value)} aria-label={`${column.label} لـ ${student.name}`} />}{column.type === 'choice' && <select value={String(state.sheetValues[column.id] ?? '')} onChange={event => updateSheetValue(student.id, column.id, event.target.value)} aria-label={`${column.label} لـ ${student.name}`}><option value="">اختر</option>{column.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select>}{column.type === 'boolean' && <input type="checkbox" checked={state.sheetValues[column.id] === true} onChange={event => updateSheetValue(student.id, column.id, event.target.checked)} aria-label={`${column.label} لـ ${student.name}`} />}</td>)}
        </tr> })}
      </tbody></table></div>
      <div className="teacher-roster-save-bottom"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={() => void saveLesson()} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ الكشف'}</button></div>
    </section>}
  </main>
}
