import { type FormEvent, useEffect, useState } from 'react'
import { ArrowLeftRight, Building2, CheckCircle2, ClipboardList, PhoneCall, RefreshCw, ShieldCheck, UserRoundCheck, X } from 'lucide-react'
import { api } from './api'

type GuideRole = 'school' | 'vice' | 'counselor'

const roleDetails: Record<GuideRole, { eyebrow: string; title: string; description: string; task: string; next: string; Icon: typeof Building2 }> = {
  school: {
    eyebrow: 'إدارة المدرسة',
    title: 'دليل سير إجراءات التعامل مع الغياب',
    description: 'يعرض هذا الدليل مسار العمل المشترك بين المدرسة والوكيل والموجّه الطلابي قبل بدء التحويلات الإلكترونية.',
    task: 'الإشراف على جميع الحالات، ومراجعة ما يتم توثيقه واعتماد الإجراء النهائي عند الحاجة.',
    next: 'في الخطوة التالية ستظهر الحالات المعتمدة ومتابعة مراحلها من لوحة واحدة.',
    Icon: Building2,
  },
  vice: {
    eyebrow: 'بوابة وكيل المدرسة',
    title: 'دور الوكيل في متابعة الغياب',
    description: 'يتولى الوكيل أول متابعة بشرية بعد اعتماد الغياب، ويوثق التواصل مع ولي الأمر قبل تحويل الحالة.',
    task: 'مراجعة الغياب المعتمد لمرحلتك، وتوثيق التواصل مع ولي الأمر، ثم تحويل الحالة للموجّه عند تحقق المرحلة المطلوبة.',
    next: 'في الخطوة التالية ستصل لك الحالات الخاصة بمرحلتك مع زر تحويل إلكتروني للموجّه.',
    Icon: UserRoundCheck,
  },
  counselor: {
    eyebrow: 'بوابة الموجّه الطلابي',
    title: 'دور الموجّه في متابعة الغياب',
    description: 'يتسلم الموجّه الحالات المحولة إليه فقط، ويستكمل دراسة الحالة وخطة الدعم دون تكرار بيانات الوكيل.',
    task: 'دراسة الحالة المحولة لمرحلتك، وتوثيق خطة الدعم والإجراء المتخذ، ثم طلب متابعة الوكيل أو إرسالها لاعتماد المدرسة.',
    next: 'في الخطوة التالية ستظهر الحالات المحولة إليك مع كامل سجلها الزمني.',
    Icon: ShieldCheck,
  },
}

const steps = [
  { title: 'اعتماد الغياب', text: 'لا تبدأ الإجراءات إلا من الغياب الذي اعتمد في سجل الحضور.', icon: CheckCircle2 },
  { title: 'توثيق التواصل', text: 'يوثق الوكيل التواصل مع ولي الأمر والإجراء الأولي في نفس ملف الحالة.', icon: ClipboardList },
  { title: 'تحويل إلكتروني للموجّه', text: 'عند تحقق المرحلة المناسبة يحول الوكيل الحالة بضغطة واحدة مع كامل بياناتها.', icon: ArrowLeftRight },
  { title: 'دراسة الحالة والاعتماد', text: 'يوثق الموجّه الخطة، وتتابع المدرسة الحالة وتعتمد ما يلزم.', icon: ShieldCheck },
]

export function AbsenceProcedureGuide({ role }: { role: GuideRole }) {
  const details = roleDetails[role]
  const RoleIcon = details.Icon

  return <section className="absence-procedure-guide" aria-labelledby="absence-procedure-title">
    <header className="absence-procedure-head">
      <div>
        <span>{details.eyebrow}</span>
        <div className="absence-procedure-title-row"><h2 id="absence-procedure-title">{details.title}</h2><b className="absence-procedure-new-badge">جديد</b></div>
        <p>{details.description}</p>
      </div>
      <RoleIcon aria-hidden="true" size={36} />
    </header>

    <section className="absence-procedure-role-card">
      <strong>مهمتك في هذه المرحلة</strong>
      <p>{details.task}</p>
      <small>{details.next}</small>
    </section>

    <ol className="absence-procedure-steps">
      {steps.map(({ title, text, icon: Icon }, index) => <li key={title}>
        <span className="absence-procedure-step-number">{index + 1}</span>
        <Icon size={21} aria-hidden="true" />
        <div><strong>{title}</strong><p>{text}</p></div>
      </li>)}
    </ol>

    <footer className="absence-procedure-note"><ShieldCheck size={18} aria-hidden="true" /><span><strong>هذه المرحلة إرشادية فقط.</strong> لا تنشئ حالات، ولا تغيّر سجل الحضور، ولا ترسل رسائل أو تحويلات.</span></footer>
  </section>
}

type ViceApprovedAbsenceQueue = Awaited<ReturnType<typeof api.viceApprovedAbsenceProcedureQueue>>
type ViceApprovedAbsenceRow = ViceApprovedAbsenceQueue['rows'][number]
type ContactForm = { outcome: 'contacted' | 'no_answer'; method: 'phone' | 'sms' | 'whatsapp' | 'visit' | 'other'; note: string }
type ReferralForm = { note: string }

function riyadhToday() {
  const values = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date())
  const part = (name: string) => values.find(value => value.type === name)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function absenceStatusLabel(status: 'unexcused' | 'excused' | 'special') {
  return status === 'excused' ? 'غياب بعذر' : status === 'special' ? 'غياب خاص' : 'غياب بدون عذر'
}

function contactMethodLabel(method: ViceApprovedAbsenceRow['contactMethod']) {
  return method === 'phone' ? 'مكالمة هاتفية' : method === 'sms' ? 'رسالة نصية' : method === 'whatsapp' ? 'واتساب' : method === 'visit' ? 'زيارة' : method === 'other' ? 'طريقة أخرى' : ''
}

function contactStamp(value: string | null) {
  if (!value) return ''
  return new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function ViceApprovedAbsenceProcedureQueue() {
  const [date, setDate] = useState(riyadhToday)
  const [queue, setQueue] = useState<ViceApprovedAbsenceQueue | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<ViceApprovedAbsenceRow | null>(null)
  const [contactForm, setContactForm] = useState<ContactForm>({ outcome: 'contacted', method: 'phone', note: '' })
  const [contactError, setContactError] = useState('')
  const [savingContact, setSavingContact] = useState(false)
  const [referring, setReferring] = useState<ViceApprovedAbsenceRow | null>(null)
  const [referralForm, setReferralForm] = useState<ReferralForm>({ note: '' })
  const [referralError, setReferralError] = useState('')
  const [savingReferral, setSavingReferral] = useState(false)

  const load = async (targetDate = date) => {
    setLoading(true)
    setError('')
    try { setQueue(await api.viceApprovedAbsenceProcedureQueue(targetDate)) }
    catch { setError('تعذر تحميل الغياب المعتمد حالياً. حدّث القائمة أو حاول مرة أخرى.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const openContact = (row: ViceApprovedAbsenceRow) => {
    setEditing(row)
    setContactForm({ outcome: row.contactOutcome || 'contacted', method: row.contactMethod || 'phone', note: row.contactNote || '' })
    setContactError('')
  }

  const openReferral = (row: ViceApprovedAbsenceRow) => {
    setReferring(row)
    setReferralForm({ note: row.referralNote || '' })
    setReferralError('')
  }

  const saveContact = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    setSavingContact(true)
    setContactError('')
    setNotice('')
    try {
      const result = await api.recordViceAbsenceContact({ studentId: editing.studentId, date, ...contactForm })
      setQueue(current => current ? { ...current, rows: current.rows.map(row => row.studentId === editing.studentId ? { ...row, ...result.contact } : row) } : current)
      setNotice('تم توثيق التواصل في ملف متابعة الطالب.')
      setEditing(null)
    } catch { setContactError('تعذر حفظ التوثيق. تحقق من البيانات ثم حاول مرة أخرى.') }
    finally { setSavingContact(false) }
  }

  const saveReferral = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!referring) return
    setSavingReferral(true)
    setReferralError('')
    setNotice('')
    try {
      const result = await api.referViceAbsenceToCounselor({ studentId: referring.studentId, date, ...referralForm })
      setQueue(current => current ? { ...current, rows: current.rows.map(row => row.studentId === referring.studentId ? { ...row, ...result.referral } : row) } : current)
      setNotice(`تمت إحالة الحالة إلكترونيًا إلى الموجّه الطلابي: ${result.referral.referredCounselorName}.`)
      setReferring(null)
    } catch (error) {
      setReferralError(error instanceof Error && error.message === 'counselor_not_assigned' ? 'لا يوجد موجّه طلابي مكلّف بهذه المرحلة أو أن حسابه غير متاح.' : 'تعذر إحالة الحالة. وثّق التواصل أولاً ثم حاول مرة أخرى.')
    } finally { setSavingReferral(false) }
  }

  return <section className="vice-absence-queue" aria-labelledby="vice-absence-queue-title">
    <header>
      <div><span>متابعة الوكيل</span><h3 id="vice-absence-queue-title">حالات بانتظار تواصل ولي الأمر</h3><p>تظهر هنا حالات الغياب المعتمدة فقط لمرحلتك. لا تعدّل هذه القائمة سجل الحضور أو ترسل رسائل.</p></div>
      <button type="button" className="outline-button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />تحديث القائمة</button>
    </header>
    <div className="vice-absence-queue-tools"><label>تاريخ الغياب المعتمد<input type="date" value={date} max={riyadhToday()} onChange={event => { const next = event.target.value; setDate(next); if (next) void load(next) }} /></label>{queue?.grade && <span>مرحلتك: <b>{queue.grade}</b></span>}</div>
    {error && <p className="teacher-notice error">{error}</p>}
    {notice && <p className="teacher-notice success">{notice}</p>}
    {loading ? <p className="teacher-empty">جارٍ تحميل حالات الغياب المعتمدة…</p> : <>
      <div className="vice-absence-queue-summary"><article><span>الحالات</span><strong>{queue?.summary.students || 0}</strong></article><article><span>بدون عذر</span><strong>{queue?.summary.unexcused || 0}</strong></article><article><span>بعذر أو خاص</span><strong>{(queue?.summary.excused || 0) + (queue?.summary.special || 0)}</strong></article></div>
      <div className="vice-absence-queue-list">{queue?.rows.map(row => <article key={row.studentId}><div><strong>{row.name}</strong><small>{row.grade} · الفصل {row.classroom || '—'} · <bdi>{row.studentId}</bdi></small></div><span className={`vice-absence-status ${row.status}`}>{absenceStatusLabel(row.status)}</span><div className="vice-absence-total"><strong>{row.absenceDays}</strong><span>يوم غياب معتمد</span></div><div className={row.contactOutcome ? 'vice-absence-contact complete' : 'vice-absence-contact'}><strong>{row.contactOutcome === 'contacted' ? 'تم التواصل' : row.contactOutcome === 'no_answer' ? 'لم يتم الرد' : 'بانتظار تواصل ولي الأمر'}</strong>{row.contactOutcome && <small>وثّقه الوكيل: {row.contactedByName || 'وكيل المدرسة'} · {contactMethodLabel(row.contactMethod)} · {contactStamp(row.contactedAt)}</small>}{row.referredAt && <small>أحيلت إلى الموجّه: {row.referredCounselorName || '—'} · {contactStamp(row.referredAt)}</small>}</div><button type="button" className="outline-button vice-absence-contact-button" onClick={() => openContact(row)}><PhoneCall size={15} />{row.contactOutcome ? 'تعديل التوثيق' : 'توثيق التواصل'}</button>{row.contactOutcome && <button type="button" className="outline-button vice-absence-referral-button" onClick={() => openReferral(row)}><ArrowLeftRight size={15} />{row.referredAt ? 'تعديل الإحالة' : 'إحالة إلى الموجّه'}</button>}</article>)}{!queue?.rows.length && <p className="teacher-empty">لا توجد حالات غياب معتمدة لمرحلتك في هذا التاريخ.</p>}</div>
    </>}
    {editing && <div className="counselor-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="absence-contact-title" onMouseDown={() => !savingContact && setEditing(null)}><form className="counselor-dialog absence-contact-dialog" onSubmit={saveContact} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setEditing(null)} disabled={savingContact}><X size={18} /></button><span>ملف متابعة الغياب</span><h3 id="absence-contact-title">توثيق التواصل مع ولي الأمر</h3><p><strong>{editing.name}</strong> · {editing.grade} · الفصل {editing.classroom || '—'}</p><label>نتيجة التواصل<select value={contactForm.outcome} onChange={event => setContactForm(current => ({ ...current, outcome: event.target.value as ContactForm['outcome'] }))}><option value="contacted">تم التواصل مع ولي الأمر</option><option value="no_answer">لم يتم الرد</option></select></label><label>طريقة التواصل<select value={contactForm.method} onChange={event => setContactForm(current => ({ ...current, method: event.target.value as ContactForm['method'] }))}><option value="phone">مكالمة هاتفية</option><option value="sms">رسالة نصية</option><option value="whatsapp">واتساب</option><option value="visit">زيارة</option><option value="other">طريقة أخرى</option></select></label><label>ملخص التواصل أو المحاولة<textarea value={contactForm.note} maxLength={2000} minLength={3} onChange={event => setContactForm(current => ({ ...current, note: event.target.value }))} placeholder="اكتب ما تم مع ولي الأمر أو نتيجة محاولة التواصل" required /></label>{contactError && <p className="teacher-notice error">{contactError}</p>}<div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setEditing(null)} disabled={savingContact}>إلغاء</button><button className="primary-button" disabled={savingContact}>{savingContact ? 'جارٍ الحفظ…' : 'حفظ التوثيق'}</button></div></form></div>}
    {referring && <div className="counselor-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="absence-referral-title" onMouseDown={() => !savingReferral && setReferring(null)}><form className="counselor-dialog absence-contact-dialog" onSubmit={saveReferral} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setReferring(null)} disabled={savingReferral}><X size={18} /></button><span>إحالة إلكترونية</span><h3 id="absence-referral-title">إحالة الحالة إلى الموجّه الطلابي</h3><p><strong>{referring.name}</strong> · {referring.grade} · الفصل {referring.classroom || '—'}</p><p>سيصل للموجّه المكلّف بهذه المرحلة توثيق التواصل المسجل مع سبب الإحالة.</p><label>سبب الإحالة للموجّه الطلابي<textarea value={referralForm.note} maxLength={2000} minLength={3} onChange={event => setReferralForm({ note: event.target.value })} placeholder="اكتب سبب الإحالة أو المطلوب من الموجّه" required /></label>{referralError && <p className="teacher-notice error">{referralError}</p>}<div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setReferring(null)} disabled={savingReferral}>إلغاء</button><button className="primary-button" disabled={savingReferral}>{savingReferral ? 'جارٍ إرسال الإحالة…' : 'تحويل إلى الموجّه'}</button></div></form></div>}
  </section>
}
