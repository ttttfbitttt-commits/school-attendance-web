import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { LockKeyhole, School, UserRound } from 'lucide-react'
import { api, type Account } from './api'

type LoginMode = 'admin' | 'teacher'

export function AuthGate({ children }: { children: (account: Account, logout: () => void) => ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
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
    const values = new FormData(event.currentTarget)
    try {
      const result = mode === 'teacher'
        ? await api.teacherLogin(String(values.get('identityNumber') || ''), String(values.get('password') || ''), selectedSchoolId)
        : registering
          ? await api.register(String(values.get('name') || ''), String(values.get('school') || ''), String(values.get('email') || ''), String(values.get('password') || ''))
          : await api.login(String(values.get('email') || ''), String(values.get('password') || ''))
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
        : 'تعذر الدخول. تحقق من البريد وكلمة المرور، أو جرّب لاحقًا.')
    }
  }

  function logout() {
    void api.logout().catch(() => {}).finally(() => setAccount(null))
  }

  if (loading) return <div className="auth-loading">جارٍ الاتصال بالنظام الآمن…</div>
  if (account) return <>{children(account, logout)}</>

  const teacher = mode === 'teacher'
  return <main className="auth-page" dir="rtl"><section className="auth-card">
    <div className="auth-icon"><School size={30} /></div>
    <h1>{teacher ? 'بوابة المعلم' : 'نظام حصر الطلاب'}</h1>
    <p>{teacher ? 'ادخل برقم الهوية وكلمة المرور التي سلّمتها لك إدارة مدرستك.' : 'بيانات كل مدرسة محفوظة في مساحة مستقلة وآمنة.'}</p>
    <div className="auth-tabs auth-tabs-three">
      <button className={mode === 'admin' && !registering ? 'active' : ''} type="button" onClick={() => { setMode('admin'); setRegistering(false); setSchoolChoices([]); setSelectedSchoolId(''); setError('') }}>دخول الإدارة</button>
      <button className={mode === 'teacher' ? 'active' : ''} type="button" onClick={() => { setMode('teacher'); setRegistering(false); setSchoolChoices([]); setSelectedSchoolId(''); setError('') }}>دخول المعلم</button>
      <button className={mode === 'admin' && registering ? 'active' : ''} type="button" onClick={() => { setMode('admin'); setRegistering(true); setSchoolChoices([]); setSelectedSchoolId(''); setError('') }}>تسجيل مدرسة</button>
    </div>
    <form onSubmit={submit}>
      {teacher ? <>
        <label><UserRound size={16} /> رقم الهوية<input name="identityNumber" inputMode="numeric" autoComplete="username" required /></label>
        <label><LockKeyhole size={16} /> كلمة المرور<input name="password" type="password" autoComplete="current-password" minLength={8} required /></label>
        {schoolChoices.length > 0 && <label>المدرسة<select value={selectedSchoolId} onChange={event => setSelectedSchoolId(event.target.value)}>{schoolChoices.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>}
      </> : <>
        {registering && <>
          <label><UserRound size={16} /> اسم المسؤول<input name="name" required /></label>
          <label><School size={16} /> اسم المدرسة<input name="school" required /></label>
        </>}
        <label>البريد الإلكتروني<input name="email" type="email" autoComplete="email" required /></label>
        <label><LockKeyhole size={16} /> كلمة المرور<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={12} required /></label>
        {registering && <small>استخدم 12 حرفًا على الأقل.</small>}
      </>}
      {error && <div className="auth-error">{error}</div>}
      <button className="auth-submit" type="submit">{teacher ? 'دخول بوابة المعلم' : registering ? 'إنشاء الحساب' : 'دخول آمن'}</button>
    </form>
  </section></main>
}
