import { useMemo, useState } from 'react'
import { ChevronDown, Printer, Search } from 'lucide-react'
import { api, type DetailedStudentReport } from './api'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate } from './dateUtils'

type StudentOption = { id: string; name: string; grade: string; classroom: string; phone: string }
type LessonRecord = DetailedStudentReport['lessons'][number]
type GradeRecord = DetailedStudentReport['grades'][number]
type SubjectGroup = {
  key: string
  subject: string
  teacherName: string
  grade: string
  classroomValue: string
  records: LessonRecord[]
  grades: GradeRecord[]
}

const sheetTypeLabels: Record<GradeRecord['sheetType'], string> = { followup: 'المتابعة', homework: 'الواجبات', tests: 'الاختبارات' }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const previousYear = () => {
  const date = new Date(`${today()}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 365)
  return date.toISOString().slice(0, 10)
}
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

function statusLabel(status: LessonRecord['status']) {
  return status === 'absent' ? 'غائب' : 'حاضر'
}

function subjectGroups(report: DetailedStudentReport): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>()
  const getGroup = (item: Pick<SubjectGroup, 'subject' | 'teacherName' | 'grade' | 'classroomValue'>) => {
    const key = JSON.stringify([item.subject, item.teacherName, item.grade, item.classroomValue])
    const group = groups.get(key) || { key, ...item, records: [], grades: [] }
    groups.set(key, group)
    return group
  }
  report.subjects.forEach(subject => { getGroup(subject) })
  report.lessons.forEach(record => { getGroup(record).records.push(record) })
  report.grades.forEach(grade => { getGroup(grade).grades.push(grade) })
  return [...groups.values()].sort((left, right) =>
    left.subject.localeCompare(right.subject, 'ar') || left.teacherName.localeCompare(right.teacherName, 'ar')
  )
}

function groupSummary(group: SubjectGroup) {
  return {
    absenceDays: new Set(group.records.filter(record => record.status === 'absent').map(record => record.date)).size,
    noteCount: group.records.filter(record => Boolean(record.note.trim())).length,
  }
}

function gradeValue(entry: GradeRecord, column: GradeRecord['columns'][number]) {
  const value = entry.values[column.id]
  if (column.type === 'boolean') return value === true ? '✓' : value === false ? '✗' : '—'
  if (value === '' || value === null || value === undefined) return '—'
  return column.type === 'score' && column.maxScore !== null ? `${value} / ${column.maxScore}` : String(value)
}

export function StudentDetailedReport({ students, schoolName, printDocument }: { students: StudentOption[]; schoolName: string; printDocument: (title: string, contents: string, schoolName: string) => boolean }) {
  const [search, setSearch] = useState('')
  const [student, setStudent] = useState<StudentOption | null>(null)
  const [from, setFrom] = useState(previousYear)
  const [to, setTo] = useState(today)
  const [report, setReport] = useState<DetailedStudentReport | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [printSubject, setPrintSubject] = useState('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const suggestions = useMemo(() => {
    const query = search.trim()
    return query ? students.filter(item => item.name.includes(query)).slice(0, 8) : []
  }, [search, students])
  const groups = useMemo(() => report ? subjectGroups(report) : [], [report])

  const load = async (selected: StudentOption, start = from, end = to) => {
    setBusy(true)
    setError('')
    setReport(null)
    setExpandedGroups(new Set())
    try {
      setReport(await api.detailedStudentReport(selected.id, start, end))
      setPrintSubject('all')
    } catch {
      setError('تعذر تحميل التقرير. تحقق من الفترة المحددة وحاول مرة أخرى.')
    } finally {
      setBusy(false)
    }
  }

  const chooseStudent = (selected: StudentOption) => {
    setStudent(selected)
    setSearch(selected.name)
    void load(selected)
  }

  const toggleGroup = (key: string) => setExpandedGroups(current => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const printReport = () => {
    if (!report) return
    const printableGroups = printSubject === 'all' ? groups : groups.filter(group => group.key === printSubject)
    if (!printableGroups.length) return
    const groupHtml = printableGroups.map(group => {
      const summary = groupSummary(group)
      const gradeRows = group.grades.flatMap(entry => entry.columns.map(column => `<tr><td>${escapeHtml(sheetTypeLabels[entry.sheetType])}</td><td>${escapeHtml(formatHijriDate(entry.date))}</td><td>${escapeHtml(column.label)}</td><td>${escapeHtml(gradeValue(entry, column))}</td></tr>`)).join('')
      const lessonRows = group.records.map(record => `<tr><td>${escapeHtml(formatHijriDate(record.date))}</td><td>${record.periodNumber}</td><td>${statusLabel(record.status)}</td><td>${escapeHtml(record.note || '—')}</td></tr>`).join('')
      return `<h2>المادة: ${escapeHtml(group.subject)}</h2>
        <p><strong>المعلم:</strong> ${escapeHtml(group.teacherName)}　 <strong>الصف والفصل:</strong> ${escapeHtml(group.grade)} - ${escapeHtml(group.classroomValue)}</p>
        <h3>درجات وأعمال الطالب</h3>${gradeRows ? `<table><thead><tr><th>القسم</th><th>التاريخ</th><th>البند</th><th>القيمة</th></tr></thead><tbody>${gradeRows}</tbody></table>` : '<p>لا توجد درجات أو أعمال مسجلة ضمن الفترة المحددة.</p>'}
        <h3>الحضور وملاحظات الحصص</h3><p>أيام الغياب عن حصص المادة: ${summary.absenceDays}　 <strong>عدد الملاحظات: ${summary.noteCount}</strong></p>
        ${lessonRows ? `<table><thead><tr><th>التاريخ الهجري</th><th>الحصة</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>${lessonRows}</tbody></table>` : '<p>لا توجد سجلات حصص ضمن الفترة المحددة.</p>'}`
    }).join('<hr/>')
    const contents = `<section class="page"><h1>تقرير مفصل عن الطالب</h1>
      <div class="heading"><p><strong>اسم الطالب:</strong> ${escapeHtml(report.student.name)}</p>
      <p><strong>الصف والفصل:</strong> ${escapeHtml(report.student.grade)} - ${escapeHtml(report.student.classroom)}</p>
      <p><strong>أيام الغياب عن المدرسة:</strong> ${report.summary.schoolAbsenceDays}　 <strong>أيام التأخر عن المدرسة:</strong> ${report.summary.schoolLateDays}</p>
      <p><strong>الفترة الهجرية:</strong> ${escapeHtml(formatHijriDate(report.from))} إلى ${escapeHtml(formatHijriDate(report.to))}</p></div>${groupHtml}</section>`
    printDocument('تقرير مفصل عن الطالب', contents, schoolName)
  }

  return <section className="panel student-detail-report">
    <div className="panel-header"><div><span className="panel-kicker">سجل الطالب</span><h2>التقرير المفصل للطالب</h2><p>يعرض مواد الطالب ودرجاته وأعمال المعلمين، إلى جانب الغياب المدرسي وسجلات الحصص.</p></div></div>
    <div className="student-detail-controls">
      <label className="student-detail-search"><Search size={17} /><input value={search} onChange={event => { setSearch(event.target.value); setStudent(null); setReport(null) }} placeholder="ابحث باسم الطالب..." autoComplete="off" aria-label="ابحث باسم الطالب" /></label>
      {!student && suggestions.length > 0 && <div className="student-detail-suggestions" role="listbox">{suggestions.map(item => <button type="button" role="option" key={item.id} onClick={() => chooseStudent(item)}>{item.name}<small>{item.grade} · {item.classroom}</small></button>)}</div>}
      {search.trim() && !suggestions.length && !student && <p className="teacher-empty">لا توجد أسماء مطابقة.</p>}
      {student && <div className="student-detail-range"><HijriDatePicker label="من التاريخ الهجري" value={from} max={to} onChange={setFrom} /><HijriDatePicker label="إلى التاريخ الهجري" value={to} min={from} max={today()} onChange={setTo} /><button type="button" className="primary-button" onClick={() => void load(student)} disabled={busy || !from || !to}>{busy ? 'جارٍ التحميل…' : 'تحديث التقرير'}</button></div>}
    </div>
    {error && <p className="teacher-notice error" role="alert">{error}</p>}
    {busy && <p className="teacher-empty">جارٍ تحميل بيانات الطالب...</p>}
    {report && <>
      <section className="student-detail-summary"><h3>تقرير مفصل عن الطالب</h3><strong>{report.student.name}</strong><span>{report.student.grade} · {report.student.classroom}</span><div><b>أيام الغياب عن المدرسة: {report.summary.schoolAbsenceDays}</b><b>أيام التأخر عن المدرسة: {report.summary.schoolLateDays}</b><b>مواد الجدول: {groups.length}</b><b>مواد لها سجلات: {groups.filter(group => group.grades.length > 0).length}</b><small>الفترة الهجرية: {formatHijriDate(report.from)} إلى {formatHijriDate(report.to)}</small></div></section>
      <div className="student-detail-print"><label>المواد<select value={printSubject} onChange={event => setPrintSubject(event.target.value)}><option value="all">جميع المواد</option>{groups.map(group => <option key={group.key} value={group.key}>{group.subject} · {group.teacherName}</option>)}</select></label><button type="button" className="export-btn pdf" onClick={printReport} disabled={!groups.length}><Printer size={16} /> طباعة التقرير</button></div>
      {!groups.length ? <p className="teacher-empty">لا توجد سجلات حصص لهذا الطالب ضمن الفترة المحددة.</p> : <div className="student-detail-subjects">{groups.map((group, index) => {
        const summary = groupSummary(group)
        const expanded = expandedGroups.has(group.key)
        const detailsId = `student-detail-${index}`
        return <article className="student-detail-subject" key={group.key}>
          <div className="student-detail-subject-head"><div><h3>المادة: {group.subject}</h3><p>المعلم: {group.teacherName} · الصف والفصل: {group.grade} - {group.classroomValue}</p></div><span className={group.grades.length ? 'student-detail-status has-data' : 'student-detail-status'}>{group.grades.length ? `${group.grades.length} سجل` : 'لا توجد سجلات درجات'}</span></div>
          <section className="student-detail-subsection"><h4>درجات وأعمال الطالب</h4>{group.grades.length ? <div className="table-wrap"><table className="responsive-data-table"><thead><tr><th>القسم</th><th>التاريخ الهجري</th><th>البند</th><th>القيمة</th></tr></thead><tbody>{group.grades.flatMap((entry, entryIndex) => entry.columns.map(column => <tr key={`${entry.date}-${entry.sheetType}-${column.id}-${entryIndex}`}><td data-label="القسم">{sheetTypeLabels[entry.sheetType]}</td><td data-label="التاريخ الهجري">{formatHijriDate(entry.date)}</td><td data-label="البند">{column.label}</td><td data-label="القيمة">{gradeValue(entry, column)}</td></tr>))}</tbody></table></div> : <p className="student-detail-no-data">لا توجد درجات أو أعمال مسجلة ضمن الفترة المحددة.</p>}</section>
          <section className="student-detail-subsection"><h4>الحضور وملاحظات الحصص</h4>{group.records.length ? <><table className="student-detail-summary-table"><thead><tr><th>أيام الغياب عن المادة</th><th>عدد الملاحظات</th><th>السجل</th></tr></thead><tbody><tr><td>{summary.absenceDays}</td><td>{summary.noteCount}</td><td><button type="button" className="outline-button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => toggleGroup(group.key)}><ChevronDown size={16} />{expanded ? 'إخفاء السجل' : 'عرض السجل والملاحظات'}</button></td></tr></tbody></table>{expanded && <div className="table-wrap" id={detailsId}><table className="responsive-data-table"><thead><tr><th>التاريخ الهجري</th><th>الحصة</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>{group.records.map((record, recordIndex) => <tr key={`${record.date}-${record.periodNumber}-${recordIndex}`}><td data-label="التاريخ الهجري">{formatHijriDate(record.date)}</td><td data-label="الحصة">{record.periodNumber}</td><td data-label="الحالة">{statusLabel(record.status)}</td><td data-label="الملاحظة">{record.note || '—'}</td></tr>)}</tbody></table></div>}</> : <p className="student-detail-no-data">لا توجد سجلات حصص ضمن الفترة المحددة.</p>}</section>
        </article>
      })}</div>}
    </>}
  </section>
}