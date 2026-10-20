import { type FormEvent, useState } from 'react'
import { KeyRound, LogOut, Sparkles } from 'lucide-react'
import { api, type Account } from './api'

export function ActivityLeaderPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(!account.mustChangePassword)
  const [error, setError] = useState('')
  const savePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) { setError('استخدم كلمة مرور من 8 أحرف على الأقل.'); return }
    setBusy(true); setError('')
    try { await api.changeActivityLeaderPassword(password); setPassword(''); setChanged(true) }
    catch { setError('تعذر تغيير كلمة المرور.') } finally { setBusy(false) }
  }
  return <main className="teacher-portal" dir="rtl"><section className="teacher-main"><header className="teacher-page-title"><span>بوابة رائد النشاط</span><h1>نظام الحصر</h1></header>{!changed ? <section className="teacher-card teacher-evidence"><div className="teacher-section-head"><div><span>أمان الحساب</span><h2>غيّر كلمة المرور المؤقتة</h2><p>استخدم كلمة مرور جديدة للمتابعة.</p></div><KeyRound size={30} /></div>{error && <p className="teacher-notice error">{error}</p>}<form className="teacher-evidence-form-grid" onSubmit={savePassword}><label className="wide"><span>كلمة المرور الجديدة</span><input type="password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="primary-button" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}</button></form></section> : <section className="teacher-card teacher-evidence"><div className="teacher-section-head"><div><span>مرحباً {account.displayName}</span><h2>بوابة رائد النشاط</h2><p>تم إنشاء الحساب بنجاح. ستضاف الصلاحيات والتبويبات في الخطوة التالية.</p></div><Sparkles size={31} /></div><button type="button" className="outline-button" onClick={onLogout}><LogOut size={16} />تسجيل الخروج</button></section>}</section></main>
}
