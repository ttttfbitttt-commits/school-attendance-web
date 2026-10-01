import { useEffect, useState } from 'react'
import { BarChart3, BookOpenCheck, Check, Copy, FileSpreadsheet, KeyRound, LayoutDashboard, LogOut, Menu, Plus, Printer, Save, Trash2, UserRound, X } from 'lucide-react'
import { api, type Account, type TeacherLesson, type TeacherLessonReport, type TeacherNote, type TeacherPortalDashboard, type TeacherPortalScheduleItem, type TeacherSheetColumn, type TeacherSheetConfig } from './api'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate } from './dateUtils'
import * as XLSX from 'xlsx'

const notes: TeacherNote[] = ['هروب من الحصة', 'نائم أثناء الدرس', 'لم يحل الواجب', 'لم يشارك', 'مشارك فعال', 'لم يحضر الكتاب أو المذكرة', 'استخدام الجوال أثناء الحصة']
const dayNames = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const periodLabel = (period: number) => `الحصة ${['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'][period] || period}`

type StudentState = { status: 'present' | 'absent'; note: TeacherNote | ''; sheetValues: Record<string, string | number | boolean> }
type TeacherTab = 'home' | 'sheets' | 'reports' | 'password'

const blankColumns = (count: number, prefix = 'خانة'): TeacherSheetColumn[] => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}-${Date.now()}`, label: `${prefix} ${index + 1}`, type: 'text', maxScore: null, choices: [] }))
const sheetTemplates: Array<{ label: string; columns: TeacherSheetColumn[] }> = [
  { label: 'كشف مفرغ 5 خانات', columns: blankColumns(5) },
  { label: 'كشف واجبات 4', columns: [1, 2, 3, 4].map(number => ({ id: `homework-${number}`, label: `الواجب ${number}`, type: 'choice' as const, maxScore: null, choices: ['حل الواجب', 'لم يحل الواجب'] })) },
  { label: 'كشف اختبارات 4', columns: [1, 2, 3, 4].map(number => ({ id: `test-${number}`, label: `اختبار ${number}`, type: 'score' as const, maxScore: 10, choices: [] })) },
]

function TeacherSheetsSetup({ sheets, onSaved }: { sheets: TeacherSheetConfig[]; onSaved: (config: TeacherSheetConfig) => void }) {
  const [subjectIndex, setSubjectIndex] = useState(() => Math.max(0, sheets.findIndex(sheet => sheet.version === 0)))
  const [columns, setColumns] = useState<TeacherSheetColumn[]>(() => sheets[Math.max(0, sheets.findIndex(sheet => sheet.version === 0))]?.columns || blankColumns(5))
  const [copySubject, setCopySubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const subject = sheets[subjectIndex]
  useEffect(() => { setColumns(subject?.columns?.length ? subject.columns : blankColumns(5)); setCopySubject(''); setError('') }, [subjectIndex, sheets])
  const updateColumn = (index: number, update: Partial<TeacherSheetColumn>) => setColumns(current => current.map((column, columnIndex) => columnIndex === index ? { ...column, ...update } : column))
  const save = async () => {
    if (!subject || !columns.length) { setError('أضف خانة واحدة على الأقل قبل الحفظ.'); return }
    setBusy(true); setError('')
    try { const result = await api.saveTeacherSheetConfig(subject.subject, columns); onSaved(result.config); if (subjectIndex < sheets.length - 1) setSubjectIndex(current => current + 1) } catch { setError('تعذر حفظ تصميم الكشف. تحقق من الاتصال ثم أعد المحاولة.') } finally { setBusy(false) }
  }
  if (!subject) return <p className="teacher-empty">لا توجد مواد مسندة إلى حسابك.</p>
  return <div className="teacher-sheet-setup">
    <div className="teacher-sheet-subjects">{sheets.map((item, index) => <button type="button" key={item.subject} className={index === subjectIndex ? 'active' : ''} onClick={() => setSubjectIndex(index)}>{item.subject}<small>{item.version ? `جاهز · إصدار ${item.version}` : 'لم يُجهز بعد'}</small></button>)}</div>
    <div className="teacher-sheet-setup-head"><div><span>إعداد كشف المادة {subjectIndex + 1} من {sheets.length}</span><h3>{subject.subject}</h3></div><span className="teacher-sheet-count">{columns.length} من 30 خانة</span></div>
    <div className="teacher-sheet-actions"><strong>قوالب جاهزة</strong>{sheetTemplates.map(template => <button type="button" className="outline-button" key={template.label} onClick={() => setColumns(template.columns.map(column => ({ ...column, id: `${column.id}-${Date.now()}-${Math.random()}` })))}>{template.label}</button>)}<label className="teacher-sheet-copy"><Copy size={15} /> نسخ تصميم من مادة<select value={copySubject} onChange={event => { const source = sheets.find(sheet => sheet.subject === event.target.value); setCopySubject(event.target.value); if (source?.columns.length) setColumns(source.columns.map(column => ({ ...column, id: `${column.id}-${Date.now()}-${Math.random()}` }))) }}><option value="">اختر مادة</option>{sheets.filter(item => item.subject !== subject.subject && item.columns.length).map(item => <option key={item.subject} value={item.subject}>{item.subject}</option>)}</select></label></div>
    <div className="teacher-sheet-columns-head"><strong>أعمدة كشف {subject.subject}</strong><button type="button" className="outline-button" onClick={() => columns.length < 30 && setColumns(current => [...current, ...blankColumns(1, 'خانة')])} disabled={columns.length >= 30}><Plus size={16} /> إضافة عمود</button></div>
    <div className="teacher-sheet-columns">{columns.map((column, index) => <div className="teacher-sheet-column-row" key={column.id}><input value={column.label} onChange={event => updateColumn(index, { label: event.target.value })} aria-label={`اسم العمود ${index + 1}`} /><select value={column.type} onChange={event => updateColumn(index, { type: event.target.value as TeacherSheetColumn['type'], maxScore: event.target.value === 'score' ? (column.maxScore ?? 10) : null })}><option value="score">درجة</option><option value="text">نص</option><option value="choice">اختيار</option><option value="boolean">صح أو خطأ</option></select>{column.type === 'score' && <input className="teacher-sheet-score-input" type="number" min="0" max="1000" value={column.maxScore ?? 10} onChange={event => updateColumn(index, { maxScore: Number(event.target.value) })} aria-label="الدرجة العظمى" />}{column.type === 'choice' && <input value={column.choices.join('، ')} onChange={event => updateColumn(index, { choices: event.target.value.split('،').map(choice => choice.trim()).filter(Boolean) })} placeholder="الخيارات مفصولة بفاصلة" aria-label="خيارات العمود" />}<button type="button" className="icon-button danger" onClick={() => setColumns(current => current.filter((_, columnIndex) => columnIndex !== index))} title="حذف العمود"><Trash2 size={16} /></button></div>)}</div>
    {error && <p className="teacher-notice error" role="alert">{error}</p>}<button type="button" className="primary-button" onClick={() => void save()} disabled={busy}><Check size={17} /> {busy ? 'جارٍ الحفظ…' : subjectIndex < sheets.length - 1 ? 'تأكيد والانتقال للمادة التالية' : 'حفظ تصميم الكشوف'}</button>
  </div>
}

function TeacherSheetStart({ sheets, schedule, onOpen }: { sheets: TeacherSheetConfig[]; schedule: TeacherPortalScheduleItem[]; onOpen: (item: TeacherPortalScheduleItem) => void }) {
  const [subject, setSubject] = useState(sheets[0]?.subject || '')
  const [classroomId, setClassroomId] = useState('')
  const classrooms = schedule.filter(item => item.subject === subject)
  const config = sheets.find(sheet => sheet.subject === subject)
  useEffect(() => { setClassroomId(classrooms[0]?.classroomId || '') }, [subject, schedule.length])
  const selected = classrooms.find(item => item.classroomId === classroomId)
  return <div className="teacher-sheet-start">
    <div className="teacher-sheet-selectors"><label>المادة<select value={subject} onChange={event => setSubject(event.target.value)}><option value="">اختر المادة</option>{sheets.map(sheet => <option key={sheet.subject} value={sheet.subject}>{sheet.subject}</option>)}</select></label><label>الفصل<select value={classroomId} onChange={event => setClassroomId(event.target.value)} disabled={!classrooms.length}><option value="">اختر الفصل</option>{classrooms.map(item => <option key={item.classroomId} value={item.classroomId}>{item.classroom}</option>)}</select></label><label>نوع الكشف<select value={config?.subject || ''} disabled><option value={config?.subject || ''}>{config?.version ? 'الكشف المعتمد للمادة' : 'لم يتم إعداد كشف بعد'}</option></select></label></div>
    {!classrooms.length && subject && <p className="teacher-empty">لا توجد حصة لهذه المادة في جدول اليوم.</p>}
    {selected && <button type="button" className="primary-button" onClick={() => onOpen(selected)}><BookOpenCheck size={17} /> فتح كشف {selected.subject} · {selected.classroom}</button>}
  </div>
}

function TeacherReportsTab() {
  const [date, setDate] = useState(today())
  const [reports, setReports] = useState<TeacherLessonReport[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async (value = date) => { setBusy(true); setError(''); try { setReports((await api.teacherReports({ date: value })).reports) } catch { setError('تعذر تحميل تقارير المتابعة.') } finally { setBusy(false) } }
  useEffect(() => { void load() }, [date])
  const exportReports = () => {
    const rows = [['المادة', 'الفصل', 'التاريخ', 'الحصة', 'الطالب', 'الحالة', 'الملاحظة'], ...reports.flatMap(report => report.records.map(record => [report.subject, report.classroom, report.date, report.periodNumber, record.name, record.status === 'present' ? 'حاضر' : 'غائب', record.note || '']))]
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'التقارير'); XLSX.writeFile(workbook, `تقارير-المتابعة-${date}.xlsx`)
  }
  return <section className="teacher-card"><div className="teacher-section-head"><div><span>تقارير المتابعة</span><h2>التقارير</h2><p>اعرض حصص المتابعة حسب التاريخ وصدّرها عند الحاجة.</p></div><BarChart3 size={30} /></div><div className="teacher-report-filters"><HijriDatePicker label="تاريخ التقرير الهجري" value={date} max={today()} onChange={setDate} /><div className="teacher-report-actions"><button type="button" className="outline-button" onClick={exportReports} disabled={!reports.length}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="primary-button" onClick={() => void load()} disabled={busy}>{busy ? 'جارٍ التحميل…' : 'تحديث التقارير'}</button></div></div>{error && <p className="teacher-notice error">{error}</p>}{busy ? <p className="teacher-empty">جارٍ تحميل التقارير…</p> : !reports.length ? <p className="teacher-empty">لا توجد تقارير متابعة لهذا التاريخ.</p> : <div className="teacher-report-list">{reports.map(report => <article key={report.id}><div><strong>{report.subject || 'مادة غير محددة'} · {report.classroom}</strong><span>{formatHijriDate(report.date)} · {periodLabel(report.periodNumber)} · {report.studentsCount} طالب · {report.presentCount} حاضر · {report.absentCount} غائب</span></div></article>)}</div>}</section>
}

export function TeacherPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [date, setDate] = useState(today())
  const [dashboard, setDashboard] = useState<TeacherPortalDashboard | null>(null)
  const [lesson, setLesson] = useState<TeacherLesson | null>(null)
  const [selected, setSelected] = useState<TeacherPortalScheduleItem | null>(null)
  const [states, setStates] = useState<Record<string, StudentState>>({})
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [activeTab, setActiveTab] = useState<TeacherTab>('home')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sheets, setSheets] = useState<TeacherSheetConfig[]>([])
  const [sheetMode, setSheetMode] = useState<'menu' | 'setup' | 'start'>('menu')

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
    try {
      const next = await api.teacherLesson(item.classroomId, date, item.periodNumber)
      setLesson(next)
      setSelected(item)
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
    XLSX.writeFile(workbook, `كشف-${lesson.assignment.subject}-${date}.xlsx`)
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
    popup.document.write(`<html dir="rtl"><head><title>كشف ${escape(lesson.assignment.subject)}</title><style>body{font-family:Arial,sans-serif;padding:18px}table{width:100%;border-collapse:collapse;direction:rtl}th,td{border:1px solid #94a3b8;padding:7px;text-align:right}th{background:#e2e8f0}@media print{@page{size:A4 landscape;margin:10mm}}</style></head><body><h2>كشف ${escape(lesson.assignment.subject)} - ${escape(selected.classroom)}</h2><p>${escape(formatHijriDate(date))}</p><table><thead><tr><th>الطالب</th><th>الحالة</th><th>الملاحظة</th>${columns.map(column => `<th>${escape(column.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>window.print()</script></body></html>`)
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
        date,
        periodNumber: selected.periodNumber,
        students: lesson.students.map(student => ({ studentId: student.id, ...(states[student.id] || { status: 'present', note: '', sheetValues: {} }) })),
      })
      setNotice(`تم حفظ متابعة ${result.saved} طالبًا. يُسجّل الحاضر بلا ملاحظة كمشارك فعال.`)
    } catch { setError('تعذر حفظ المتابعة. تحقق من اتصالك ثم أعد المحاولة.') } finally { setBusy('') }
  }

  const savePassword = async () => {
    if (password.length < 8 || password !== passwordConfirm) { setError('اكتب كلمة مرور من 8 أحرف على الأقل، وتأكد من تطابقها.'); return }
    setBusy('password')
    setError('')
    setNotice('')
    try {
      await api.changeTeacherPassword(password)
      setPassword('')
      setPasswordConfirm('')
      setNotice('تم حفظ كلمة المرور الجديدة.')
    } catch { setError('تعذر تغيير كلمة المرور.') } finally { setBusy('') }
  }


  const navigate = (tab: TeacherTab) => { setActiveTab(tab); setMobileNavOpen(false); setLesson(null); setSelected(null) }
  return <main className="teacher-portal" dir="rtl">
    <button type="button" className="teacher-mobile-nav-button" onClick={() => setMobileNavOpen(true)} aria-label="فتح قائمة بوابة المعلم"><Menu size={20} /></button>
    <aside className={`teacher-sidebar ${mobileNavOpen ? 'open' : ''}`}>
      <div className="teacher-sidebar-brand"><BookOpenCheck size={24} /><div><strong>بوابة المعلم</strong><small>{dashboard?.teacher.name || account.displayName}</small></div><button type="button" className="teacher-sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="إغلاق القائمة"><X size={19} /></button></div>
      <nav className="teacher-sidebar-nav" aria-label="أقسام بوابة المعلم">
        <button type="button" className={activeTab === 'home' ? 'active' : ''} onClick={() => navigate('home')}><LayoutDashboard size={18} /> الرئيسية</button>
        <button type="button" className={activeTab === 'sheets' ? 'active' : ''} onClick={() => navigate('sheets')}><FileSpreadsheet size={18} /> الكشوف</button>
        <button type="button" className={activeTab === 'reports' ? 'active' : ''} onClick={() => navigate('reports')}><BarChart3 size={18} /> التقارير</button>
        <button type="button" className={activeTab === 'password' ? 'active' : ''} onClick={() => navigate('password')}><KeyRound size={18} /> كلمة المرور</button>
      </nav>
      <button type="button" className="teacher-sidebar-logout" onClick={onLogout}><LogOut size={18} /> تسجيل الخروج</button>
    </aside>
    {mobileNavOpen && <button type="button" className="teacher-sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="إغلاق القائمة" />}
    <div className="teacher-workspace">
    <header className="teacher-topbar">
      <div><span>بوابة المعلم</span><h1>{dashboard?.schoolName || 'نظام حصر الطلاب'}</h1></div>
      <button className="outline-button teacher-topbar-logout" onClick={onLogout}><LogOut size={17} /> تسجيل الخروج</button>
    </header>
    <section className="teacher-welcome">
      <div><UserRound size={27} /><div><strong>{dashboard?.teacher.name || account.displayName}</strong><small>يعرض هذا الحساب جدولك وطلاب فصولك فقط.</small></div></div>
      <HijriDatePicker label="التاريخ الهجري" value={date} max={today()} onChange={value => { setDate(value); setLesson(null); setSelected(null) }} />
    </section>

    {activeTab === 'password' && <section className="teacher-security-card">
      <div><KeyRound size={22} /><div><h2>تغيير كلمة المرور</h2></div></div>
      <div className="teacher-password-form"><input type="password" placeholder="كلمة المرور الجديدة" value={password} onChange={event => setPassword(event.target.value)} /><input type="password" placeholder="تأكيد كلمة المرور" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} /><button onClick={() => void savePassword()} disabled={busy === 'password'}>حفظ كلمة المرور</button></div>
    </section>}

    {notice && <div className="teacher-notice success">{notice}</div>}
    {error && <div className="teacher-notice error">{error}</div>}

    {activeTab === 'home' && <>
    <section className="teacher-card">
      <div className="teacher-section-head"><div><span>جدول اليوم</span><h2>{dayNames[dashboard?.weekday || 0]} · {formatHijriDate(date)}</h2></div><BookOpenCheck size={26} /></div>
      {busy === 'dashboard' ? <p className="teacher-empty">جارٍ تحميل الجدول…</p> : !dashboard?.schedule.length ? <p className="teacher-empty">لا توجد حصص مسندة لك في هذا اليوم.</p> : <div className="teacher-schedule-grid">
        {dashboard.schedule.map(item => <button key={item.assignmentId} className={`teacher-schedule-card ${selected?.assignmentId === item.assignmentId ? 'selected' : ''}`} onClick={() => void openLesson(item)}>
          <strong>{periodLabel(item.periodNumber)}</strong><span>{item.classroom}</span><small>{item.subject || 'بدون مادة محددة'}{item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : ''}</small>
        </button>)}
      </div>}
    </section>

    {lesson && selected && <section className="teacher-card teacher-roster-card">
      <div className="teacher-section-head"><div><span>{lesson.mapping.grade} · الفصل {lesson.mapping.classroom}</span><h2>{periodLabel(selected.periodNumber)} — {selected.classroom}</h2></div><div className="teacher-report-actions"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={() => void saveLesson()} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}</button></div></div>
      <p className="teacher-help">اختيار الحالة والملاحظة هنا خاص بمتابعة المعلم، ولا يغيّر سجل الحضور والغياب الإداري.</p>
      <div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>الطالب</th><th>الحالة</th><th>الملاحظة</th>{lesson.sheetConfig?.columns.map(column => <th key={column.id}>{column.label}{column.type === 'score' && column.maxScore !== null ? ` / ${column.maxScore}` : ''}</th>)}</tr></thead><tbody>
        {lesson.students.map(student => { const state = states[student.id] || { status: 'present' as const, note: '' as const, sheetValues: {} }; return <tr key={student.id}>
          <td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>
          <td><div className="teacher-status-toggle"><button className={state.status === 'present' ? 'active present' : ''} onClick={() => updateStudent(student.id, { status: 'present' })}>حاضر</button><button className={state.status === 'absent' ? 'active absent' : ''} onClick={() => updateStudent(student.id, { status: 'absent', note: '' })}>غائب</button></div></td>
          <td><select value={state.note} disabled={state.status === 'absent'} onChange={event => updateStudent(student.id, { note: event.target.value as TeacherNote | '' })}><option value="">مشارك فعال عند الحفظ</option>{notes.map(note => <option key={note} value={note}>{note}</option>)}</select></td>
          {lesson.sheetConfig?.columns.map(column => <td key={column.id} className="teacher-sheet-cell">{column.type === 'score' && <input type="number" min="0" max={column.maxScore ?? undefined} value={String(state.sheetValues[column.id] ?? '')} onChange={event => updateSheetValue(student.id, column.id, event.target.value)} aria-label={`${column.label} لـ ${student.name}`} />}{column.type === 'text' && <input value={String(state.sheetValues[column.id] ?? '')} onChange={event => updateSheetValue(student.id, column.id, event.target.value)} aria-label={`${column.label} لـ ${student.name}`} />}{column.type === 'choice' && <select value={String(state.sheetValues[column.id] ?? '')} onChange={event => updateSheetValue(student.id, column.id, event.target.value)} aria-label={`${column.label} لـ ${student.name}`}><option value="">اختر</option>{column.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select>}{column.type === 'boolean' && <input type="checkbox" checked={state.sheetValues[column.id] === true} onChange={event => updateSheetValue(student.id, column.id, event.target.checked)} aria-label={`${column.label} لـ ${student.name}`} />}</td>)}
        </tr> })}
      </tbody></table></div>
      <div className="teacher-roster-save-bottom"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={() => void saveLesson()} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}</button></div>
    </section>}
    </>}
    {activeTab === 'sheets' && <section className="teacher-card"><div className="teacher-section-head"><div><span>إدارة الكشوف</span><h2>الكشوف</h2><p>جهز كشف كل مادة مرة واحدة، أو ابدأ المتابعة مباشرة.</p></div><FileSpreadsheet size={30} /></div>{sheetMode === 'menu' && <div className="teacher-sheet-menu"><button type="button" onClick={() => setSheetMode('setup')}><FileSpreadsheet size={30} /><strong>إعداد الكشوف</strong><small>أنشئ الأعمدة والدرجات لكل مادة</small></button><button type="button" onClick={() => setSheetMode('start')}><BookOpenCheck size={30} /><strong>بدء المتابعة</strong><small>اختر المادة والفصل والكشف ثم افتح الطلاب</small></button></div>}{sheetMode === 'setup' && <><button type="button" className="outline-button teacher-sheet-back" onClick={() => setSheetMode('menu')}>العودة إلى الكشوف</button><TeacherSheetsSetup sheets={sheets} onSaved={config => setSheets(current => current.map(sheet => sheet.subject === config.subject ? config : sheet))} /></>}{sheetMode === 'start' && <><button type="button" className="outline-button teacher-sheet-back" onClick={() => setSheetMode('menu')}>العودة إلى الكشوف</button><TeacherSheetStart sheets={sheets} schedule={dashboard?.schedule || []} onOpen={item => void openLesson(item)} /></>}</section>}
    {activeTab === 'reports' && <TeacherReportsTab />}
    </div>
  </main>
}
