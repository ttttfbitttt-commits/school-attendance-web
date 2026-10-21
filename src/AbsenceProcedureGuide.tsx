import { type FormEvent, useEffect, useState } from 'react'
import { ArrowLeftRight, Building2, CheckCircle2, ClipboardList, FileSpreadsheet, MessageSquare, PhoneCall, Printer, RefreshCw, ShieldCheck, UserRoundCheck, X } from 'lucide-react'
import { api } from './api'
import { downloadWorkbook } from './SchoolFeatures'

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
type CounselorAbsenceReferralResponse = Awaited<ReturnType<typeof api.counselorAbsenceReferralQueue>>
type ContactForm = { outcome: 'contacted' | 'no_answer'; method: 'phone' | 'sms' | 'whatsapp' | 'visit' | 'other'; note: string }
type ReferralForm = { note: string }
type CounselorActionForm = { action: string; plan: string }
type ViceDecisionForm = { decision: 'closed' | 'needs_followup'; note: string }
type ViceAbsenceMessage = Awaited<ReturnType<typeof api.viceAbsenceMessages>>['rows'][number]

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

function openAbsenceMessagesPdf(rows: ViceAbsenceMessage[]) {
  const popup = window.open('', '_blank', 'noopener,noreferrer')
  if (!popup) return
  const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
  popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل رسائل الغياب</title><style>body{font-family:Arial,sans-serif;color:#102a43;padding:24px}h1{text-align:center}button{padding:8px 14px;margin:4px;border:1px solid #b8cbe0;border-radius:6px;background:white;cursor:pointer}@media print{.actions{display:none}}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #b8cbe0;padding:8px;text-align:right;vertical-align:top}th{background:#eef6fc}</style></head><body><div class="actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div><h1>سجل رسائل الغياب</h1><p>عدد الرسائل: ${rows.length}</p><table><thead><tr><th>الطالب</th><th>أيام الغياب</th><th>المرسل إليه</th><th>نص الرسالة</th><th>الوكيل</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.studentName)}</td><td>${escapeHtml(row.absenceDays)}</td><td>${escapeHtml(row.recipient)}</td><td>${escapeHtml(row.messageBody)}</td><td>${escapeHtml(row.senderName)}</td><td>${row.status === 'sent' ? 'تم الإرسال' : `فشل: ${escapeHtml(row.errorDetail)}`}</td><td>${escapeHtml(contactStamp(row.createdAt))}</td></tr>`).join('')}</tbody></table></body></html>`)
  popup.document.close()
}

export function ViceApprovedAbsenceProcedureQueue({ schoolName = '' }: { schoolName?: string } = {}) {
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
  const [deciding, setDeciding] = useState<ViceApprovedAbsenceRow | null>(null)
  const [decisionForm, setDecisionForm] = useState<ViceDecisionForm>({ decision: 'closed', note: '' })
  const [decisionError, setDecisionError] = useState('')
  const [savingDecision, setSavingDecision] = useState(false)
  const [messages, setMessages] = useState<ViceAbsenceMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [messageNotice, setMessageNotice] = useState('')
  const [messageError, setMessageError] = useState('')

  const load = async (targetDate = date) => {
    setLoading(true)
    setError('')
    try { setQueue(await api.viceApprovedAbsenceProcedureQueue(targetDate)) }
    catch { setError('تعذر تحميل الغياب المعتمد حالياً. حدّث القائمة أو حاول مرة أخرى.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const loadMessages = async () => {
    setLoadingMessages(true)
    try { setMessages((await api.viceAbsenceMessages()).rows) } catch { setMessageError('تعذر تحميل سجل رسائل الغياب حالياً.') } finally { setLoadingMessages(false) }
  }

  useEffect(() => { void loadMessages() }, [])

  const sendAbsenceMessage = async (row: ViceApprovedAbsenceRow) => {
    setMessageNotice(''); setMessageError('')
    try {
      const result = await api.sendViceAbsenceMessage({ studentId: row.studentId, date })
      await loadMessages()
      setMessageNotice(result.ok ? `تم إرسال رسالة الغياب إلى ولي أمر ${row.name}.` : 'تم تسجيل محاولة الإرسال ولم تصل الرسالة بسبب إعدادات خدمة الرسائل أو رقم الجوال.')
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setMessageError(code === 'almadar_not_configured' ? 'لم يتم إعداد حساب الرسائل للمدرسة.' : code === 'invalid_recipient_phone' ? 'لا يوجد رقم جوال صالح لولي أمر الطالب.' : code === 'student_below_three_absences' ? 'لم يبلغ غياب الطالب ثلاثة أيام.' : 'تعذر إرسال رسالة الغياب.')
    }
  }

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

  const openDecision = (row: ViceApprovedAbsenceRow, decision: ViceDecisionForm['decision']) => {
    setDeciding(row); setDecisionForm({ decision, note: row.viceDecisionNote || '' }); setDecisionError('')
  }

  const saveDecision = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!deciding) return
    setSavingDecision(true); setDecisionError(''); setNotice('')
    try {
      const result = await api.decideViceAbsenceCase({ studentId: deciding.studentId, date, ...decisionForm })
      setQueue(current => current ? { ...current, rows: current.rows.map(row => row.studentId === deciding.studentId ? { ...row, ...result.decision } : row) } : current)
      setNotice(decisionForm.decision === 'closed' ? 'تم إغلاق الحالة وتوثيق قرار الوكيل.' : 'تم طلب متابعة إضافية من الموجّه.')
      setDeciding(null)
    } catch { setDecisionError('تعذر حفظ قرار الوكيل. حدّث القائمة ثم حاول مرة أخرى.') }
    finally { setSavingDecision(false) }
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
      {queue?.rows.some(row => row.counselorActedAt && row.caseState !== 'closed') && <div className="vice-absence-decision-list">{queue.rows.filter(row => row.counselorActedAt && row.caseState !== 'closed').map(row => <div key={`decision:${row.studentId}`} className="vice-absence-decision-actions"><span>قرار الحالة: {row.name}</span><button type="button" className="outline-button" onClick={() => openDecision(row, 'needs_followup')}>طلب متابعة إضافية</button><button type="button" className="primary-button" onClick={() => openDecision(row, 'closed')}>إغلاق الحالة</button></div>)}</div>}
      <div className="vice-absence-queue-list">{queue?.rows.map(row => <article key={row.studentId}><div><strong>{row.name}</strong><small>{row.grade} · الفصل {row.classroom || '—'} · <bdi>{row.studentId}</bdi></small></div><span className={`vice-absence-status ${row.status}`}>{absenceStatusLabel(row.status)}</span><div className="vice-absence-total"><strong>{row.absenceDays}</strong><span>يوم غياب معتمد</span></div><div className={row.contactOutcome ? 'vice-absence-contact complete' : 'vice-absence-contact'}><strong>{row.contactOutcome === 'contacted' ? 'تم التواصل' : row.contactOutcome === 'no_answer' ? 'لم يتم الرد' : 'بانتظار تواصل ولي الأمر'}</strong>{row.contactOutcome && <small>وثّقه الوكيل: {row.contactedByName || 'وكيل المدرسة'} · {contactMethodLabel(row.contactMethod)} · {contactStamp(row.contactedAt)}</small>}{row.referredAt && <small>أحيلت إلى الموجّه: {row.referredCounselorName || '—'} · {contactStamp(row.referredAt)}</small>}</div><button type="button" className="outline-button" onClick={() => void sendAbsenceMessage(row)}><MessageSquare size={15} />إرسال رسالة الغياب</button><button type="button" className="outline-button vice-absence-contact-button" onClick={() => openContact(row)}><PhoneCall size={15} />{row.contactOutcome ? 'تعديل التوثيق' : 'توثيق التواصل'}</button>{row.contactOutcome && <button type="button" className="outline-button vice-absence-referral-button" onClick={() => openReferral(row)}><ArrowLeftRight size={15} />{row.referredAt ? 'تعديل الإحالة' : 'إحالة إلى الموجّه'}</button>}{row.counselorActedAt && <div className="vice-absence-counselor-response"><strong>رد الموجّه: {row.counselorName || 'الموجّه الطلابي'} · {contactStamp(row.counselorActedAt)}</strong><p>{row.counselorAction}</p>{row.counselorPlan && <small>خطة المتابعة: {row.counselorPlan}</small>}</div>}</article>)}{!queue?.rows.length && <p className="teacher-empty">لا توجد حالات غياب معتمدة لمرحلتك في هذا التاريخ.</p>}</div>
      <section className="absence-message-log"><header><div><span>سجل مستقل</span><h3>سجل رسائل الغياب</h3><p>هذا السجل منفصل عن تبويب الرسائل العام ويحفظ كل محاولات الإرسال.</p></div><div className="absence-message-log-actions"><button type="button" className="outline-button" onClick={() => downloadWorkbook(`سجل_رسائل_الغياب_${riyadhToday()}`, [['الطالب','أيام الغياب','المرسل إليه','نص الرسالة','الوكيل','الحالة','التاريخ'], ...messages.map(row => [row.studentName,row.absenceDays,row.recipient,row.messageBody,row.senderName,row.status === 'sent' ? 'تم الإرسال' : `فشل: ${row.errorDetail}`,contactStamp(row.createdAt)])], 'سجل رسائل الغياب', schoolName, 'سجل رسائل الغياب')} disabled={!messages.length}><FileSpreadsheet size={15} />Excel</button><button type="button" className="outline-button" onClick={() => openAbsenceMessagesPdf(messages)} disabled={!messages.length}><Printer size={15} />PDF</button><button type="button" className="outline-button" onClick={() => void loadMessages()} disabled={loadingMessages}><RefreshCw size={15} />تحديث</button></div></header>{messageNotice && <p className="teacher-notice success">{messageNotice}</p>}{messageError && <p className="teacher-notice error">{messageError}</p>}{loadingMessages ? <p className="teacher-empty">جارٍ تحميل سجل الرسائل…</p> : messages.length ? <div className="absence-message-log-list">{messages.map(row => <article key={row.id}><strong>{row.studentName}</strong><span>{row.absenceDays} أيام غياب · {row.status === 'sent' ? 'تم الإرسال' : 'فشل الإرسال'}</span><small>{row.messageBody}</small><time>{contactStamp(row.createdAt)}</time></article>)}</div> : <p className="teacher-empty">لا توجد رسائل غياب مسجلة حتى الآن.</p>}</section>
    </>}
    {editing && <div className="counselor-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="absence-contact-title" onMouseDown={() => !savingContact && setEditing(null)}><form className="counselor-dialog absence-contact-dialog" onSubmit={saveContact} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setEditing(null)} disabled={savingContact}><X size={18} /></button><span>ملف متابعة الغياب</span><h3 id="absence-contact-title">توثيق التواصل مع ولي الأمر</h3><p><strong>{editing.name}</strong> · {editing.grade} · الفصل {editing.classroom || '—'}</p><label>نتيجة التواصل<select value={contactForm.outcome} onChange={event => setContactForm(current => ({ ...current, outcome: event.target.value as ContactForm['outcome'] }))}><option value="contacted">تم التواصل مع ولي الأمر</option><option value="no_answer">لم يتم الرد</option></select></label><label>طريقة التواصل<select value={contactForm.method} onChange={event => setContactForm(current => ({ ...current, method: event.target.value as ContactForm['method'] }))}><option value="phone">مكالمة هاتفية</option><option value="sms">رسالة نصية</option><option value="whatsapp">واتساب</option><option value="visit">زيارة</option><option value="other">طريقة أخرى</option></select></label><label>ملخص التواصل أو المحاولة<textarea value={contactForm.note} maxLength={2000} minLength={3} onChange={event => setContactForm(current => ({ ...current, note: event.target.value }))} placeholder="اكتب ما تم مع ولي الأمر أو نتيجة محاولة التواصل" required /></label>{contactError && <p className="teacher-notice error">{contactError}</p>}<div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setEditing(null)} disabled={savingContact}>إلغاء</button><button className="primary-button" disabled={savingContact}>{savingContact ? 'جارٍ الحفظ…' : 'حفظ التوثيق'}</button></div></form></div>}
    {referring && <div className="counselor-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="absence-referral-title" onMouseDown={() => !savingReferral && setReferring(null)}><form className="counselor-dialog absence-contact-dialog" onSubmit={saveReferral} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setReferring(null)} disabled={savingReferral}><X size={18} /></button><span>إحالة إلكترونية</span><h3 id="absence-referral-title">إحالة الحالة إلى الموجّه الطلابي</h3><p><strong>{referring.name}</strong> · {referring.grade} · الفصل {referring.classroom || '—'}</p><p>سيصل للموجّه المكلّف بهذه المرحلة توثيق التواصل المسجل مع سبب الإحالة.</p><label>سبب الإحالة للموجّه الطلابي<textarea value={referralForm.note} maxLength={2000} minLength={3} onChange={event => setReferralForm({ note: event.target.value })} placeholder="اكتب سبب الإحالة أو المطلوب من الموجّه" required /></label>{referralError && <p className="teacher-notice error">{referralError}</p>}<div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setReferring(null)} disabled={savingReferral}>إلغاء</button><button className="primary-button" disabled={savingReferral}>{savingReferral ? 'جارٍ إرسال الإحالة…' : 'تحويل إلى الموجّه'}</button></div></form></div>}
    {deciding && <div className="counselor-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="absence-decision-title" onMouseDown={() => !savingDecision && setDeciding(null)}><form className="counselor-dialog absence-contact-dialog" onSubmit={saveDecision} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setDeciding(null)} disabled={savingDecision}><X size={18} /></button><span>قرار الوكيل</span><h3 id="absence-decision-title">{decisionForm.decision === 'closed' ? 'إغلاق الحالة' : 'طلب متابعة إضافية'}</h3><p><strong>{deciding.name}</strong> · {deciding.grade} · الفصل {deciding.classroom || '—'}</p><label>ملاحظات القرار<textarea value={decisionForm.note} minLength={3} maxLength={2000} onChange={event => setDecisionForm(current => ({ ...current, note: event.target.value }))} placeholder="اكتب قرارك أو المطلوب في المتابعة الإضافية" required /></label>{decisionError && <p className="teacher-notice error">{decisionError}</p>}<div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setDeciding(null)} disabled={savingDecision}>إلغاء</button><button className="primary-button" disabled={savingDecision}>{savingDecision ? 'جارٍ الحفظ…' : 'حفظ القرار'}</button></div></form></div>}
  </section>
}

export function SchoolAbsenceProcedureOverview() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.schoolAbsenceProcedureOverview>>['rows']>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { void api.schoolAbsenceProcedureOverview().then(result => setRows(result.rows)).finally(() => setLoading(false)) }, [])
  const label = (state: string) => state === 'closed' ? 'مغلقة' : state === 'needs_followup' ? 'متابعة إضافية' : state === 'actioned' ? 'تم إجراء الموجّه' : state === 'referred' ? 'محالة للموجّه' : 'بانتظار الإجراء'
  return <section className="counselor-absence-referrals school-absence-overview"><header><div><span>إدارة المدرسة</span><h3>متابعة إجراءات التعامل مع الغياب</h3><p>ملخص جميع الحالات ومسار كل حالة بين الوكيل والموجّه.</p></div><button type="button" className="outline-button" onClick={() => void api.schoolAbsenceProcedureOverview().then(result => setRows(result.rows))}><RefreshCw size={16} />تحديث</button></header>{loading ? <p className="teacher-empty">جارٍ تحميل الحالات…</p> : <div className="counselor-absence-referral-list">{rows.map(row => <article key={`${row.studentId}:${row.absenceDate}`}><header><div><strong>{row.name}</strong><small>{row.grade} · الفصل {row.classroom || '—'} · {row.absenceDate}</small></div><span className="vice-absence-status unexcused">{label(row.caseState)}</span></header><dl><div><dt>التواصل</dt><dd>{row.contactOutcome === 'contacted' ? 'تم التواصل' : row.contactOutcome === 'no_answer' ? 'لم يتم الرد' : 'غير موثق'}</dd></div><div><dt>الموجّه</dt><dd>{row.referredCounselorName || '—'}{row.counselorName && ` · ${row.counselorName}`}</dd></div><div><dt>قرار الوكيل</dt><dd>{row.viceDecidedByName ? `${row.viceDecidedByName}${row.viceDecisionNote ? ` · ${row.viceDecisionNote}` : ''}` : 'لم يصدر بعد'}</dd></div></dl></article>)}{!rows.length && <p className="teacher-empty">لا توجد حالات متابعة حالياً.</p>}</div>}</section>
}

export function CounselorAbsenceReferralQueue() {
  const [queue, setQueue] = useState<CounselorAbsenceReferralResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<CounselorAbsenceReferralResponse['rows'][number] | null>(null)
  const [actionForm, setActionForm] = useState<CounselorActionForm>({ action: '', plan: '' })
  const [actionError, setActionError] = useState('')
  const [savingAction, setSavingAction] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try { setQueue(await api.counselorAbsenceReferralQueue()) }
    catch { setError('تعذر تحميل الحالات المحالة. حدّث القائمة أو حاول مرة أخرى.') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const openAction = (row: CounselorAbsenceReferralResponse['rows'][number]) => {
    setEditing(row)
    setActionForm({ action: row.counselorAction || '', plan: row.counselorPlan || '' })
    setActionError('')
  }

  const saveAction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    setSavingAction(true)
    setActionError('')
    try {
      const result = await api.recordCounselorAbsenceAction({ studentId: editing.studentId, date: editing.absenceDate, ...actionForm })
      setQueue(current => current ? { ...current, rows: current.rows.map(row => row.studentId === editing.studentId && row.absenceDate === editing.absenceDate ? { ...row, ...result.action } : row) } : current)
      setEditing(null)
    } catch { setActionError('تعذر حفظ إجراء الموجّه. حدّث الحالة ثم حاول مرة أخرى.') }
    finally { setSavingAction(false) }
  }

  return <section className="counselor-absence-referrals" aria-labelledby="counselor-absence-referrals-title">
    <header><div><span>متابعة الموجّه</span><h3 id="counselor-absence-referrals-title">الحالات المحالة إليك</h3><p>تظهر الحالات المحالة إلى حسابك فقط، ضمن المراحل المكلّف بها.</p></div><button type="button" className="outline-button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} />تحديث القائمة</button></header>
    {error && <p className="teacher-notice error">{error}</p>}
    {loading ? <p className="teacher-empty">جارٍ تحميل الحالات المحالة…</p> : <><div className="counselor-absence-referral-count"><strong>{queue?.rows.length || 0}</strong><span>حالة بانتظار دراسة الموجّه</span></div><div className="counselor-absence-referral-list">{queue?.rows.map(row => <article key={`${row.studentId}:${row.absenceDate}`}><header><div><strong>{row.name}</strong><small>{row.grade} · الفصل {row.classroom || '—'} · <bdi>{row.studentId}</bdi></small></div><span className={`vice-absence-status ${row.status}`}>{absenceStatusLabel(row.status)}</span></header><dl><div><dt>سبب الإحالة من الوكيل</dt><dd>{row.referralNote}</dd></div><div><dt>توثيق التواصل</dt><dd>{row.contactOutcome === 'contacted' ? 'تم التواصل مع ولي الأمر' : 'لم يتم الرد'} · {contactMethodLabel(row.contactMethod)}<br /><small>وثّقه الوكيل: {row.contactedByName || 'وكيل المدرسة'} · {contactStamp(row.contactedAt)}</small><br />{row.contactNote}</dd></div><div><dt>وقت الإحالة</dt><dd>{contactStamp(row.referredAt)}<br /><small>أحالها الوكيل: {row.referredByName || 'وكيل المدرسة'}</small></dd></div></dl>{row.counselorActedAt && <section className="counselor-absence-action-summary"><strong>تم إرسال الإجراء إلى الوكيل</strong><span>{row.counselorName || 'الموجّه الطلابي'} · {contactStamp(row.counselorActedAt)}</span><p>{row.counselorAction}</p>{row.counselorPlan && <small>خطة المتابعة: {row.counselorPlan}</small>}</section>}<button type="button" className="primary-button counselor-absence-action-button" onClick={() => openAction(row)}>{row.counselorActedAt ? 'تعديل الإجراء المرسل' : 'تسجيل الإجراء وإرساله للوكيل'}</button></article>)}{!queue?.rows.length && <p className="teacher-empty">لا توجد حالات غياب محالة إليك حالياً.</p>}</div></>}
    {editing && <div className="counselor-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="counselor-absence-action-title" onMouseDown={() => !savingAction && setEditing(null)}><form className="counselor-dialog absence-contact-dialog" onSubmit={saveAction} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setEditing(null)} disabled={savingAction}><X size={18} /></button><span>إجراء الموجّه الطلابي</span><h3 id="counselor-absence-action-title">دراسة حالة الغياب</h3><p><strong>{editing.name}</strong> · {editing.grade} · الفصل {editing.classroom || '—'}</p><label>الإجراء المتخذ<textarea value={actionForm.action} maxLength={2000} minLength={3} onChange={event => setActionForm(current => ({ ...current, action: event.target.value }))} placeholder="اكتب الإجراء الذي اتخذته الموجّه" required /></label><label>خطة المتابعة أو ملاحظات إضافية<textarea value={actionForm.plan} maxLength={2000} onChange={event => setActionForm(current => ({ ...current, plan: event.target.value }))} placeholder="اختياري: خطة المتابعة أو أي ملاحظات للوكيل" /></label>{actionError && <p className="teacher-notice error">{actionError}</p>}<div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setEditing(null)} disabled={savingAction}>إلغاء</button><button className="primary-button" disabled={savingAction}>{savingAction ? 'جارٍ الإرسال…' : 'إرسال الإجراء للوكيل'}</button></div></form></div>}
  </section>
}
