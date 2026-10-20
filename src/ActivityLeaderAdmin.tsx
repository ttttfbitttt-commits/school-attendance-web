import { CalendarDays, Sparkles } from 'lucide-react'

export function ActivityLeaderAdminCenter() {
  return <section className="teacher-admin counselor-admin" dir="rtl">
    <header className="teacher-section-head">
      <div>
        <span>إدارة النشاط المدرسي</span>
        <h3>رائد النشاط</h3>
        <p>هذه الصفحة مخصصة لإدارة حساب رائد النشاط والأنشطة والشواهد المرتبطة بها.</p>
      </div>
      <Sparkles size={30} />
    </header>
    <section className="teacher-accounts-panel">
      <div className="teacher-empty">
        <CalendarDays size={28} />
        <strong>تمت إضافة تبويب رائد النشاط</strong>
        <span>سنضيف في الخطوة التالية نموذج إنشاء حساب رائد النشاط وصلاحياته.</span>
      </div>
    </section>
  </section>
}
