import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { LockKeyhole, School, UserRound } from 'lucide-react'
import { api, type Account } from './api'

export function AuthGate({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api.me().then(({ user }) => setAccount(user)).catch(() => {}).finally(() => setLoading(false)) }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('')
    const values = new FormData(event.currentTarget)
    try {
      const result = registering
        ? await api.register(String(values.get('name') || ''), String(values.get('school') || ''), String(values.get('email') || ''), String(values.get('password') || ''))
        : await api.login(String(values.get('email') || ''), String(values.get('password') || ''))
      setAccount(result.user)
    } catch { setError('تعذر الدخول. تحقق من البريد وكلمة المرور، أو جرّب لاحقاً.') }
  }
  if (loading) return <div className="auth-loading">جارٍ الاتصال بالنظام الآمن…</div>
  if (account) return <>{children}</>
  return <main className="auth-page"><section className="auth-card">
    <div className="auth-icon"><School size={30} /></div><h1>نظام حصر الحضور</h1><p>بيانات كل مدرسة محفوظة في مساحة مستقلة وآمنة.</p>
    <div className="auth-tabs"><button className={!registering ? 'active' : ''} onClick={() => setRegistering(false)}>دخول</button><button className={registering ? 'active' : ''} onClick={() => setRegistering(true)}>تسجيل مدرسة</button></div>
    <form onSubmit={submit}>
      {registering && <><label><UserRound size={16} /> اسم المسؤول<input name="name" required /></label><label><School size={16} /> اسم المدرسة<input name="school" required /></label></>}
      <label>البريد الإلكتروني<input name="email" type="email" autoComplete="email" required /></label>
      <label><LockKeyhole size={16} /> كلمة المرور<input name="password" type="password" autoComplete={registering ? 'new-password' : 'current-password'} minLength={12} required /></label>
      {registering && <small>استخدم 12 حرفاً على الأقل.</small>}{error && <div className="auth-error">{error}</div>}
      <button className="auth-submit" type="submit">{registering ? 'إنشاء الحساب' : 'دخول آمن'}</button>
    </form>
  </section></main>
}
