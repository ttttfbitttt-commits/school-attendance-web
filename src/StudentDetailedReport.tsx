import { useMemo, useState } from 'react'
import { ChevronDown, Printer, Search } from 'lucide-react'
import { api, type DetailedStudentReport } from './api'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate } from './dateUtils'

type StudentOption = { id: string; name: string; grade: string; classroom: string; phone: string }
type LessonRecord = DetailedStudentReport['lessons'][number]
type SubjectGroup = {
  key: string
  subject: string
  teacherName: string
  grade: string
  classroomValue: string
  records: LessonRecord[]
}

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
  report.lessons.forEach(record => {
    const key = JSON.stringify([record.subject, record.teacherName, record.grade, record.classroomValue])
    const group = groups.get(key) || {
      key,
      subject: record.subject || 'مادة غير محددة',
      teacherName: record.teacherName,
      grade: record.grade,
      classroomValue: record.classroomValue,
      records: [],
    }
    group.records.push(record)
    groups.set(key, group)
  })
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
      return `<h2>المادة: ${escapeHtml(group.subject)}</h2>
        <p><strong>المعلم:</strong> ${escapeHtml(group.teacherName)}　 <strong>الصف والفصل:</strong> ${escapeHtml(group.grade)} - ${escapeHtml(group.classroomValue)}</p>
        <p>أيام الغياب عن حصص المادة: ${summary.absenceDays}　 <strong>عدد الملاحظات: ${summary.noteCount}</strong></p>
        <table><thead><tr><th>التاريخ الهجري</th><th>الحصة</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>${group.records.map(record => `<tr><td>${escapeHtml(formatHijriDate(record.date))}</td><td>${record.periodNumber}</td><td>${statusLabel(record.status)}</td><td>${escapeHtml(record.note || '—')}</td></tr>`).join('')}</tbody></table>`
    }).join('<hr/>')
    const contents = `<section class="page"><h1>تقرير مفصل عن الطالب</h1>
      <div class="heading"><p><strong>اسم الطالب:</strong> ${escapeHtml(report.student.name)}</p>
      <p><strong>الصف والفصل:</strong> ${escapeHtml(report.student.grade)} - ${escapeHtml(report.student.classroom)}</p>
      <p><strong>أيام الغياب عن المدرسة:</strong> ${report.summary.schoolAbsenceDays}　 <strong>أيام التأخر عن المدرسة:</strong> ${report.summary.schoolLateDays}</p>
      <p><strong>الفترة الهجرية:</strong> ${escapeHtml(formatHijriDate(report.from))} إلى ${escapeHtml(formatHijriDate(report.to))}</p></div>${groupHtml}</section>`
    printDocument('تقرير مفصل عن الطالب', contents, schoolName)
  }

  return <section className="panel student-detail-report">
    <div className="panel-header"><div><span className="panel-kicker">سجل الطالب</span><h2>التقرير المفصل للطالب</h2><p>يعرض الغياب المدرسي منفصلاً عن غياب الحصص وملاحظات المعلمين.</p></div></div>
    <div className="student-detail-controls">
      <label className="student-detail-search"><Search size={17} /><input value={search} onChange={event => { setSearch(event.target.value); setStudent(null); setReport(null) }} placeholder="ابحث باسم الطالب..." autoComplete="off" aria-label="ابحث باسم الطالب" /></label>
      {!student && suggestions.length > 0 && <div className="student-detail-suggestions" role="listbox">{suggestions.map(item => <button type="button" role="option" key={item.id} onClick={() => chooseStudent(item)}>{item.name}<small>{item.grade} · {item.classroom}</small></button>)}</div>}
      {search.trim() && !suggestions.length && !student && <p className="teacher-empty">لا توجد أسماء مطابقة.</p>}
      {student && <div className="student-detail-range"><HijriDatePicker label="من التاريخ الهجري" value={from} max={to} onChange={setFrom} /><HijriDatePicker label="إلى التاريخ الهجري" value={to} min={from} max={today()} onChange={setTo} /><button type="button" className="primary-button" onClick={() => void load(student)} disabled={busy || !from || !to}>{busy ? 'جارٍ التحميل…' : 'تحديث التقرير'}</button></div>}
    </div>
    {error && <p className="teacher-notice error" role="alert">{error}</p>}
    {busy && <p className="teacher-empty">جارٍ تحميل بيانات الطالب...</p>}
    {report && <>
      <section className="student-detail-summary"><h3>تقرير مفصل عن الطالب</h3><strong>{report.student.name}</strong><span>{report.student.grade} · {report.student.classroom}</span><div><b>أيام الغياب عن المدرسة: {report.summary.schoolAbsenceDays}</b><b>أيام التأخر عن المدرسة: {report.summary.schoolLateDays}</b><small>الفترة الهجرية: {formatHijriDate(report.from)} إلى {formatHijriDate(report.to)}</small></div></section>
      <div className="student-detail-print"><label>المواد<select value={printSubject} onChange={event => setPrintSubject(event.target.value)}><option value="all">جميع المواد</option>{groups.map(group => <option key={group.key} value={group.key}>{group.subject} · {group.teacherName}</option>)}</select></label><button type="button" className="export-btn pdf" onClick={printReport} disabled={!groups.length}><Printer size={16} /> طباعة التقرير</button></div>
      {!groups.length ? <p className="teacher-empty">لا توجد سجلات حصص لهذا الطالب ضمن الفترة المحددة.</p> : <div className="student-detail-subjects">{groups.map((group, index) => {
        const summary = groupSummary(group)
        const expanded = expandedGroups.has(group.key)
        const detailsId = `student-detail-${index}`
        return <article className="student-detail-subject" key={group.key}>
          <div className="student-detail-subject-head"><div><h3>المادة: {group.subject}</h3><p>المعلم: {group.teacherName} · الصف والفصل: {group.grade} - {group.classroomValue}</p></div></div>
          <table className="student-detail-summary-table"><thead><tr><th>أيام الغياب عن المادة</th><th>عدد الملاحظات</th><th>السجل</th></tr></thead><tbody><tr><td>{summary.absenceDays}</td><td>{summary.noteCount}</td><td><button type="button" className="outline-button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => toggleGroup(group.key)}><ChevronDown size={16} />{expanded ? 'إخفاء السجل' : 'عرض السجل والملاحظات'}</button></td></tr></tbody></table>
          {expanded && <div className="table-wrap" id={detailsId}><table className="responsive-data-table"><thead><tr><th>التاريخ الهجري</th><th>الحصة</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>{group.records.map((record, recordIndex) => <tr key={`${record.date}-${record.periodNumber}-${recordIndex}`}><td data-label="التاريخ الهجري">{formatHijriDate(record.date)}</td><td data-label="الحصة">{record.periodNumber}</td><td data-label="الحالة">{statusLabel(record.status)}</td><td data-label="الملاحظة">{record.note || '—'}</td></tr>)}</tbody></table></div>}
        </article>
      })}</div>}
    </>}
  </section>
}