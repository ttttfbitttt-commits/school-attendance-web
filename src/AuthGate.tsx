import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { LockKeyhole, School, UserRound } from 'lucide-react'
import { api, type Account } from './api'

type LoginMode = 'admin' | 'teacher' | 'administrator'

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
  const [schoolName, setSchoolName] = useState('')
  const [administratorName, setAdministratorName] = useState('')
  const [schoolEmail, setSchoolEmail] = useState('')
  const [schoolPassword, setSchoolPassword] = useState('')
  const [teacherIdentityNumber, setTeacherIdentityNumber] = useState('')
  const [teacherPassword, setTeacherPassword] = useState('')

  useEffect(() => {
    api.me().then(({ user }) => setAccount(user)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setRegistrationSent(false)
    try {
      if (mode === 'teacher' || mode === 'administrator') {
        const result = mode === 'teacher'
          ? await api.teacherLogin(teacherIdentityNumber, teacherPassword, selectedSchoolId)
          : await api.administratorLogin(teacherIdentityNumber, teacherPassword, selectedSchoolId)
        setAccount(result.user)
        return
      }
      if (registering) {
        await api.register(administratorName, schoolName, schoolEmail, schoolPassword)
        setRegistrationSent(true)
        return
      }
      const result = await api.login(schoolEmail, schoolPassword)
      setAccount(result.user)
    } catch (reason) {
      const apiError = reason as Error & { code?: string; data?: { schools?: Array<{ id: string; name: string }> } }
      if ((mode === 'teacher' || mode === 'administrator') && (apiError.code === 'teacher_school_selection_required' || apiError.code === 'administrator_school_selection_required') && apiError.data?.schools?.length) {
        setSchoolChoices(apiError.data.schools)
        setSelectedSchoolId(apiError.data.schools[0].id)
        setError('لديك حسابات في أكثر من مدرسة. اختر المدرسة ثم أعد الدخول.')
        return
      }
      setError(mode === 'teacher' || mode === 'administrator'
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

  function switchMode(nextMode: LoginMode, nextRegistering: boolean) {
    setMode(nextMode)
    setRegistering(nextRegistering)
    setRegistrationSent(false)
    setSchoolChoices([])
    setSelectedSchoolId('')
    setError('')
    setSchoolName('')
    setAdministratorName('')
    setSchoolEmail('')
    setSchoolPassword('')
    setTeacherIdentityNumber('')
    setTeacherPassword('')
  }

  const teacher = mode === 'teacher'
  const administrator = mode === 'administrator'
  return <main className="auth-page" dir="rtl"><section className="auth-card">
    <div className="auth-icon"><School size={30} /></div>
    <h1>{teacher ? 'بوابة المعلم' : administrator ? 'بوابة الإداري' : 'نظام الحصر'}</h1>
    <p>{teacher || administrator ? 'ادخل برقم الهوية وكلمة المرور التي سلّمتها لك إدارة مدرستك.' : 'الانضباط أول خطوات النجاح'}</p>
    <div className="auth-tabs auth-tabs-four">
      <button className={mode === 'admin' && !registering ? 'active' : ''} type="button" onClick={() => switchMode('admin', false)}>دخول المدرسة</button>
      <button className={mode === 'teacher' ? 'active' : ''} type="button" onClick={() => switchMode('teacher', false)}>دخول المعلم</button>
      <button className={mode === 'administrator' ? 'active' : ''} type="button" onClick={() => switchMode('administrator', false)}>دخول الإداري</button>
      <button className={mode === 'admin' && registering ? 'active' : ''} type="button" onClick={() => switchMode('admin', true)}>تسجيل مدرسة</button>
    </div>
    <form key={teacher ? 'teacher-login' : administrator ? 'administrator-login' : registering ? 'school-registration' : 'school-login'} onSubmit={submit} autoComplete="on">
      {teacher || administrator ? <>
        <label><UserRound size={16} /> رقم الهوية<input name={administrator ? 'administrator-national-id' : 'teacher-national-id'} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" autoCapitalize="none" enterKeyHint="next" value={teacherIdentityNumber} onChange={event => setTeacherIdentityNumber(event.target.value.includes('@') ? '' : event.target.value.replace(/\D/g, ''))} required /></label>
        <label><LockKeyhole size={16} /> كلمة المرور<input name={administrator ? 'administratorPassword' : 'teacherPassword'} type="password" autoComplete={administrator ? 'section-administrator current-password' : 'section-teacher current-password'} enterKeyHint="go" value={teacherPassword} onChange={event => setTeacherPassword(event.target.value)} minLength={8} required /></label>
        {schoolChoices.length > 0 && <label>المدرسة<select value={selectedSchoolId} onChange={event => setSelectedSchoolId(event.target.value)}>{schoolChoices.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>}
      </> : <>
        {registering && <>
          <label><UserRound size={16} /> اسم المسؤول<input name="name" value={administratorName} onChange={event => setAdministratorName(event.target.value)} required /></label>
          <label><School size={16} /> اسم المدرسة<input name="school" value={schoolName} onChange={event => setSchoolName(event.target.value)} required /></label>
        </>}
        <label>البريد الإلكتروني<input name="email" type="email" autoComplete={registering ? 'section-school email' : 'section-school username'} value={schoolEmail} onChange={event => setSchoolEmail(event.target.value)} required /></label>
        <label><LockKeyhole size={16} /> كلمة المرور<input name="schoolPassword" type="password" autoComplete={registering ? 'section-school new-password' : 'section-school current-password'} value={schoolPassword} onChange={event => setSchoolPassword(event.target.value)} minLength={12} required /></label>
        {registering && <small>استخدم 12 حرفًا على الأقل.</small>}
      </>}
      {registrationSent && <div className="auth-success" role="status">إذا كان البريد صالحاً وغير مسجل، أرسلنا رابط تأكيد. افتحه واضغط زر التأكيد لإكمال التسجيل.</div>}
      {error && <div className="auth-error">{error}</div>}
      <button className="auth-submit" type="submit">{teacher ? 'دخول بوابة المعلم' : administrator ? 'دخول بوابة الإداري' : registering ? registrationSent ? 'إعادة إرسال رابط التأكيد' : 'إرسال رابط التأكيد' : 'تسجيل الدخول'}</button>
    </form>
  </section></main>
}
