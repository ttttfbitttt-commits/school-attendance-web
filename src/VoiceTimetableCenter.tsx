import { useEffect, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, Users } from 'lucide-react'
import { api, type LessonFlowOverview } from './api'

type Props = { schoolName: string; onOpenLessonFlow: () => void }

export function VoiceTimetableCenter({ schoolName, onOpenLessonFlow }: Props) {
  const [overview, setOverview] = useState<LessonFlowOverview | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void api.lessonOverview()
      .then(result => { if (active) setOverview(result) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const ready = Boolean(overview && overview.summary.teachers && overview.summary.classrooms && overview.summary.assignments && overview.summary.unresolved === 0)
  return <section className="voice-timetable" dir="rtl">
    <header className="voice-timetable-hero">
      <div><span className="panel-kicker">نظام الحصر · الجدول الصوتي</span><h2>الجدول الصوتي</h2><p>منصة إعداد الجدول وحصص الانتظار داخل نظام الحصر. تستخدم معلمي ومدرستك نفسهم، لتنتقل تكليفات الغياب إلى سير الحصص دون إعادة إدخال.</p></div>
      <CalendarDays size={42} aria-hidden="true" />
    </header>

    {loading ? <p className="teacher-empty">جارٍ التحقق من جاهزية جدول {schoolName || 'المدرسة'}…</p> : <>
      <div className="voice-timetable-stats">
        <article><Users size={20} /><span>المعلمون</span><strong>{overview?.summary.teachers || 0}</strong></article>
        <article><CalendarDays size={20} /><span>الفصول</span><strong>{overview?.summary.classrooms || 0}</strong></article>
        <article><Clock3 size={20} /><span>الحصص المسندة</span><strong>{overview?.summary.assignments || 0}</strong></article>
        <article className={ready ? 'ready' : 'needs-review'}><CheckCircle2 size={20} /><span>حالة الربط</span><strong>{ready ? 'جاهز' : 'قيد الإعداد'}</strong></article>
      </div>

      <article className="voice-timetable-card">
        <span className="panel-kicker">المرحلة الأولى من الدمج</span>
        <h3>{ready ? 'بيانات جدول المدرسة جاهزة للتكليفات' : 'ابدأ بإعداد بيانات الجدول داخل الحصر'}</h3>
        <p>{ready ? 'تم العثور على المعلمين والفصول والحصص دون أسماء غير مطابقة. سيكون هذا الجدول هو مصدر تكليفات الانتظار التي تظهر تلقائيًا في سير الحصص.' : 'أكمل استيراد المعلمين والفصول والجدول من «سير الحصص» أولًا. لا تُنشأ أي تكليفات تلقائية قبل اكتمال هذه البيانات.'}</p>
        {overview?.summary.unresolved ? <p className="voice-timetable-warning">توجد {overview.summary.unresolved} أسماء معلمين تحتاج مطابقة قبل اعتماد الجدول.</p> : null}
        <button type="button" className="primary-button" onClick={onOpenLessonFlow}>فتح إعداد جدول المدرسة</button>
      </article>

      <article className="voice-timetable-card muted-card">
        <h3>ما الذي سيعمل هنا؟</h3>
        <ul><li>إعداد التوقيت والجدول والحصص من بيانات المدرسة الحالية.</li><li>توزيع حصص الانتظار للمعلمين المتاحين.</li><li>عند تأكيد الغياب: إدراج البديل والفصل والمادة والحصة مباشرة في سير الحصص.</li><li>حفظ التوقيع والتقرير الرسمي في سجل واحد للمدرسة.</li></ul>
      </article>

    </>}
  </section>
}
