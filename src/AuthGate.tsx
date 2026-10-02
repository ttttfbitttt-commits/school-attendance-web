import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { LockKeyhole, School, UserRound } from 'lucide-react'
import { api, type Account } from './api'

type LoginMode = 'admin' | 'teacher'

export function AuthGate({ children }: { children: (account: Account, logout: () => void) => ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [registrationSent, setRegistrationSent] = useState(false)
  const [verificationToken, setVerificationToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('verify-email') || '')
  const [verifying, setVerifying] = useState(false)
  const [mode, setMode] = useState<LoginMode>('admin')
  const [error, setError] = useState('')
  const [schoolChoices, setSchoolChoices] = useState<Array<{ id: string; name: string }>>([])
  const [selectedSchoolId, setSelectedSchoolId] = useState('')

  useEffect(() => {
    api.me().then(({ user }) => setAccount(user)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setRegistrationSent(false)
    const values = new FormData(event.currentTarget)
    try {
      if (mode === 'teacher') {
        const result = await api.teacherLogin(String(values.get('identityNumber') || ''), String(values.get('teacherPassword') || ''), selectedSchoolId)
        setAccount(result.user)
        return
      }
      if (registering) {
        await api.register(String(values.get('name') || ''), String(values.get('school') || ''), String(values.get('email') || ''), String(values.get('schoolPassword') || ''))
        setRegistrationSent(true)
        return
      }
      const result = await api.login(String(values.get('email') || ''), String(values.get('schoolPassword') || ''))
      setAccount(result.user)
    } catch (reason) {
      const apiError = reason as Error & { code?: string; data?: { schools?: Array<{ id: string; name: string }> } }
      if (mode === 'teacher' && apiError.code === 'teacher_school_selection_required' && apiError.data?.schools?.length) {
        setSchoolChoices(apiError.data.schools)
        setSelectedSchoolId(apiError.data.schools[0].id)
        setError('لديك حسابات في أكثر من مدرسة. اختر المدرسة ثم أعد الدخول.')
        return
      }
      setError(mode === 'teacher'
        ? 'تعذر دخول حساب المعلم. تحقق من رقم الهوية وكلمة المرور، أو اطلب من الإدارة إعادة ضبط الحساب.'
        : registering && apiError.code === 'email_verification_not_configured'
          ? 'تأكيد البريد غير مفعّل بعد. لم يتم إنشاء الحساب؛ تواصل مع إدارة النظام.'
          : registering && apiError.code === 'email_send_failed'
            ? 'تعذر إرسال رسالة التأكيد. لم يتم إنشاء الحساب؛ حاول لاحقًا.'
            : registering
              ? 'تعذر بدء التسجيل. تحقق من البيانات وحاول لاحقًا.'
              : 'تعذر الدخول. تحقق من البريد وكلمة المرور، أو جرّب لاحقًا.')
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

  const teacher = mode === 'teacher'
  return <main className="auth-page" dir="rtl"><section className="auth-card">
    <div className="auth-icon"><School size={30} /></div>
    <h1>{teacher ? 'بوابة المعلم' : 'نظام الحصر'}</h1>
    <p>{teacher ? 'ادخل برقم الهوية وكلمة المرور التي سلّمتها لك إدارة مدرستك.' : 'الانضباط أول خطوات النجاح'}</p>
    <div className="auth-tabs auth-tabs-three">
      <button className={mode === 'admin' && !registering ? 'active' : ''} type="button" onClick={() => { setMode('admin'); setRegistering(false); setRegistrationSent(false); setSchoolChoices([]); setSelectedSchoolId(''); setError('') }}>دخول المدرسة</button>
      <button className={mode === 'teacher' ? 'active' : ''} type="button" onClick={() => { setMode('teacher'); setRegistering(false); setRegistrationSent(false); setSchoolChoices([]); setSelectedSchoolId(''); setError('') }}>دخول المعلم</button>
      <button className={mode === 'admin' && registering ? 'active' : ''} type="button" onClick={() => { setMode('admin'); setRegistering(true); setRegistrationSent(false); setSchoolChoices([]); setSelectedSchoolId(''); setError('') }}>تسجيل مدرسة</button>
    </div>
    <form key={teacher ? 'teacher-login' : registering ? 'school-registration' : 'school-login'} onSubmit={submit} autoComplete="on">
      {teacher ? <>
        <label><UserRound size={16} /> رقم الهوية<input name="identityNumber" inputMode="numeric" autoComplete="section-teacher username" required /></label>
        <label><LockKeyhole size={16} /> كلمة المرور<input name="teacherPassword" type="password" autoComplete="section-teacher current-password" minLength={8} required /></label>
        {schoolChoices.length > 0 && <label>المدرسة<select value={selectedSchoolId} onChange={event => setSelectedSchoolId(event.target.value)}>{schoolChoices.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>}
      </> : <>
        {registering && <>
          <label><UserRound size={16} /> اسم المسؤول<input name="name" required /></label>
          <label><School size={16} /> اسم المدرسة<input name="school" required /></label>
        </>}
        <label>البريد الإلكتروني<input name="email" type="email" autoComplete={registering ? 'section-school email' : 'section-school username'} required /></label>
        <label><LockKeyhole size={16} /> كلمة المرور<input name="schoolPassword" type="password" autoComplete={registering ? 'section-school new-password' : 'section-school current-password'} minLength={12} required /></label>
        {registering && <small>استخدم 12 حرفًا على الأقل.</small>}
      </>}
      {registrationSent && <div className="auth-success" role="status">إذا كان البريد صالحاً وغير مسجل، أرسلنا رابط تأكيد. افتحه واضغط زر التأكيد لإكمال التسجيل.</div>}
      {error && <div className="auth-error">{error}</div>}
      <button className="auth-submit" type="submit">{teacher ? 'دخول بوابة المعلم' : registering ? registrationSent ? 'إعادة إرسال رابط التأكيد' : 'إرسال رابط التأكيد' : 'تسجيل الدخول'}</button>
    </form>
  </section></main>
}
