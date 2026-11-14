import './auth-redesign.css'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { ArrowLeft, ArrowRight, BarChart3, BookOpen, Pause, Play, CalendarCheck2, CalendarRange, ClipboardCheck, FileText, GraduationCap, LockKeyhole, School, UserRound } from 'lucide-react'
import { api, type Account, type LoginChoice } from './api'
import { cacheReportSchoolBrand, clearReportSchoolBrand } from './SchoolFeatures'

const roleLabel: Record<LoginChoice['role'], string> = {
  admin: 'حساب المدرسة',
  staff: 'حساب المدرسة',
  teacher: 'بوابة المعلم',
  administrator: 'بوابة الإداري',
  student: 'بوابة الطالب',
  counselor: 'بوابة الموجّه الطلابي',
  vice_principal: 'بوابة وكيل المدرسة',
  activity_leader: 'بوابة رائد النشاط',
}

export function AuthGate({ children }: { children: (account: Account, logout: () => void) => ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [reportBrandLoading, setReportBrandLoading] = useState(false)
  const [registering, setRegistering] = useState(false)
  const [registrationSent, setRegistrationSent] = useState(false)
  const [verificationToken, setVerificationToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('verify-email') || '')
  const [verifying, setVerifying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [loginChoices, setLoginChoices] = useState<LoginChoice[]>([])
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [schoolName, setSchoolName] = useState('')
  const [generalEducationAdministration, setGeneralEducationAdministration] = useState('')
  const [administratorName, setAdministratorName] = useState('')
  const [schoolEmail, setSchoolEmail] = useState('')
  const [schoolPassword, setSchoolPassword] = useState('')
  const featureHighlights = useMemo(() => [
    { title: 'الحضور والغياب', description: 'متابعة يومية في مكان واحد', blurb: 'سجّل الحضور وتابع التأخر والغياب، واطّلع على السجلات والتقارير بسهولة.', icon: <CalendarCheck2 size={23} /> },
    { title: 'الجدول وحصص الانتظار', description: 'تنظيم اليوم الدراسي', blurb: 'أعد الجداول ووزّع حصص الانتظار، وتابع تكليف المعلمين عند الغياب.', icon: <CalendarRange size={23} /> },
    { title: 'تحليل النتائج', description: 'بيانات تساعد على اتخاذ القرار', blurb: 'حلّل نتائج الطلاب، واستعرض المؤشرات، وأصدر تقارير PDF للمتابعة.', icon: <BarChart3 size={23} /> },
    { title: 'استئذان الطلاب', description: 'تواصل مباشر مع ولي الأمر', blurb: 'أرسل طلب الاستئذان لولي الأمر، وتابع الرد والتوقيع في سجل المدرسة.', icon: <ClipboardCheck size={23} /> },
    { title: 'التعاميم والتوقيعات', description: 'متابعة الاطلاع إلكترونياً', blurb: 'شارك التعاميم مع منسوبي المدرسة وتابع التوقيعات وحالة الاطلاع.', icon: <FileText size={23} /> },
    { title: 'ملفات الإنجاز والشواهد', description: 'أعمال الطلاب والمعلمين', blurb: 'تابع ملفات إنجاز الطلاب وشواهد المعلمين من حساباتهم في المنصة.', icon: <GraduationCap size={23} /> },
    { title: 'الكتب الدراسية', description: 'مصادر التعلّم للمعلم والطالب', blurb: 'انتقل إلى مصادر الكتب الدراسية من حساب المعلم أو الطالب.', icon: <BookOpen size={23} /> },
    { title: 'إجراءات التعامل مع الغياب', description: 'متابعة الحالات المدرسية', blurb: 'تابع حالات غياب الطلاب والإجراءات المرتبطة بها من مكان واحد.', icon: <ClipboardCheck size={23} /> },
    { title: 'سير الحصص', description: 'متابعة الحصص والمعلمين', blurb: 'تابع سير الحصص والمعلم المكلّف بالفصل وسجّل الملاحظات.', icon: <CalendarCheck2 size={23} /> },
    { title: 'إحالات الطلاب والسلوك', description: 'متابعة تربوية منظمة', blurb: 'وثّق الإحالات والسلوك وتابع الحالات من الحسابات المدرسية المعنية.', icon: <UserRound size={23} /> },
    { title: 'تقارير المدرسة', description: 'سجلات قابلة للطباعة', blurb: 'استعرض تقارير وسجلات المدرسة واطبع ما تحتاجه للمتابعة.', icon: <FileText size={23} /> },
    { title: 'بوابات منسوبي المدرسة', description: 'أدوات تناسب كل مستخدم', blurb: 'حسابات للطلاب والمعلمين والإدارة تتيح لكل مستخدم الوصول إلى أدواته.', icon: <School size={23} /> },
  ], [])
  const [featureIndex, setFeatureIndex] = useState(0)
  const [carouselPaused, setCarouselPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [carouselRevision, setCarouselRevision] = useState(0)
  const selectFeature = (index: number) => { setFeatureIndex((index + featureHighlights.length) % featureHighlights.length); setCarouselRevision(value => value + 1) }
  useEffect(() => {
    if (carouselPaused) return
    const timer = window.setTimeout(() => setFeatureIndex(index => (index + 1) % featureHighlights.length), 20000)
    return () => window.clearTimeout(timer)
  }, [featureIndex, carouselPaused, carouselRevision, featureHighlights.length])

  useEffect(() => {
    api.me().then(({ user }) => setAccount(user)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!account) {
      clearReportSchoolBrand()
      setReportBrandLoading(false)
      return
    }
    let active = true
    clearReportSchoolBrand()
    setReportBrandLoading(true)
    void api.reportSchoolBrand()
      .then(({ school }) => {
        if (active) cacheReportSchoolBrand(account.schoolId, school)
      })
      .catch(error => console.error('Unable to load the school report header.', error))
      .finally(() => {
        if (active) setReportBrandLoading(false)
      })
    return () => { active = false }
  }, [account?.schoolId])

  function resetLoginState() {
    setError('')
    setLoginChoices([])
  }

  async function submitLogin(choice?: LoginChoice) {
    setSubmitting(true)
    setError('')
    try {
      const result = await api.unifiedLogin(identifier, password, choice)
      setAccount(result.user)
    } catch (reason) {
      const apiError = reason as Error & { code?: string; data?: { choices?: LoginChoice[] } }
      if (apiError.code === 'login_selection_required' && apiError.data?.choices?.length) {
        setLoginChoices(apiError.data.choices)
        return
      }
      setError(apiError.code === 'too_many_login_attempts'
        ? 'تم إيقاف المحاولات لهذا الحساب مؤقتًا لحمايته. انتظر قليلًا ثم حاول مرة أخرى.'
        : 'تعذر تسجيل الدخول. تحقق من رقم الهوية أو بريد المدرسة وكلمة المرور ثم حاول مرة أخرى.')
    } finally {
      setSubmitting(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRegistrationSent(false)
    if (!registering) {
      await submitLogin()
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api.register(administratorName, schoolName, schoolEmail, schoolPassword, {
        generalEducationAdministration,
      })
      setRegistrationSent(true)
    } catch (reason) {
      const apiError = reason as Error & { code?: string }
      setError(apiError.code === 'email_verification_not_configured'
        ? 'تأكيد البريد غير مفعّل بعد. لم يتم إنشاء الحساب؛ تواصل مع إدارة النظام.'
        : apiError.code === 'email_send_failed'
          ? 'تعذر إرسال رسالة التأكيد. لم يتم إنشاء الحساب؛ حاول لاحقًا.'
          : 'تعذر بدء التسجيل. تحقق من البيانات وحاول لاحقًا.')
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setVerifying(true)
    try {
      const result = await api.verifySchoolEmail(verificationToken)
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      setVerificationToken('')
      setAccount(result.user)
    } catch {
      setError('رابط التأكيد غير صالح أو انتهت صلاحيته. أعد التسجيل لطلب رابط جديد.')
    } finally {
      setVerifying(false)
    }
  }

  function returnToLogin() {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    setVerificationToken('')
    setError('')
  }

  function openRegistration() {
    resetLoginState()
    setRegistrationSent(false)
    setRegistering(true)
  }

  function openLogin() {
    resetLoginState()
    setRegistrationSent(false)
    setRegistering(false)
  }

  function logout() {
    void api.logout().catch(() => {}).finally(() => setAccount(null))
  }

  if (loading || (account && reportBrandLoading)) return <div className="auth-loading">جارٍ الاتصال بالنظام الآمن…</div>
  if (verificationToken) return <main className="auth-page" dir="rtl"><section className="auth-card">
    <div className="auth-icon"><School size={30} /></div>
    <h1>تأكيد البريد الإلكتروني</h1>
    <p>اضغط الزر لإكمال تسجيل المدرسة وإنشاء حساب المسؤول.</p>
    {error && <div className="auth-error">{error}</div>}
    <form onSubmit={confirmEmail}>
      <button className="auth-submit" type="submit" disabled={verifying}>{verifying ? 'جارٍ التحقق…' : 'تأكيد البريد وإنشاء الحساب'}</button>
      <button className="auth-back" type="button" onClick={returnToLogin}>العودة لتسجيل الدخول</button>
    </form>
  </section></main>
  if (account) return <>{children(account, logout)}</>

  return <main className="auth-page" dir="rtl">
    <div className="auth-shell">
      <aside className="auth-visual" aria-label="خدمات نظام الحصر المدرسي">
        <div className="auth-visual-topbar"><span className="auth-logo-frame"><img src="/school-census-logo.webp?v=1" alt="" /></span><span className="auth-visual-brand">نظام الحصر المدرسي</span><span className="auth-visual-badge">منصة مدرستك المتكاملة</span></div>
        <div className="auth-hero">
          <div className="auth-hero-copy"><span>كل تفاصيل يومك المدرسي</span><h2>مدرسة أكثر تنظيمًا،<br />ووقت أكثر للتعليم.</h2><p>من الحضور والجدول إلى التقارير والتواصل، أدوات مدرستك في منصة واحدة.</p></div>
          <img src="/login-education-illustration.png" alt="طالب يحمل كتبه في المدرسة" />
        </div>
        <div className="auth-services-heading"><div><span>اكتشف خدمات الحصر</span><h3>كل ما تحتاجه مدرستك</h3></div><small>تتغير الخدمة تلقائيًا كل ٢٠ ثانية</small></div>
        <section className="auth-carousel" aria-label="خدمات النظام">
          <div key={featureIndex} className="auth-carousel-slide">
            <div className="auth-carousel-art" aria-hidden="true">{featureHighlights[featureIndex].icon}</div>
            <div className="auth-carousel-copy"><span>خدمة {featureIndex + 1} من {featureHighlights.length}</span><h4>{featureHighlights[featureIndex].title}</h4><strong>{featureHighlights[featureIndex].description}</strong><p>{featureHighlights[featureIndex].blurb}</p></div>
          </div>
          <div className="auth-carousel-controls"><div className="auth-carousel-dots" aria-label="اختر خدمة">{featureHighlights.map((feature, index) => <button key={feature.title} type="button" onClick={() => selectFeature(index)} className={featureIndex === index ? 'active' : ''} aria-label={feature.title} aria-current={featureIndex === index ? 'true' : undefined} />)}</div><div className="auth-carousel-actions"><button type="button" onClick={() => selectFeature(featureIndex - 1)} aria-label="الخدمة السابقة"><ArrowRight size={18} /></button><button type="button" onClick={() => setCarouselPaused(value => !value)} aria-label={carouselPaused ? 'تشغيل العرض التلقائي' : 'إيقاف العرض التلقائي'}>{carouselPaused ? <Play size={17} /> : <Pause size={17} />}</button><button type="button" onClick={() => selectFeature(featureIndex + 1)} aria-label="الخدمة التالية"><ArrowLeft size={18} /></button></div></div>
        </section>
      </aside>

      <section className="auth-card">
        <div className="auth-brand-row">
          <div className="auth-icon"><img src="/school-census-logo.webp?v=1" alt="" /></div>
          <h1>{registering ? 'تسجيل مدرسة جديدة' : 'نظام الحصر المدرسي'}</h1>
        </div>
        <p>{registering ? 'أدخل بيانات المدرسة والمسؤول لإرسال رابط التأكيد.' : 'أدخل رقم الهوية أو بريد المدرسة وكلمة المرور للوصول إلى حسابك.'}</p>

        {loginChoices.length > 0 && !registering ? <section className="auth-login-choices" aria-live="polite">
          <h2>اختر الحساب المطلوب</h2>
          <p>توجد أكثر من بوابة مرتبطة بهذه البيانات.</p>
          {loginChoices.map(choice => <button type="button" key={`${choice.userId}-${choice.schoolId}-${choice.role}`} disabled={submitting} onClick={() => void submitLogin(choice)}>
            <span>{roleLabel[choice.role]}</span>
            <small>{choice.schoolName}</small>
          </button>)}
          <button type="button" className="auth-back" onClick={resetLoginState}>العودة وتعديل البيانات</button>
        </section> : <form onSubmit={submit} autoComplete="on">
          {registering ? <>
            <label><UserRound size={16} /> اسم المسؤول<input name="name" value={administratorName} onChange={event => setAdministratorName(event.target.value)} required /></label>
            <label><School size={16} /> اسم المدرسة<input name="school" value={schoolName} onChange={event => setSchoolName(event.target.value)} required /></label>
            <label>الإدارة العامة للتعليم في المنطقة<input name="generalEducationAdministration" value={generalEducationAdministration} onChange={event => setGeneralEducationAdministration(event.target.value)} placeholder="مثال: الإدارة العامة للتعليم بمنطقة الرياض" /></label>
            <label>البريد الإلكتروني<input name="email" type="email" autoComplete="section-school email" value={schoolEmail} onChange={event => setSchoolEmail(event.target.value)} required /></label>
            <label><LockKeyhole size={16} /> كلمة المرور<input name="schoolPassword" type="password" autoComplete="section-school new-password" value={schoolPassword} onChange={event => setSchoolPassword(event.target.value)} minLength={12} required /></label>
            <small>استخدم 12 حرفًا على الأقل.</small>
          </> : <>
            <label><UserRound size={16} /> رقم الهوية أو بريد المدرسة<input name="identifier" type="text" autoComplete="username" autoCapitalize="none" enterKeyHint="next" value={identifier} onChange={event => { setIdentifier(event.target.value); resetLoginState() }} required /></label>
            <label><LockKeyhole size={16} /> كلمة المرور<input name="password" type="password" autoComplete="current-password" enterKeyHint="go" value={password} onChange={event => { setPassword(event.target.value); resetLoginState() }} minLength={8} required /></label>
          </>}
          {registrationSent && <div className="auth-success" role="status">إذا كان البريد صالحًا وغير مسجل، أرسلنا رابط تأكيد. افتحه واضغط زر التأكيد لإكمال التسجيل.</div>}
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'جارٍ التنفيذ…' : registering ? registrationSent ? 'إعادة إرسال رابط التأكيد' : 'إرسال رابط التأكيد' : 'دخول'}</button>
        </form>}

        <div className="auth-footer-action">
          {registering
            ? <button className="auth-back" type="button" onClick={openLogin}>لديك حساب؟ تسجيل الدخول</button>
            : <button className="auth-register-link" type="button" onClick={openRegistration}>تسجيل مدرسة جديدة</button>}
        </div>
      </section>
    </div>
  </main>
}
