import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpenCheck, FileText, FolderOpen, Image, Layers3, Printer, RefreshCw, Users } from 'lucide-react'
import { api, type StudentPortfolioEntries, type StudentPortfolioGroup } from './api'
import { PortfolioFilePreview, type PortfolioPreviewFile } from './PortfolioFilePreview'
import { openPrintDocument } from './SchoolFeatures'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

const gradeRank = (grade: string) => {
  const normalized = String(grade || '').trim().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  if (/(^|\s)(اول|الاول)(\s|$)/.test(normalized)) return 1
  if (/(^|\s)(ثاني|الثاني)(\s|$)/.test(normalized)) return 2
  if (/(^|\s)(ثالث|الثالث)(\s|$)/.test(normalized)) return 3
  if (/(^|\s)(رابع|الرابع)(\s|$)/.test(normalized)) return 4
  if (/(^|\s)(خامس|الخامس)(\s|$)/.test(normalized)) return 5
  if (/(^|\s)(سادس|السادس)(\s|$)/.test(normalized)) return 6
  return 99
}

const compareClassrooms = (left: { grade: string; classroom: string }, right: { grade: string; classroom: string }) =>
  gradeRank(left.grade) - gradeRank(right.grade)
  || left.grade.localeCompare(right.grade, 'ar', { numeric: true, sensitivity: 'base' })
  || left.classroom.localeCompare(right.classroom, 'ar', { numeric: true, sensitivity: 'base' })

function portfolioReportHtml(entries: StudentPortfolioEntries) {
  const rows = entries.students.map((student, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(student.name)}</td><td dir="ltr">${escapeHtml(student.identityNumber)}</td><td>${student.slots.filter(slot => slot.fileUrl).length} من ${student.slots.length}</td><td>${student.slots.filter(slot => slot.fileUrl).map(slot => escapeHtml(slot.fileName || `المربع ${slot.slotNumber}`)).join('<br/>') || 'لا توجد ملفات مرفوعة'}</td></tr>`).join('')
  return `<section class="page"><h1>ملف إنجاز الطلاب</h1><p class="report-date">${escapeHtml(entries.subject)} · ${escapeHtml(entries.grade)} · الفصل ${escapeHtml(entries.classroom)}</p><p class="meta">المعلم: ${escapeHtml(entries.teacherName)} · عدد الطلاب: ${entries.students.length}</p><table><thead><tr><th>م</th><th>الطالب</th><th>رقم الهوية</th><th>الإنجازات</th><th>الملفات المرفوعة</th></tr></thead><tbody>${rows || '<tr><td colspan="5">لا يوجد طلاب في هذا الفصل.</td></tr>'}</tbody></table></section>`
}

export function StudentPortfolioBoard({ scope = 'school', schoolName = 'المدرسة' }: { scope?: 'school' | 'teacher' | 'activityLeader'; schoolName?: string }) {
  const [groups, setGroups] = useState<StudentPortfolioGroup[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedClassroom, setSelectedClassroom] = useState('')
  const [entries, setEntries] = useState<StudentPortfolioEntries | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PortfolioPreviewFile | null>(null)

  const loadGroups = async () => {
    setBusy(true)
    setError('')
    try {
      const result = scope === 'teacher' ? await api.teacherPortfolioGroups() : scope === 'activityLeader' ? await api.activityLeaderPortfolioGroups() : await api.schoolPortfolioGroups()
      setGroups(result.groups)
      setSelectedClassroom(current => result.groups.some(group => `${group.grade}:${group.classroom}` === current) ? current : '')
      setSelectedId(current => result.groups.some(group => group.assignmentId === current) ? current : '')
    } catch {
      setError('تعذر تحميل مواد ملف الإنجاز الآن.')
    } finally { setBusy(false) }
  }

  useEffect(() => { void loadGroups() }, [scope])
  useEffect(() => {
    if (!selectedId) { setEntries(null); return }
    let active = true
    setEntries(null)
    setError('')
    const loadEntries = async () => {
      try {
        const result = scope === 'teacher' ? await api.teacherPortfolioEntries(selectedId) : scope === 'activityLeader' ? await api.activityLeaderPortfolioEntries(selectedId) : await api.schoolPortfolioEntries(selectedId)
        if (active) setEntries(result)
      } catch { if (active) setError('تعذر فتح طلاب هذه المادة.') }
    }
    void loadEntries()
    return () => { active = false }
  }, [selectedId, scope])

  const classrooms = useMemo(() => {
    const byClassroom = new Map<string, { key: string; grade: string; classroom: string; students: number; files: number; subjects: number }>()
    for (const group of groups) {
      const key = `${group.grade}:${group.classroom}`
      const current = byClassroom.get(key) || { key, grade: group.grade, classroom: group.classroom, students: group.studentCount, files: 0, subjects: 0 }
      current.students = Math.max(current.students, group.studentCount)
      current.files += group.submittedFiles
      current.subjects += 1
      byClassroom.set(key, current)
    }
    return [...byClassroom.values()].sort(compareClassrooms)
  }, [groups])
  const classSubjects = useMemo(() => groups
    .filter(group => `${group.grade}:${group.classroom}` === selectedClassroom)
    .sort((left, right) => left.subject.localeCompare(right.subject, 'ar', { numeric: true, sensitivity: 'base' }) || left.teacherName.localeCompare(right.teacherName, 'ar', { numeric: true, sensitivity: 'base' })), [groups, selectedClassroom])
  const chooseClassroom = (key: string) => { setSelectedClassroom(key); setSelectedId(''); setEntries(null) }

  return <section className="student-portfolio-admin" dir="rtl">
    <div className="student-portfolio-head">
      <div><span>{scope === 'teacher' ? 'ملفات طلاب فصولك' : 'ملفات جميع الطلاب'}</span><h2>ملف الإنجاز</h2><p>{scope === 'teacher' ? 'تعرض هذه الصفحة المواد والفصول المسندة إليك فقط.' : 'اختر الفصل، ثم المادة، ثم راجع ملفات الطلاب.'}</p></div>
      <button type="button" className="outline-button" onClick={() => void loadGroups()} disabled={busy}><RefreshCw size={16} /> تحديث</button>
    </div>
    {error && <p className="student-portal-notice error">{error}</p>}
    {busy ? <p className="teacher-empty">جارٍ تحميل ملف الإنجاز…</p> : !groups.length ? <div className="student-portfolio-empty"><BookOpenCheck size={34} /><strong>لا توجد مواد مرتبطة بطلاب بعد</strong><p>أكمل استيراد الجدول وربط الفصل بالطلاب لتظهر المواد هنا.</p></div> : <>
      {!selectedClassroom ? <div className="student-portfolio-classroom-grid">{classrooms.map(classroom => <button type="button" key={classroom.key} onClick={() => chooseClassroom(classroom.key)}><Layers3 size={25} /><strong>{classroom.grade}</strong><span>الفصل {classroom.classroom}</span><small><Users size={13} /> {classroom.students} طالب · <Image size={13} /> {classroom.files} ملف</small><em>{classroom.subjects} مواد <ArrowRight size={15} /></em></button>)}</div> : <>
        <div className="student-portfolio-classroom-bar"><button type="button" className="outline-button" onClick={() => chooseClassroom('')}><ArrowRight size={16} /> الفصول</button><div><span>{classSubjects[0]?.grade}</span><strong>الفصل {classSubjects[0]?.classroom}</strong></div></div>
        <div className="student-portfolio-group-grid">
          {classSubjects.map(group => <button type="button" key={group.assignmentId} className={selectedId === group.assignmentId ? 'active' : ''} onClick={() => setSelectedId(group.assignmentId)}>
            <FolderOpen size={23} /><strong>{group.subject}</strong><span>{group.teacherName}</span><small>{group.grade} · الفصل {group.classroom}</small><em><Users size={13} /> {group.studentCount} طالب · <Image size={13} /> {group.submittedFiles} ملف</em>
          </button>)}
        </div>
      </>}
      {selectedId && !entries && <p className="teacher-empty">جارٍ تحميل طلاب المادة…</p>}
      {entries && <section className="student-portfolio-entries">
        <header><div><span>{entries.grade} · الفصل {entries.classroom}</span><h3>{entries.subject}</h3><p>المعلم: {entries.teacherName}</p></div><div className="teacher-report-actions"><strong>{entries.students.length} طالبًا</strong>{scope === 'activityLeader' && <button type="button" className="outline-button" onClick={() => openPrintDocument(`ملف إنجاز الطلاب - ${entries.subject}`, portfolioReportHtml(entries), schoolName, 'landscape')}><Printer size={16} />طباعة / حفظ PDF</button>}</div></header>
        <div className="student-portfolio-students">
          {entries.students.map(student => <article key={student.id}>
            <div className="student-portfolio-student-name"><b>{student.name}</b><span dir="ltr">{student.identityNumber}</span></div>
            <div className="student-portfolio-slot-list">{student.slots.map(slot => <div className={`student-portfolio-slot ${slot.fileUrl ? 'filled' : ''}`} key={slot.slotNumber}>
              {slot.fileUrl ? slot.fileType.startsWith('image/') ? <button type="button" className="student-portfolio-image-button" onClick={() => setPreview(slot)}><img src={slot.fileUrl} alt={`إنجاز ${student.name} ${slot.slotNumber}`} /></button> : <button type="button" className="student-portfolio-file-link" onClick={() => setPreview(slot)}><FileText size={20} /><span>{slot.fileName || 'فتح الملف'}</span></button> : <span>المربع {slot.slotNumber}<small>لم يُرفع ملف</small></span>}
            </div>)}</div>
          </article>)}
        </div>
      </section>}
    </>}
    {preview && <PortfolioFilePreview file={preview} onClose={() => setPreview(null)} />}
  </section>
}
