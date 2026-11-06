import { useEffect, useMemo, useState } from 'react'
import { api, type AcademicTerm, type AcademicTermArchive, type SchoolProfile } from './api'

type Props = { isAdmin: boolean; onSchoolChanged: (profile: SchoolProfile) => void }

const semsters = ['الفصل الأول', 'الفصل الثاني', 'الفصل الثالث']

function formatBytes(value: number) {
  if (!value) return '0 بايت'
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} ك.ب`
  return `${(value / (1024 * 1024)).toLocaleString('ar-SA', { maximumFractionDigits: 1 })} م.ب`
}

function arabicStamp(value: string | null) {
  if (!value) return '—'
  try { return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(value)) } catch { return value }
}

function errorText(error: unknown) {
  const code = (error as Error & { code?: string })?.code || ''
  if (code === 'term_already_exists') return 'هذا الفصل موجود في الأرشيف بالفعل. اختره من القائمة لاستعادته.'
  if (code === 'term_archive_not_ready') return 'لا توجد لقطة مكتملة لهذا الفصل بعد.'
  if (code === 'term_management_admin_only') return 'تبديل الفصل من صلاحيات حساب المدرسة فقط.'
  if (code === 'school_confirmation_email_missing') return 'لا يوجد بريد حساب المدرسة مسجل، لذلك لا يمكن إرسال رابط التحقق لإتمام الأرشفة.'
  if (code === 'email_send_failed') return 'فشل إرسال رابط التأكيد عبر البريد. أعد المحاولة بعد التأكد من إعداد البريد.'
  if (code === 'no_pending_term_confirmation') return 'لا توجد طلبات تأكيد معلّقة حاليًا. يمكنك إرسال رابط جديد مرة أخرى من البداية.'
  if (code === 'no_pending_term_confirmation_to_cancel') return 'لا يوجد طلب تأكيد معلّق لإلغائه.'
  return 'تعذر تنفيذ العملية. لم تُغيّر أي بيانات؛ أعد المحاولة.'
}

export function AcademicTerms({ isAdmin, onSchoolChanged }: Props) {
  const [terms, setTerms] = useState<AcademicTerm[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [verificationState, setVerificationState] = useState<{ recipientEmail: string; expiresAt: string } | null>(null)
  const [academicYear, setAcademicYear] = useState('1448 / 1449')
  const [semester, setSemester] = useState('الفصل الثاني')
  const [archive, setArchive] = useState<AcademicTermArchive | null>(null)

  const active = useMemo(() => terms.find(term => term.status === 'active') || null, [terms])

  const load = async () => {
    setLoading(true)
    try {
      const response = await api.academicTerms()
      setTerms(response.terms)
      const current = response.terms.find(term => term.status === 'active')
      if (current) {
        setAcademicYear(current.academicYear)
        const next = semsters[semsters.indexOf(current.semester) + 1]
        if (next) setSemester(next)
      }
    } catch { setNotice('تعذر تحميل الفصول الدراسية من الخادم.') } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const openArchive = async (term: AcademicTerm) => {
    setBusy(`archive:${term.id}`)
    setNotice('')
    try { setArchive(await api.academicTermArchive(term.id)) } catch (error) { setNotice(errorText(error)) } finally { setBusy('') }
  }

  const prepare = async () => {
    const year = academicYear.trim()
    const selectedSemester = semester.trim()
    if (!year || !selectedSemester) { setNotice('أدخل العام الدراسي واختر الفصل قبل المتابعة.'); return }
    const accepted = window.confirm(`سيُرسل رابط تأكيد إلى بريد حساب المدرسة، ولا يتم أرشفة ${active ? `${active.semester} ${active.academicYear}` : 'الفصل الحالي'} أو فتح ${selectedSemester} ${year} إلا بعد الضغط على الرابط.\n\nستبقى بيانات المعلمين والحسابات، بينما ستبدأ المواد والفصول والاسنادات والطلاب من جديد بعد التحقق.\nوسيُحذف محتوى ملفات إنجاز الطلاب نهائياً من مساحة الفصل الحالي فقط بعد التأكيد.\n\nهل تريد إرسال رابط التأكيد؟`)
    if (!accepted) return
    setBusy('prepare')
    setNotice('')
    try {
      const result = await api.prepareAcademicTerm(year, selectedSemester)
      if (result.verificationRequired) {
        setVerificationState(result.recipientEmail ? { recipientEmail: result.recipientEmail, expiresAt: result.expiresAt || '' } : null)
        setNotice(`تم إرسال رابط تأكيد الأرشفة إلى البريد الإلكتروني (${result.recipientEmail || 'حساب المدرسة'}). لا يتم فتح الفصل إلا بعد الضغط على الرابط المرسل.`)
        return
      }
      onSchoolChanged(result.school)
      setVerificationState(null)
      setArchive(null)
      setNotice(`تم فتح ${result.term.semester} بنجاح. أُرشف الفصل السابق، وحُذِف ${result.archivedSummary.portfolioFilesDeleted.toLocaleString('ar-SA')} ملف إنجاز من مساحة العمل الجديدة.`)
      await load()
    } catch (error) { setNotice(errorText(error)) } finally { setBusy('') }
  }

  const resendConfirmation = async () => {
    if (busy) return
    setBusy('resend')
    setNotice('')
    try {
      const result = await api.resendAcademicTermConfirmation()
      setVerificationState(result.recipientEmail ? { recipientEmail: result.recipientEmail, expiresAt: result.expiresAt || '' } : null)
      setNotice(`تم إرسال رابط تأكيد جديد إلى البريد الإلكتروني (${result.recipientEmail || 'حساب المدرسة'}). لا يتم فتح الفصل إلا بعد الضغط على الرابط الجديد.`)
    } catch (error) { setNotice(errorText(error)) } finally { setBusy('') }
  }

  const cancelConfirmation = async () => {
    if (busy) return
    const accepted = window.confirm('سيُلغى رابط التأكيد الحالي، ولن يتم فتح الفصل الدراسي حتى ترسل طلب تأكيد جديد. هل تريد المتابعة؟')
    if (!accepted) return
    setBusy('cancel')
    setNotice('')
    try {
      await api.cancelAcademicTermConfirmation()
      setVerificationState(null)
      setNotice('تم إلغاء رابط التأكيد الحالي. يمكنك إرسال طلب جديد متى رغبت.')
    } catch (error) { setNotice(errorText(error)) } finally { setBusy('') }
  }

  const activate = async (term: AcademicTerm) => {
    const accepted = window.confirm(`سيُؤرشف محتوى الفصل النشط الآن ثم تُستعاد بيانات ${term.semester} ${term.academicYear} لجميع المستخدمين.\n\nملفات إنجاز الطلاب لا تُستعاد لأنها حُذفت عند نهاية الفصل. هل تريد المتابعة؟`)
    if (!accepted) return
    setBusy(`activate:${term.id}`)
    setNotice('')
    try {
      const result = await api.activateAcademicTerm(term.id)
      onSchoolChanged(result.school)
      setArchive(null)
      setNotice(`تم تفعيل ${result.term.semester} ${result.term.academicYear}. تظهر الآن بياناته في حسابات المدرسة والمستخدمين.`)
      await load()
    } catch (error) { setNotice(errorText(error)) } finally { setBusy('') }
  }

  return <section className="academic-terms" dir="rtl">
    <div className="academic-terms-head">
      <div><span className="panel-kicker">إدارة الفصل الدراسي</span><h2>الفصول والأرشيف</h2><p>الفصل النشط يظهر لجميع المستخدمين. أرشيف الفصول السابقة للقراءة والاستعادة من حساب المدرسة فقط.</p></div>
      <button type="button" className="secondary-button" onClick={() => void load()} disabled={loading || Boolean(busy)}>{loading ? 'جارٍ التحميل…' : 'تحديث القائمة'}</button>
    </div>

    {notice && <p className="academic-term-notice" role="status">{notice}</p>}
    {verificationState && <div className="academic-term-confirmation-actions"><button type="button" className="secondary-button" onClick={() => void resendConfirmation()} disabled={Boolean(busy)}>{busy === 'resend' ? 'جارٍ إعادة إرسال الرابط…' : 'إعادة إرسال رابط التأكيد'}</button><button type="button" className="outline-button" onClick={() => void cancelConfirmation()} disabled={Boolean(busy)}>{busy === 'cancel' ? 'جارٍ إلغاء الرابط…' : 'إلغاء الطلب'}</button>{verificationState.expiresAt && <small>تاريخ انتهاء الرابط: {arabicStamp(verificationState.expiresAt)}</small>}</div>}

    {active && <article className="academic-term-current"><div><span>الفصل النشط الآن</span><h3>{active.semester}</h3><strong>{active.academicYear}</strong><small>فُعّل: {arabicStamp(active.activatedAt)}</small></div><p>هذا هو المصدر الحالي لبيانات الطلاب والمواد والفصول والاسنادات والحضور في جميع الحسابات.</p></article>}

    {isAdmin && <section className="academic-term-create">
      <div><span className="panel-kicker">نهاية الفصل والبدء بالفصل التالي</span><h3>فتح فصل دراسي جديد</h3><p>لا يُنقل الطلاب تلقائياً: بعد الفتح استورد ملف Excel الجديد من «إدارة الطلاب». تبقى أسماء المعلمين وحساباتهم، وتُجهز المواد والفصول والاسنادات والجدول من جديد.</p></div>
      <div className="academic-term-fields"><label>العام الدراسي<input value={academicYear} maxLength={80} onChange={event => setAcademicYear(event.target.value)} placeholder="مثال: 1448 / 1449" disabled={Boolean(busy)} /></label><label>الفصل الدراسي<select value={semester} onChange={event => setSemester(event.target.value)} disabled={Boolean(busy)}>{semsters.map(item => <option key={item}>{item}</option>)}</select></label><button type="button" className="primary-button academic-term-open" onClick={() => void prepare()} disabled={Boolean(busy)}>{busy === 'prepare' ? 'جارٍ إرسال رابط التأكيد…' : 'إرسال رابط التأكيد'}</button></div>
      <p className="academic-term-warning">تنبيه: تُحذف ملفات إنجاز الطلاب وملحقاتها من الفصل المنتهي لتوفير المساحة، ولا تُنقل إلى الفصل الجديد أو تُستعاد عند الرجوع للأرشيف.</p>
    </section>}

    <section className="academic-term-history"><div className="academic-terms-head"><div><span className="panel-kicker">سجل الفصول</span><h3>الأرشيف الدراسي</h3></div></div>
      {loading ? <p className="teacher-empty">جارٍ تحميل الأرشيف…</p> : <div className="academic-term-cards">{terms.filter(term => term.status !== 'active').map(term => <article key={term.id}><header><div><span>{term.semester}</span><h4>{term.academicYear}</h4></div><small>أرشف: {arabicStamp(term.archivedAt)}</small></header><dl><div><dt>الطلاب</dt><dd>{term.summary?.students?.toLocaleString('ar-SA') || '0'}</dd></div><div><dt>الفصول</dt><dd>{term.summary?.classrooms?.toLocaleString('ar-SA') || '0'}</dd></div><div><dt>السجلات</dt><dd>{term.summary?.lessonRecords?.toLocaleString('ar-SA') || '0'}</dd></div></dl><footer><button type="button" className="outline-button" onClick={() => void openArchive(term)} disabled={Boolean(busy)}>{busy === `archive:${term.id}` ? 'جارٍ الفتح…' : 'عرض الأرشيف'}</button>{isAdmin && <button type="button" className="primary-button" onClick={() => void activate(term)} disabled={Boolean(busy) || !term.hasArchive}>{busy === `activate:${term.id}` ? 'جارٍ الاستعادة…' : 'تفعيل هذا الفصل'}</button>}</footer></article>)}{!terms.some(term => term.status !== 'active') && <p className="teacher-empty">لا يوجد فصل مؤرشف بعد. عند فتح الفصل التالي سيظهر الفصل الحالي هنا.</p>}</div>}
    </section>

    {archive && <section className="academic-term-archive" aria-live="polite"><header><div><span>عرض للقراءة فقط</span><h3>{archive.term.semester} · {archive.term.academicYear}</h3><p>ملفات إنجاز الطلاب غير متاحة في الأرشيف وفق سياسة المساحة المعتمدة.</p></div><button type="button" className="outline-button" onClick={() => setArchive(null)}>إغلاق العرض</button></header><div className="academic-term-archive-stats"><span>{archive.archive.summary.students.toLocaleString('ar-SA')} طالب</span><span>{archive.archive.subjects.length.toLocaleString('ar-SA')} مادة</span><span>{archive.archive.summary.attendance.toLocaleString('ar-SA')} سجل حضور</span><span>{formatBytes(archive.archive.summary.portfolioBytesDeleted)} تم تنظيفها من ملفات الإنجاز</span></div>{archive.archive.subjects.length > 0 && <p className="academic-term-subjects"><b>مواد الفصل:</b> {archive.archive.subjects.join(' · ')}</p>}<div className="academic-term-students"><table><thead><tr><th>الطالب</th><th>الصف</th><th>الفصل</th><th>الحالة في الأرشيف</th></tr></thead><tbody>{archive.archive.students.map(student => <tr key={student.id}><td>{student.name}</td><td>{student.grade}</td><td>{student.classroom}</td><td>{student.active ? 'مسجل' : 'غير نشط'}</td></tr>)}</tbody></table></div></section>}
  </section>
}
