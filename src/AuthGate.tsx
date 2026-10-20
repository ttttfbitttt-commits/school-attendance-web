import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { LockKeyhole, School, UserRound } from 'lucide-react'
import { api, type Account, type LoginChoice } from './api'

const roleLabel: Record<LoginChoice['role'], string> = {
  admin: 'حساب المدرسة',
  staff: 'حساب المدرسة',
  teacher: 'بوابة المعلم',
  administrator: 'بوابة الإداري',
  student: 'بوابة الطالب',
  counselor: 'بوابة الموجّه الطلابي',
}

export function AuthGate({ children }: { children: (account: Account, logout: () => void) => ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
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
  const [administratorName, setAdministratorName] = useState('')
  const [schoolEmail, setSchoolEmail] = useState('')
  const [schoolPassword, setSchoolPassword] = useState('')

  useEffect(() => {
    api.me().then(({ user }) => setAccount(user)).catch(() => {}).finally(() => setLoading(false))
  }, [])

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
      setError('تعذر تسجيل الدخول. تحقق من رقم الهوية أو بريد المدرسة وكلمة المرور ثم حاول مرة أخرى.')
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
      await api.register(administratorName, schoolName, schoolEmail, schoolPassword)
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

  if (loading) return <div className="auth-loading">جارٍ الاتصال بالنظام الآمن…</div>
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

  return <main className="auth-page" dir="rtl"><section className="auth-card">
    <div className="auth-icon"><School size={30} /></div>
    <h1>{registering ? 'تسجيل مدرسة جديدة' : 'نظام الحصر'}</h1>
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
  </section></main>
}
