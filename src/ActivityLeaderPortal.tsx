import { type FormEvent, useEffect, useState } from 'react'
import { FileImage, FolderOpen, KeyRound, LogOut, Sparkles } from 'lucide-react'
import { api, type Account } from './api'
import { StudentPortfolioBoard } from './StudentPortfolio'
import { TeacherEvidenceAdmin } from './TeacherEvidenceAdmin'

export function ActivityLeaderPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState(!account.mustChangePassword)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'home' | 'portfolio' | 'evidence' | 'password'>('home')
  const [schoolName, setSchoolName] = useState('المدرسة')

  useEffect(() => {
    void api.activityLeaderProfile().then(profile => setSchoolName(profile.schoolName)).catch(() => {})
  }, [])

  const savePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) { setError('استخدم كلمة مرور من 8 أحرف على الأقل.'); return }
    setBusy(true)
    setError('')
    try {
      await api.changeActivityLeaderPassword(password)
      setPassword('')
      setChanged(true)
    } catch {
      setError('تعذر تغيير كلمة المرور.')
    } finally {
      setBusy(false)
    }
  }

  const passwordForm = <section className="teacher-card teacher-evidence">
    <div className="teacher-section-head"><div><span>أمان الحساب</span><h2>{changed ? 'تغيير كلمة المرور' : 'غيّر كلمة المرور المؤقتة'}</h2><p>استخدم كلمة مرور جديدة للمتابعة.</p></div><KeyRound size={30} /></div>
    {error && <p className="teacher-notice error">{error}</p>}
    <form className="teacher-evidence-form-grid" onSubmit={savePassword}><label className="wide"><span>كلمة المرور الجديدة</span><input type="password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required /></label><button className="primary-button" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}</button></form>
  </section>

  return <main className="teacher-portal" dir="rtl"><section className="teacher-main">
    <header className="teacher-page-title"><span>بوابة رائد النشاط</span><h1>نظام الحصر</h1></header>
    {!changed ? passwordForm : <>
      <nav className="teacher-admin-tabs student-admin-tabs">
        <button type="button" className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}><Sparkles size={17} />الرئيسية</button>
        <button type="button" className={tab === 'portfolio' ? 'active' : ''} onClick={() => setTab('portfolio')}><FolderOpen size={17} />ملفات إنجاز الطلاب</button>
        <button type="button" className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}><FileImage size={17} />شواهد المعلمين</button>
        <button type="button" className={tab === 'password' ? 'active' : ''} onClick={() => setTab('password')}><KeyRound size={17} />كلمة المرور</button>
      </nav>
      {tab === 'home' && <section className="teacher-card teacher-evidence"><div className="teacher-section-head"><div><span>مرحباً {account.displayName}</span><h2>بوابة رائد النشاط</h2><p>يمكنك مراجعة ملفات إنجاز الطلاب وشواهد المعلمين.</p></div><Sparkles size={31} /></div><div className="teacher-report-actions"><button type="button" className="outline-button" onClick={() => setTab('portfolio')}><FolderOpen size={16} />فتح ملفات الإنجاز</button><button type="button" className="outline-button" onClick={() => setTab('evidence')}><FileImage size={16} />شواهد المعلمين</button></div></section>}
      {tab === 'portfolio' && <StudentPortfolioBoard scope="activityLeader" schoolName={schoolName} />}
      {tab === 'evidence' && <TeacherEvidenceAdmin schoolName={schoolName} loadTeachers={api.activityLeaderEvidence} loadRecords={api.activityLeaderEvidenceRecords} />}
      {tab === 'password' && passwordForm}
      <button type="button" className="outline-button" onClick={onLogout}><LogOut size={16} />تسجيل الخروج</button>
    </>}
  </section></main>
}
