import { useEffect, useState } from 'react'
import { BarChart3, BookOpenCheck, Check, Copy, FileSpreadsheet, KeyRound, LayoutDashboard, LogOut, Menu, Plus, Printer, Save, Trash2, UserRound, X } from 'lucide-react'
import { api, type Account, type TeacherLesson, type TeacherLessonReport, type TeacherNote, type TeacherPortalDashboard, type TeacherPortalScheduleItem, type TeacherSheetColumn, type TeacherSheetConfig, type TeacherSheetOpenType, type TeacherSheetSubject, type TeacherSheetType } from './api'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate } from './dateUtils'
import * as XLSX from 'xlsx'

const notes: TeacherNote[] = ['هروب من الحصة', 'نائم أثناء الدرس', 'لم يحل الواجب', 'لم يشارك', 'مشارك فعال', 'لم يحضر الكتاب أو المذكرة', 'استخدام الجوال أثناء الحصة']
const dayNames = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const periodLabel = (period: number) => `الحصة ${['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'][period] || period}`
const weekdayForDate = (value: string) => { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return day === 0 ? 1 : day + 1 }
const dateForWeekday = (value: string, weekday: number) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + weekday - weekdayForDate(value)); return date.toISOString().slice(0, 10) }
const displaySheetValue = (value: string | number | boolean | undefined) => value === true ? '✓' : value === false ? '✗' : value ?? ''

type StudentState = { status: 'present' | 'absent'; note: TeacherNote | ''; sheetValues: Record<string, string | number | boolean> }
type TeacherTab = 'home' | 'sheets' | 'reports' | 'password'
type RenderSheetColumn = TeacherSheetColumn & { key: string; sheetType: TeacherSheetType }
const getSheetColumns = (lesson: TeacherLesson): RenderSheetColumn[] => lesson.sheetConfigs.flatMap(config => config.columns.map(column => ({ ...column, key: `${config.sheetType}:${column.id}`, sheetType: config.sheetType })))

const blankColumns = (count: number, prefix = 'خانة'): TeacherSheetColumn[] => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}-${Date.now()}`, label: `${prefix} ${index + 1}`, type: 'text', maxScore: null, choices: [] }))
const sheetTemplates: Array<{ label: string; columns: TeacherSheetColumn[] }> = [
  { label: 'كشف مفرغ 5 خانات', columns: blankColumns(5) },
  { label: 'كشف واجبات 4', columns: [1, 2, 3, 4].map(number => ({ id: `homework-${number}`, label: `الواجب ${number}`, type: 'choice' as const, maxScore: null, choices: ['حل الواجب', 'لم يحل الواجب'] })) },
  { label: 'كشف اختبارات 4', columns: [1, 2, 3, 4].map(number => ({ id: `test-${number}`, label: `اختبار ${number}`, type: 'score' as const, maxScore: 10, choices: [] })) },
]

const sheetTypeLabels: Record<TeacherSheetOpenType, string> = { followup: 'المتابعة', homework: 'الواجبات', tests: 'الاختبارات', combined: 'الكشف المدمج' }

function TeacherSheetsSetup({ sheets, onSaved, onDeleted }: { sheets: TeacherSheetSubject[]; onSaved: (config: TeacherSheetConfig) => void; onDeleted: (subject: string, sheetType: TeacherSheetType) => void }) {
  const [subjectIndex, setSubjectIndex] = useState(0)
  const [sheetType, setSheetType] = useState<TeacherSheetType>('followup')
  const subject = sheets[subjectIndex]
  const config = subject?.configs.find(item => item.sheetType === sheetType)
  const [columns, setColumns] = useState<TeacherSheetColumn[]>(config?.columns || blankColumns(5))
  const [copySubject, setCopySubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const next = sheets[subjectIndex]?.configs.find(item => item.sheetType === sheetType); setColumns(next?.columns?.length ? next.columns : blankColumns(5)); setCopySubject(''); setError('') }, [subjectIndex, sheetType, sheets])
  const updateColumn = (index: number, update: Partial<TeacherSheetColumn>) => setColumns(current => current.map((column, columnIndex) => columnIndex === index ? { ...column, ...update } : column))
  const save = async () => {
    if (!subject || !columns.length) { setError('أضف خانة واحدة على الأقل قبل الحفظ.'); return }
    setBusy(true); setError('')
    try { const result = await api.saveTeacherSheetConfig(subject.subject, sheetType, columns); onSaved(result.config); if (subjectIndex < sheets.length - 1) setSubjectIndex(current => current + 1) } catch { setError('تعذر حفظ تصميم الكشف. تحقق من الاتصال ثم أعد المحاولة.') } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!subject || !config || !window.confirm(`هل تريد حذف كشف ${sheetTypeLabels[sheetType]} لمادة ${subject.subject}؟ ستبقى بياناته القديمة محفوظة.`)) return
    setBusy(true); setError('')
    try { await api.deleteTeacherSheetConfig(subject.subject, sheetType); onDeleted(subject.subject, sheetType); setColumns(blankColumns(5)) } catch { setError('تعذر حذف الكشف. تحقق من الاتصال ثم أعد المحاولة.') } finally { setBusy(false) }
  }
  if (!subject) return <p className="teacher-empty">لا توجد مواد مسندة إلى حسابك.</p>
  return <div className="teacher-sheet-setup">
    <div className="teacher-sheet-subjects">{sheets.map((item, index) => <button type="button" key={item.subject} className={index === subjectIndex ? 'active' : ''} onClick={() => setSubjectIndex(index)}>{item.subject}<small>{item.configs.length} من 3 كشوف جاهزة</small></button>)}</div>
    <div className="teacher-sheet-setup-head"><div><span>إعداد كشوف المادة {subjectIndex + 1} من {sheets.length}</span><h3>{subject.subject}</h3></div><span className="teacher-sheet-count">{columns.length} من 30 خانة</span></div>
    <div className="teacher-sheet-type-block"><strong className="teacher-sheet-step-title">1. اختر نوع الكشف الذي ستعده الآن</strong><div className="teacher-sheet-type-tabs">{(['followup', 'homework', 'tests'] as TeacherSheetType[]).map(type => <button type="button" key={type} className={sheetType === type ? 'active' : ''} onClick={() => setSheetType(type)}>{sheetTypeLabels[type]}<small>{subject.configs.some(item => item.sheetType === type) ? 'جاهز' : 'غير مُعد'}</small></button>)}</div>{config && <div className="teacher-sheet-delete-row"><span>الكشف الحالي: {sheetTypeLabels[sheetType]}</span><button type="button" className="outline-button danger-sheet-button" onClick={() => void remove()} disabled={busy}><Trash2 size={15} /> حذف هذا الكشف</button></div>}</div>
    <div className="teacher-sheet-actions"><strong>2. اختر قالباً أو عدّل الأعمدة</strong>{sheetTemplates.map(template => <button type="button" className="outline-button" key={template.label} onClick={() => setColumns(template.columns.map(column => ({ ...column, id: `${column.id}-${Date.now()}-${Math.random()}` })))}>{template.label}</button>)}<label className="teacher-sheet-copy"><Copy size={15} /> نسخ تصميم من مادة<select value={copySubject} onChange={event => { const source = sheets.find(item => item.subject === event.target.value)?.configs.find(item => item.sheetType === sheetType); setCopySubject(event.target.value); if (source?.columns.length) setColumns(source.columns.map(column => ({ ...column, id: `${column.id}-${Date.now()}-${Math.random()}` }))) }}><option value="">اختر مادة</option>{sheets.filter(item => item.subject !== subject.subject && item.configs.some(config => config.sheetType === sheetType)).map(item => <option key={item.subject} value={item.subject}>{item.subject}</option>)}</select></label></div>
    <div className="teacher-sheet-columns-head"><strong>أعمدة كشف {subject.subject}</strong><button type="button" className="outline-button" onClick={() => columns.length < 30 && setColumns(current => [...current, ...blankColumns(1, 'خانة')])} disabled={columns.length >= 30}><Plus size={16} /> إضافة عمود</button></div>
    <div className="teacher-sheet-columns">{columns.map((column, index) => <div className="teacher-sheet-column-row" key={column.id}><input value={column.label} onChange={event => updateColumn(index, { label: event.target.value })} aria-label={`اسم العمود ${index + 1}`} /><select value={column.type} onChange={event => updateColumn(index, { type: event.target.value as TeacherSheetColumn['type'], maxScore: event.target.value === 'score' ? (column.maxScore ?? 10) : null })}><option value="score">درجة</option><option value="text">نص</option><option value="choice">اختيار</option><option value="boolean">صح أو خطأ</option></select>{column.type === 'score' && <input className="teacher-sheet-score-input" type="number" min="0" max="1000" value={column.maxScore ?? 10} onChange={event => updateColumn(index, { maxScore: Number(event.target.value) })} aria-label="الدرجة العظمى" />}{column.type === 'choice' && <input value={column.choices.join('، ')} onChange={event => updateColumn(index, { choices: event.target.value.split('،').map(choice => choice.trim()).filter(Boolean) })} placeholder="الخيارات مفصولة بفاصلة" aria-label="خيارات العمود" />}<button type="button" className="icon-button danger" onClick={() => setColumns(current => current.filter((_, columnIndex) => columnIndex !== index))} title="حذف العمود"><Trash2 size={16} /></button></div>)}</div>
    {error && <p className="teacher-notice error" role="alert">{error}</p>}<button type="button" className="primary-button" onClick={() => void save()} disabled={busy}><Check size={17} /> {busy ? 'جارٍ الحفظ…' : subjectIndex < sheets.length - 1 ? 'تأكيد والانتقال للمادة التالية' : 'حفظ تصميم الكشوف'}</button>
  </div>
}

function TeacherSheetStart({ sheets, schedule, onOpen }: { sheets: TeacherSheetSubject[]; schedule: TeacherPortalScheduleItem[]; onOpen: (item: TeacherPortalScheduleItem, type: TeacherSheetOpenType) => void }) {
  const [subject, setSubject] = useState(sheets[0]?.subject || '')
  const [sheetType, setSheetType] = useState<TeacherSheetOpenType>('followup')
  const [classroomId, setClassroomId] = useState('')
  const classrooms = [...new Map(schedule.filter(item => item.subject === subject).map(item => [item.classroom, item])).values()]
  const subjectConfigs = sheets.find(sheet => sheet.subject === subject)?.configs || []
  const config = sheetType === 'combined' ? subjectConfigs.find(item => item.sheetType === 'followup') || subjectConfigs[0] : subjectConfigs.find(item => item.sheetType === sheetType)
  useEffect(() => { setClassroomId(classrooms[0]?.classroomId || '') }, [subject, schedule.length])
  const selected = classrooms.find(item => item.classroomId === classroomId)
  return <div className="teacher-sheet-start">
    <div className="teacher-sheet-selectors"><label>المادة<select value={subject} onChange={event => setSubject(event.target.value)}><option value="">اختر المادة</option>{sheets.map(sheet => <option key={sheet.subject} value={sheet.subject}>{sheet.subject}</option>)}</select></label><label>الفصل<select value={classroomId} onChange={event => setClassroomId(event.target.value)} disabled={!classrooms.length}><option value="">اختر الفصل</option>{classrooms.map(item => <option key={item.classroomId} value={item.classroomId}>{item.classroom}</option>)}</select></label><label>نوع العرض<select value={sheetType} onChange={event => setSheetType(event.target.value as TeacherSheetOpenType)}><option value="combined">الكشف المدمج</option><option value="followup">المتابعة فقط</option><option value="homework">الواجبات فقط</option><option value="tests">الاختبارات فقط</option></select></label></div>
    {!classrooms.length && subject && <p className="teacher-empty">لا توجد فصول مرتبطة بهذه المادة في جدولك.</p>}
    {subject && !config?.version && <p className="teacher-empty">أعد إعداد قسم هذا العرض أولاً، أو اختر عرضاً يحتوي على قسم جاهز.</p>}
    {selected && config?.version ? <button type="button" className="primary-button" onClick={() => onOpen(selected, sheetType)}><BookOpenCheck size={17} /> فتح كشف {sheetTypeLabels[sheetType]} · {selected.classroom}</button> : null}
  </div>
}

function TeacherSheetRoster({ lesson, selected, states, updateSheetValue, exportSheet, printSheet, saveLesson, busy }: { lesson: TeacherLesson; selected: TeacherPortalScheduleItem; states: Record<string, StudentState>; updateSheetValue: (studentId: string, columnId: string, value: string | number | boolean) => void; exportSheet: () => void; printSheet: () => void; saveLesson: () => void; busy: string }) {
  return <section className="teacher-card teacher-roster-card teacher-sheet-roster"><div className="teacher-section-head"><div><span>{lesson.assignment.subject} · {lesson.mapping.grade} · الفصل {lesson.mapping.classroom}</span><h2>كشف {lesson.assignment.subject} — {selected.classroom}</h2></div><div className="teacher-report-actions"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={saveLesson} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ الكشف'}</button></div></div><div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>الطالب</th>{getSheetColumns(lesson).map(column => <th key={column.key}>{column.label}{column.type === 'score' && column.maxScore !== null ? ` / ${column.maxScore}` : ''}</th>)}</tr></thead><tbody>{lesson.students.map(student => { const state = states[student.id] || { status: 'present' as const, note: '' as const, sheetValues: {} }; return <tr key={student.id}><td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>{getSheetColumns(lesson).map(column => <td key={column.key} className="teacher-sheet-cell">{column.type === 'score' && <input type="number" min="0" max={column.maxScore ?? undefined} value={String(state.sheetValues[column.key] ?? '')} onChange={event => updateSheetValue(student.id, column.key, event.target.value)} aria-label={`${column.label} لـ ${student.name}`} />}{column.type === 'text' && <input value={String(state.sheetValues[column.key] ?? '')} onChange={event => updateSheetValue(student.id, column.key, event.target.value)} aria-label={`${column.label} لـ ${student.name}`} />}{column.type === 'choice' && <select value={String(state.sheetValues[column.key] ?? '')} onChange={event => updateSheetValue(student.id, column.key, event.target.value)} aria-label={`${column.label} لـ ${student.name}`}><option value="">اختر</option>{column.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select>}{column.type === 'boolean' && <input type="checkbox" checked={state.sheetValues[column.key] === true} onChange={event => updateSheetValue(student.id, column.key, event.target.checked)} aria-label={`${column.label} لـ ${student.name}`} />}</td>)}</tr> })}</tbody></table></div><div className="teacher-roster-save-bottom"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={saveLesson} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ الكشف'}</button></div></section>
}

function TeacherSheetReportView({ title, schedule, initialType, onBack }: { title: string; schedule: TeacherPortalScheduleItem[]; initialType: TeacherSheetType; onBack: () => void }) {
  const initialFrom = () => { const value = new Date(`${today()}T12:00:00Z`); value.setUTCFullYear(value.getUTCFullYear() - 1); return value.toISOString().slice(0, 10) }
  const [subject, setSubject] = useState(schedule[0]?.subject || '')
  const [classroomId, setClassroomId] = useState('')
  const [sheetType, setSheetType] = useState<TeacherSheetType>(initialType)
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(today())
  const [report, setReport] = useState<import('./api').TeacherSheetReport | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const subjects = [...new Set(schedule.map(item => item.subject).filter(Boolean))]
  const classrooms = [...new Map(schedule.filter(item => item.subject === subject).map(item => [item.classroomId, item])).values()]
  useEffect(() => { setClassroomId(classrooms[0]?.classroomId || '') }, [subject, schedule.length])
  const load = async () => { if (!subject || !classroomId) return; setBusy(true); setError(''); try { setReport(await api.teacherSheetReport(subject, classroomId, sheetType, from, to)) } catch { setReport(null); setError('لا يوجد كشف محفوظ بهذا النوع للمادة والفصل المحددين ضمن الفترة.') } finally { setBusy(false) } }
  const exportReport = () => { if (!report) return; const rows = [['الطالب', ...report.columns.map(column => column.label)], ...report.students.map(student => [student.name, ...report.columns.map(column => displaySheetValue(student.values[column.id]))])]; const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'التقرير'); XLSX.writeFile(workbook, `${title}-${report.subject}-${report.classroom}.xlsx`) }
  const printReport = () => { if (!report) return; const rows = report.students.map(student => `<tr><td>${student.name}</td>${report.columns.map(column => `<td>${displaySheetValue(student.values[column.id])}</td>`).join('')}</tr>`).join(''); const popup = window.open('', '_blank'); if (!popup) return; popup.document.write(`<html dir="rtl"><head><title>${title}</title><style>body{font-family:Arial;padding:18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #94a3b8;padding:7px;text-align:right}th{background:#e2e8f0}.print-actions{display:flex;gap:8px;padding:8px;background:#0f172a}.print-actions button{padding:9px 14px;border:0;border-radius:7px}.close-preview{background:#fee2e2}@media print{@page{size:A4 landscape;margin:10mm}.print-actions{display:none}}</style></head><body><nav class="print-actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button class="close-preview" onclick="closePreview()">العودة للموقع</button></nav><h2>${title} - ${report.subject} - ${report.classroom}</h2><table><thead><tr><th>الطالب</th>${report.columns.map(column => `<th>${column.label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><script>function closePreview(){var openerWindow=window.opener;window.close();setTimeout(function(){if(window.closed)return;if(openerWindow&&!openerWindow.closed){window.location.replace(openerWindow.location.href);return}window.history.back()},250)}window.onload=()=>window.print()</script></body></html>`); popup.document.close() }
  return <section className="teacher-card"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={onBack}>العودة إلى التقارير</button><span>{title}</span><h2>{title}</h2></div><FileSpreadsheet size={30} /></div><div className="teacher-sheet-selectors"><label>المادة<select value={subject} onChange={event => setSubject(event.target.value)}>{subjects.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>الفصل<select value={classroomId} onChange={event => setClassroomId(event.target.value)}>{classrooms.map(item => <option key={item.classroomId} value={item.classroomId}>{item.classroom}</option>)}</select></label><label>نوع الكشف<select value={sheetType} onChange={event => setSheetType(event.target.value as TeacherSheetType)}><option value="followup">المتابعة</option><option value="homework">الواجبات</option><option value="tests">الاختبارات</option></select></label></div><div className="teacher-report-filters"><HijriDatePicker label="من التاريخ الهجري" value={from} max={to} onChange={setFrom} /><HijriDatePicker label="إلى التاريخ الهجري" value={to} min={from} max={today()} onChange={setTo} /></div><button type="button" className="primary-button" onClick={() => void load()} disabled={busy}>{busy ? 'جارٍ التحميل…' : 'عرض التقرير'}</button>{error && <p className="teacher-notice error">{error}</p>}{report && <><div className="teacher-report-actions"><button type="button" className="outline-button" onClick={exportReport}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="outline-button" onClick={printReport}><Printer size={16} /> PDF</button></div><div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>الطالب</th>{report.columns.map(column => <th key={column.id}>{column.label}</th>)}</tr></thead><tbody>{report.students.map(student => <tr key={student.id}><td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>{report.columns.map(column => <td key={column.id}>{displaySheetValue(student.values[column.id])}</td>)}</tr>)}</tbody></table></div></>}</section>
}

function TeacherAttendanceReportsTab({ studentMode, onBack }: { studentMode: boolean; onBack: () => void }) {
  const initialFrom = () => { const value = new Date(`${today()}T12:00:00Z`); value.setUTCFullYear(value.getUTCFullYear() - 1); return value.toISOString().slice(0, 10) }
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(today())
  const [search, setSearch] = useState('')
  const [studentId, setStudentId] = useState('')
  const [reports, setReports] = useState<TeacherLessonReport[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async (selectedStudent = studentId) => { setBusy(true); setError(''); try { setReports((await api.teacherReports({ from, to, studentId: selectedStudent })).reports) } catch { setError('تعذر تحميل تقرير الحضور والملاحظات.') } finally { setBusy(false) } }
  useEffect(() => { void load() }, [from, to])
  const studentChoices = [...new Map(reports.flatMap(report => report.records.map(record => [record.studentId, record.name]))).entries()]
  const visibleStudents = studentChoices.filter(([, name]) => !search || name.includes(search))
  const rows = reports.flatMap(report => report.records.map(record => ({ date: report.date, subject: report.subject, period: report.periodNumber, ...record })))
  const exportReport = () => { const data = [['التاريخ', 'المادة', 'الفصل', 'الحصة', 'الطالب', 'الحالة', 'الملاحظة'], ...rows.map(row => [row.date, row.subject, row.classroom, row.period, row.name, row.status === 'present' ? 'حاضر' : 'غائب', row.note || ''])]; const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'الحضور والملاحظات'); XLSX.writeFile(workbook, `${studentMode ? 'تقرير-طالب' : 'تقرير-الحضور'}-${to}.xlsx`) }
  const printReport = () => { const body = rows.map(row => `<tr><td>${formatHijriDate(row.date)}</td><td>${row.subject}</td><td>${row.classroom}</td><td>${row.name}</td><td>${row.status === 'present' ? 'حاضر' : 'غائب'}</td><td>${row.note || ''}</td></tr>`).join(''); const popup = window.open('', '_blank'); if (!popup) return; popup.document.write(`<html dir="rtl"><head><title>تقرير الحضور والملاحظات</title><style>body{font-family:Arial;padding:18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #94a3b8;padding:7px;text-align:right}th{background:#e2e8f0}.print-actions{display:flex;gap:8px;padding:8px;background:#0f172a}.print-actions button{padding:9px 14px;border:0;border-radius:7px}.close-preview{background:#fee2e2}@media print{@page{size:A4 landscape;margin:10mm}.print-actions{display:none}}</style></head><body><nav class="print-actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button class="close-preview" onclick="closePreview()">العودة للموقع</button></nav><h2>${studentMode ? 'تقرير حضور وملاحظات طالب' : 'تقرير الحضور والملاحظات'}</h2><table><thead><tr><th>التاريخ</th><th>المادة</th><th>الفصل</th><th>الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>${body}</tbody></table><script>function closePreview(){var openerWindow=window.opener;window.close();setTimeout(function(){if(window.closed)return;if(openerWindow&&!openerWindow.closed){window.location.replace(openerWindow.location.href);return}window.history.back()},250)}window.onload=()=>window.print()</script></body></html>`); popup.document.close() }
  return <section className="teacher-card"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={onBack}>العودة إلى التقارير</button><span>{studentMode ? 'تقرير حضور وملاحظات طالب' : 'تقرير الحضور والملاحظات'}</span><h2>{studentMode ? 'تقرير طالب مفصل' : 'حضور وملاحظات جميع الطلاب'}</h2></div><LayoutDashboard size={30} /></div><div className="teacher-report-filters"><HijriDatePicker label="من التاريخ الهجري" value={from} max={to} onChange={setFrom} /><HijriDatePicker label="إلى التاريخ الهجري" value={to} min={from} max={today()} onChange={setTo} /></div>{studentMode && <div className="teacher-student-search"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الطالب..." aria-label="ابحث باسم الطالب" /><select value={studentId} onChange={event => { setStudentId(event.target.value); void load(event.target.value) }}><option value="">اختر الطالب</option>{visibleStudents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>}<div className="teacher-report-actions"><button type="button" className="outline-button" onClick={exportReport} disabled={!rows.length}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="outline-button" onClick={printReport} disabled={!rows.length}><Printer size={16} /> PDF</button><button type="button" className="primary-button" onClick={() => void load()} disabled={busy}>{busy ? 'جارٍ التحميل…' : 'تحديث التقرير'}</button></div>{error && <p className="teacher-notice error">{error}</p>}{busy ? <p className="teacher-empty">جارٍ تحميل البيانات…</p> : !rows.length ? <p className="teacher-empty">لا توجد سجلات ضمن الفترة المحددة.</p> : <div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>التاريخ</th><th>المادة</th><th>الفصل</th><th>الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.date}-${row.studentId}-${index}`}><td>{formatHijriDate(row.date)}</td><td>{row.subject}</td><td>{row.classroom}</td><td>{row.name}</td><td>{row.status === 'present' ? 'حاضر' : 'غائب'}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div>}</section>
}

function TeacherReportsTab({ schedule }: { schedule: TeacherPortalScheduleItem[] }) {
  type ReportMode = 'menu' | 'grades' | 'studentGrades' | 'attendance' | 'studentAttendance' | 'tests' | 'homework'
  const [mode, setMode] = useState<ReportMode>('menu')
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
  if (mode === 'menu') return <section className="teacher-card"><div className="teacher-section-head"><div><span>مركز التقارير</span><h2>التقارير</h2><p>اختر نوع التقرير المطلوب.</p></div><BarChart3 size={30} /></div><div className="teacher-report-menu">{([['grades', 'تقرير كشوف الدرجات', 'درجات جميع أقسام كشف الفصل', FileSpreadsheet], ['studentGrades', 'تقرير درجات طالب', 'ابحث عن طالب واعرض درجاته', UserRound], ['attendance', 'تقرير الحضور والملاحظات', 'حضور وغياب وملاحظات جميع الأيام', LayoutDashboard], ['studentAttendance', 'تقرير حضور طالب', 'سجل طالب واحد بالتفصيل', UserRound], ['tests', 'تقرير الاختبارات', 'درجات الاختبارات حسب الفصل', BarChart3], ['homework', 'تقرير الواجبات', 'حالة ودرجات الواجبات حسب الفصل', FileSpreadsheet]] as const).map(([value, title, description, Icon]) => <button type="button" key={value} onClick={() => setMode(value)}><Icon size={25} /><strong>{title}</strong><small>{description}</small></button>)}</div></section>
  if (mode === 'grades' || mode === 'tests' || mode === 'homework') return <TeacherSheetReportView title={mode === 'grades' ? 'تقرير كشوف الدرجات' : mode === 'tests' ? 'تقرير الاختبارات' : 'تقرير الواجبات'} schedule={schedule} initialType={mode === 'tests' ? 'tests' : mode === 'homework' ? 'homework' : 'followup'} onBack={() => setMode('menu')} />
  if (mode === 'attendance' || mode === 'studentAttendance') return <TeacherAttendanceReportsTab studentMode={mode === 'studentAttendance'} onBack={() => setMode('menu')} />
  return <section className="teacher-card"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={() => setMode('menu')}>العودة إلى التقارير</button><span>تقرير المتابعة</span><h2>التقارير</h2><p>اعرض حصص المتابعة حسب التاريخ وصدّرها عند الحاجة.</p></div><BarChart3 size={30} /></div><div className="teacher-report-filters"><HijriDatePicker label="تاريخ التقرير الهجري" value={date} max={today()} onChange={setDate} /><div className="teacher-report-actions"><button type="button" className="outline-button" onClick={exportReports} disabled={!reports.length}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="primary-button" onClick={() => void load()} disabled={busy}>{busy ? 'جارٍ التحميل…' : 'تحديث التقارير'}</button></div></div>{error && <p className="teacher-notice error">{error}</p>}{busy ? <p className="teacher-empty">جارٍ تحميل التقارير…</p> : !reports.length ? <p className="teacher-empty">لا توجد تقارير متابعة لهذا التاريخ.</p> : <div className="teacher-report-list">{reports.map(report => <article key={report.id}><div><strong>{report.subject || 'مادة غير محددة'} · {report.classroom}</strong><span>{formatHijriDate(report.date)} · {periodLabel(report.periodNumber)} · {report.studentsCount} طالب · {report.presentCount} حاضر · {report.absentCount} غائب</span></div></article>)}</div>}</section>
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
  const [sheets, setSheets] = useState<TeacherSheetSubject[]>([])
  const [sheetMode, setSheetMode] = useState<'menu' | 'setup' | 'start'>('menu')
  const [activeLessonDate, setActiveLessonDate] = useState(date)
  const [sheetOnlyView, setSheetOnlyView] = useState(false)
  const [selectedSheetType, setSelectedSheetType] = useState<TeacherSheetOpenType>('followup')
  const [printPreview, setPrintPreview] = useState('')
  const [reportsKey, setReportsKey] = useState(0)

  const loadDashboard = async () => {
    setBusy('dashboard')
    setError('')
    try { setDashboard(await api.teacherDashboard(date)) } catch { setError('تعذر تحميل جدولك. اطلب من الإدارة التأكد من ربط حسابك بالجدول.') } finally { setBusy('') }
  }

  useEffect(() => { void loadDashboard() }, [date])
  useEffect(() => { void api.teacherSheets().then(result => setSheets(result.sheets)).catch(() => setSheets([])) }, [])

  const openLesson = async (item: TeacherPortalScheduleItem, sheetType: TeacherSheetOpenType = 'followup', sheetOnly = false) => {
    setBusy(`lesson-${item.assignmentId}`)
    setError('')
    const targetDate = dateForWeekday(date, item.weekday)
    try {
      const next = await api.teacherLesson(item.classroomId, targetDate, item.periodNumber, sheetType)
      setLesson(next)
      setSelected(item)
      setActiveLessonDate(targetDate)
      setSelectedSheetType(sheetType)
      setSheetOnlyView(sheetOnly)
      setActiveTab(sheetOnly ? 'sheets' : 'home')
      setSheetMode('menu')
      const defaultSheetValues = Object.fromEntries(next.sheetConfigs.flatMap(config => config.columns.filter(column => column.type === 'boolean').map(column => [`${config.sheetType}:${column.id}`, true])))
      setStates(Object.fromEntries(next.students.map(student => [student.id, { status: student.status, note: student.note, sheetValues: { ...defaultSheetValues, ...student.sheetValues } }])))
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
    const columns = sheetOnlyView ? getSheetColumns(lesson) : []
    const rows = [['الطالب', 'الحالة', 'الملاحظة', ...columns.map(column => column.label)], ...lesson.students.map(student => {
      const state = states[student.id] || { status: 'present' as const, note: '', sheetValues: {} }
      return sheetOnlyView ? [student.name, ...columns.map(column => displaySheetValue(state.sheetValues[column.key]))] : [student.name, state.status === 'present' ? 'حاضر' : 'غائب', state.note || '', ...columns.map(column => displaySheetValue(state.sheetValues[column.key]))]
    })]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'الكشف')
    XLSX.writeFile(workbook, `كشف-${lesson.assignment.subject}-${date}.xlsx`)
  }

  const printSheet = () => {
    if (!lesson || !selected) return
    const columns = sheetOnlyView ? getSheetColumns(lesson) : []
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
    const rows = lesson.students.map(student => {
      const state = states[student.id] || { status: 'present' as const, note: '', sheetValues: {} }
      return sheetOnlyView ? `<tr><td>${escape(student.name)}</td>${columns.map(column => `<td>${escape(displaySheetValue(state.sheetValues[column.key]))}</td>`).join('')}</tr>` : `<tr><td>${escape(student.name)}</td><td>${state.status === 'present' ? 'حاضر' : 'غائب'}</td><td>${escape(state.note || '')}</td>${columns.map(column => `<td>${escape(displaySheetValue(state.sheetValues[column.key]))}</td>`).join('')}</tr>`
    }).join('')
    setPrintPreview(`<h2>كشف ${escape(lesson.assignment.subject)} - ${escape(selected.classroom)}</h2><p>${escape(formatHijriDate(activeLessonDate))}</p><table><thead><tr><th>الطالب</th>${sheetOnlyView ? '' : '<th>الحالة</th><th>الملاحظة</th>'}${columns.map(column => `<th>${escape(column.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`)
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
        sheetType: selectedSheetType,
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


  const navigate = (tab: TeacherTab) => { setActiveTab(tab); setMobileNavOpen(false); setLesson(null); setSelected(null); if (tab === 'reports') setReportsKey(current => current + 1) }
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
      <div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>
        {lesson.students.map(student => { const state = states[student.id] || { status: 'present' as const, note: '' as const, sheetValues: {} }; return <tr key={student.id}>
          <td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>
          <td><div className="teacher-status-toggle"><button className={state.status === 'present' ? 'active present' : ''} onClick={() => updateStudent(student.id, { status: 'present' })}>حاضر</button><button className={state.status === 'absent' ? 'active absent' : ''} onClick={() => updateStudent(student.id, { status: 'absent', note: '' })}>غائب</button></div></td>
          <td><select value={state.note} disabled={state.status === 'absent'} onChange={event => updateStudent(student.id, { note: event.target.value as TeacherNote | '' })}><option value="">مشارك فعال عند الحفظ</option>{notes.map(note => <option key={note} value={note}>{note}</option>)}</select></td>
        </tr> })}
      </tbody></table></div>
      <div className="teacher-roster-save-bottom"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={() => void saveLesson()} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}</button></div>
    </section>}
    </>}
    {activeTab === 'sheets' && <section className="teacher-card"><div className="teacher-section-head"><div><span>إدارة الكشوف</span><h2>الكشوف</h2><p>جهز كشف كل مادة مرة واحدة، أو ابدأ المتابعة مباشرة.</p></div><FileSpreadsheet size={30} /></div>{sheetMode === 'menu' && <div className="teacher-sheet-menu"><button type="button" onClick={() => setSheetMode('setup')}><FileSpreadsheet size={30} /><strong>إعداد الكشوف</strong><small>أنشئ الأعمدة والدرجات لكل مادة</small></button><button type="button" onClick={() => setSheetMode('start')}><BookOpenCheck size={30} /><strong>بدء المتابعة</strong><small>اختر المادة والفصل والكشف ثم افتح الطلاب</small></button></div>}{sheetMode === 'setup' && <><button type="button" className="outline-button teacher-sheet-back" onClick={() => setSheetMode('menu')}>العودة إلى الكشوف</button><TeacherSheetsSetup sheets={sheets} onSaved={config => setSheets(current => current.map(subject => subject.subject === config.subject ? { ...subject, configs: [...subject.configs.filter(item => item.sheetType !== config.sheetType), config] } : subject))} onDeleted={(subjectName, sheetType) => setSheets(current => current.map(subject => subject.subject === subjectName ? { ...subject, configs: subject.configs.filter(config => config.sheetType !== sheetType) } : subject))} /></>}{sheetMode === 'start' && <><button type="button" className="outline-button teacher-sheet-back" onClick={() => setSheetMode('menu')}>العودة إلى الكشوف</button><TeacherSheetStart sheets={sheets} schedule={dashboard?.weekSchedule || []} onOpen={(item, type) => void openLesson(item, type, true)} /></>}{sheetOnlyView && lesson && selected && <TeacherSheetRoster lesson={lesson} selected={selected} states={states} updateSheetValue={updateSheetValue} exportSheet={exportSheet} printSheet={printSheet} saveLesson={saveLesson} busy={busy} />}</section>}
    {activeTab === 'reports' && <TeacherReportsTab key={reportsKey} schedule={dashboard?.weekSchedule || []} />}
    {printPreview && <div className="teacher-print-overlay" role="dialog" aria-modal="true" aria-label="معاينة الكشف"><div className="teacher-print-preview" dangerouslySetInnerHTML={{ __html: printPreview }} /><div className="teacher-print-actions"><button type="button" className="outline-button" onClick={() => setPrintPreview('')}>إغلاق والعودة للكشف</button><button type="button" className="primary-button" onClick={() => window.print()}><Printer size={16} /> طباعة / حفظ PDF</button></div></div>}
    </div>
  </main>
}
