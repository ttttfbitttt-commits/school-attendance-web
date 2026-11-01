import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, Plus, Save, Users } from 'lucide-react'
import { api, type LessonFlowOverview, type VoiceTimetableConfiguration, type VoiceTimetableProject } from './api'

type Props = { schoolName: string; onOpenLessonFlow: () => void }
const empty: VoiceTimetableConfiguration = { classes: [], subjects: [], assignments: [] }
const newId = () => crypto.randomUUID()

export function VoiceTimetableCenter({ schoolName, onOpenLessonFlow }: Props) {
  const [overview, setOverview] = useState<LessonFlowOverview | null>(null)
  const [project, setProject] = useState<VoiceTimetableProject | null>(null)
  const [configuration, setConfiguration] = useState<VoiceTimetableConfiguration>(empty)
  const [className, setClassName] = useState(''); const [subjectName, setSubjectName] = useState(''); const [subjectLoad, setSubjectLoad] = useState('4')
  const [notice, setNotice] = useState(''); const [saving, setSaving] = useState(false)
  useEffect(() => { void Promise.all([api.lessonOverview(), api.voiceTimetableProject()]).then(([data, voiceProject]) => { setOverview(data); setProject(voiceProject); setConfiguration(voiceProject.configuration) }).catch(() => setNotice('تعذر تحميل إعدادات الجدول الصوتي.')) }, [])
  const ready = Boolean(overview && overview.summary.teachers && overview.summary.classrooms && overview.summary.assignments && overview.summary.unresolved === 0)
  const addClass = () => { const name = className.trim(); if (!name) return; setConfiguration(value => ({ ...value, classes: [...value.classes, { id: newId(), name }] })); setClassName('') }
  const addSubject = () => { const name = subjectName.trim(); if (!name) return; setConfiguration(value => ({ ...value, subjects: [...value.subjects, { id: newId(), name, weeklyLessons: Math.max(1, Number(subjectLoad) || 1) }] })); setSubjectName('') }
  const assign = (classId: string, subjectId: string, teacherId: string) => setConfiguration(value => ({
    ...value,
    assignments: [...value.assignments.filter(item => !(item.classId === classId && item.subjectId === subjectId)), ...(teacherId ? [{ classId, subjectId, teacherId }] : [])],
  }))
  const save = async () => { setSaving(true); setNotice(''); try { const next = await api.saveVoiceTimetableProject(configuration); setProject(next); setConfiguration(next.configuration); setNotice('حُفظت الفصول والمواد والإسنادات في سجل المدرسة.') } catch { setNotice('تعذر الحفظ. أعد المحاولة.') } finally { setSaving(false) } }
  return <section className="voice-timetable" dir="rtl">
    <header className="voice-timetable-hero"><div><span className="panel-kicker">نظام الحصر · الجدول الصوتي</span><h2>الجدول الصوتي</h2><p>ابدأ من هنا: الفصول والمواد والإسنادات، ثم ننتقل إلى التوقيت والجدول والانتظار والتكليفات.</p></div><CalendarDays size={42} /></header>
    {!project ? <p className="teacher-empty">جارٍ تحميل إعدادات {schoolName || 'المدرسة'}…</p> : <>
      <div className="voice-timetable-stats"><article><Users size={20} /><span>معلمو الحصر</span><strong>{project.teachers.length}</strong></article><article><CalendarDays size={20} /><span>فصول الجدول</span><strong>{configuration.classes.length}</strong></article><article><Clock3 size={20} /><span>إسنادات مكتملة</span><strong>{configuration.assignments.length}</strong></article><article className={ready ? 'ready' : 'needs-review'}><CheckCircle2 size={20} /><span>بيانات سير الحصص</span><strong>{ready ? 'جاهزة' : 'تحتاج إعدادًا'}</strong></article></div>
      <article className="voice-timetable-card"><span className="panel-kicker">1. الفصول والمواد</span><h3>أنشئ مكونات الخطة</h3><div className="voice-timetable-form"><label>اسم الفصل<input value={className} onChange={event => setClassName(event.target.value)} placeholder="مثال: أول 1" /></label><button type="button" className="outline-button" onClick={addClass}><Plus size={16} />إضافة فصل</button><label>اسم المادة<input value={subjectName} onChange={event => setSubjectName(event.target.value)} placeholder="مثال: الرياضيات" /></label><label>حصص أسبوعية<input type="number" min="1" max="40" value={subjectLoad} onChange={event => setSubjectLoad(event.target.value)} /></label><button type="button" className="outline-button" onClick={addSubject}><Plus size={16} />إضافة مادة</button></div><div className="voice-timetable-chips">{configuration.classes.map(item => <button key={item.id} type="button" onClick={() => setConfiguration(value => ({ ...value, classes: value.classes.filter(row => row.id !== item.id), assignments: value.assignments.filter(row => row.classId !== item.id) }))}>{item.name} ×</button>)}{configuration.subjects.map(item => <button key={item.id} type="button" onClick={() => setConfiguration(value => ({ ...value, subjects: value.subjects.filter(row => row.id !== item.id), assignments: value.assignments.filter(row => row.subjectId !== item.id) }))}>{item.name} · {item.weeklyLessons} حصص ×</button>)}</div></article>
      <article className="voice-timetable-card">
        <span className="panel-kicker">2. الإسنادات</span><h3>اربط مادة كل فصل بمعلم</h3>
        {configuration.classes.length && configuration.subjects.length ? <div className="voice-timetable-assignments">
          {configuration.classes.flatMap(classroom => configuration.subjects.map(subject => {
            const current = configuration.assignments.find(item => item.classId === classroom.id && item.subjectId === subject.id)
            return <label key={`${classroom.id}:${subject.id}`}><span><b>{classroom.name}</b><small>{subject.name} · {subject.weeklyLessons} حصص</small></span><select value={current?.teacherId || ''} onChange={event => assign(classroom.id, subject.id, event.target.value)}><option value="">اختر المعلم</option>{project.teachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name}</option>)}</select></label>
          }))}
        </div> : <p>أضف فصلًا ومادة أولًا لتظهر حقول الإسناد.</p>}
        <div className="feature-actions"><button type="button" className="primary-button" onClick={() => void save()} disabled={saving}><Save size={16} />{saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button><button type="button" className="secondary-button" onClick={onOpenLessonFlow}>مراجعة جدول سير الحصص</button></div>{notice && <p className="lesson-time-hint">{notice}</p>}
      </article>
    </>}
  </section>
}
