import { useEffect, useState } from 'react'
import { BookOpenCheck, FolderOpen, Image, RefreshCw, Users } from 'lucide-react'
import { api, type StudentPortfolioEntries, type StudentPortfolioGroup } from './api'

export function StudentPortfolioBoard({ scope = 'school' }: { scope?: 'school' | 'teacher' }) {
  const [groups, setGroups] = useState<StudentPortfolioGroup[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [entries, setEntries] = useState<StudentPortfolioEntries | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const loadGroups = async () => {
    setBusy(true)
    setError('')
    try {
      const result = scope === 'teacher' ? await api.teacherPortfolioGroups() : await api.schoolPortfolioGroups()
      setGroups(result.groups)
      setSelectedId(current => result.groups.some(group => group.assignmentId === current) ? current : result.groups[0]?.assignmentId || '')
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
        const result = scope === 'teacher' ? await api.teacherPortfolioEntries(selectedId) : await api.schoolPortfolioEntries(selectedId)
        if (active) setEntries(result)
      } catch { if (active) setError('تعذر فتح طلاب هذه المادة.') }
    }
    void loadEntries()
    return () => { active = false }
  }, [selectedId, scope])

  return <section className="student-portfolio-admin" dir="rtl">
    <div className="student-portfolio-head">
      <div><span>{scope === 'teacher' ? 'ملفات طلاب فصولك' : 'ملفات جميع الطلاب'}</span><h2>ملف الإنجاز</h2><p>{scope === 'teacher' ? 'تعرض هذه الصفحة المواد والفصول المسندة إليك فقط.' : 'اختر المادة والفصل ثم راجع صور إنجازات الطلاب.'}</p></div>
      <button type="button" className="outline-button" onClick={() => void loadGroups()} disabled={busy}><RefreshCw size={16} /> تحديث</button>
    </div>
    {error && <p className="student-portal-notice error">{error}</p>}
    {busy ? <p className="teacher-empty">جارٍ تحميل ملف الإنجاز…</p> : !groups.length ? <div className="student-portfolio-empty"><BookOpenCheck size={34} /><strong>لا توجد مواد مرتبطة بطلاب بعد</strong><p>أكمل استيراد الجدول وربط الفصل بالطلاب لتظهر المواد هنا.</p></div> : <>
      <div className="student-portfolio-group-grid">
        {groups.map(group => <button type="button" key={group.assignmentId} className={selectedId === group.assignmentId ? 'active' : ''} onClick={() => setSelectedId(group.assignmentId)}>
          <FolderOpen size={23} /><strong>{group.subject}</strong><span>{group.teacherName}</span><small>{group.grade} · الفصل {group.classroom}</small><em><Users size={13} /> {group.studentCount} طالب · <Image size={13} /> {group.submittedFiles} صورة</em>
        </button>)}
      </div>
      {selectedId && !entries && <p className="teacher-empty">جارٍ تحميل طلاب المادة…</p>}
      {entries && <section className="student-portfolio-entries">
        <header><div><span>{entries.grade} · الفصل {entries.classroom}</span><h3>{entries.subject}</h3><p>المعلم: {entries.teacherName}</p></div><strong>{entries.students.length} طالبًا</strong></header>
        <div className="student-portfolio-students">
          {entries.students.map(student => <article key={student.id}>
            <div className="student-portfolio-student-name"><b>{student.name}</b><span dir="ltr">{student.identityNumber}</span></div>
            <div className="student-portfolio-slot-list">{student.slots.map(slot => <div className={`student-portfolio-slot ${slot.imageUrl ? 'filled' : ''}`} key={slot.slotNumber}>
              {slot.imageUrl ? <a href={slot.imageUrl} target="_blank" rel="noreferrer"><img src={slot.imageUrl} alt={`إنجاز ${student.name} ${slot.slotNumber}`} /></a> : <span>المربع {slot.slotNumber}<small>لم تُرفع صورة</small></span>}
            </div>)}</div>
          </article>)}
        </div>
      </section>}
    </>}
  </section>
}
