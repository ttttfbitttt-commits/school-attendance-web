import { useEffect, useMemo, useState } from 'react'
import { FolderOpen, KeyRound, Power, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { api, type StudentPortalAccount } from './api'
import { StudentPortfolioBoard } from './StudentPortfolio'

export function StudentAdminCenter() {
  const [tab, setTab] = useState<'accounts' | 'portfolio'>('accounts')
  const [students, setStudents] = useState<StudentPortalAccount[]>([])
  const [defaultPassword, setDefaultPassword] = useState('12345678')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = async () => {
    setBusy('load'); setError('')
    try {
      const result = await api.studentAdminOverview()
      setStudents(result.students)
      setDefaultPassword(result.defaultPassword)
    } catch { setError('تعذر تحميل حسابات الطلاب.') } finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])

  const generate = async () => {
    setBusy('generate'); setNotice(''); setError('')
    try {
      const result = await api.generateStudentAccounts()
      setDefaultPassword(result.defaultPassword)
      setNotice(result.created ? `تم إنشاء ${result.created} حساب طالب. كلمة المرور المؤقتة الموحدة: ${result.defaultPassword}` : 'لا توجد حسابات جديدة لإنشائها؛ الحسابات المؤهلة موجودة بالفعل.')
      await load()
    } catch { setError('تعذر إنشاء حسابات الطلاب. تأكد أن أرقام الهوية رقمية ومكتملة.') } finally { setBusy('') }
  }
  const reset = async (student: StudentPortalAccount) => {
    setBusy(`reset:${student.studentId}`); setNotice(''); setError('')
    try {
      const result = await api.resetStudentAccount(student.studentId)
      setNotice(`أُعيد ضبط حساب ${student.name} إلى كلمة المرور المؤقتة: ${result.temporaryPassword}`)
      await load()
    } catch { setError('تعذر إعادة ضبط الحساب.') } finally { setBusy('') }
  }
  const changeStatus = async (student: StudentPortalAccount) => {
    setBusy(`status:${student.studentId}`); setError('')
    try { await api.setStudentAccountStatus(student.studentId, !student.accountActive); await load() }
    catch { setError('تعذر تغيير حالة الحساب.') } finally { setBusy('') }
  }
  const filtered = useMemo(() => {
    const value = search.trim().toLocaleLowerCase('ar')
    return value ? students.filter(student => [student.name, student.identityNumber, student.grade, student.classroom].join(' ').toLocaleLowerCase('ar').includes(value)) : students
  }, [students, search])
  const created = students.filter(student => student.accountCreated).length
  const eligible = students.filter(student => student.eligible).length

  return <section className="student-admin-center" dir="rtl">
    <div className="teacher-admin-head student-admin-head"><div><span>بوابة الطالب</span><h2>حسابات الطلاب وملف الإنجاز</h2><p>يستخدم الطالب رقم هويته للدخول، ثم يغير كلمة المرور المؤقتة في أول زيارة.</p></div><Users size={32} /></div>
    <div className="teacher-admin-tabs student-admin-tabs"><button type="button" className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}><KeyRound size={17} /> حسابات الطلاب</button><button type="button" className={tab === 'portfolio' ? 'active' : ''} onClick={() => setTab('portfolio')}><FolderOpen size={17} /> ملف الإنجاز</button></div>
    {tab === 'portfolio' ? <StudentPortfolioBoard scope="school" /> : <>
      <div className="student-account-summary"><article><Users size={19} /><span>الطلاب</span><b>{students.length}</b></article><article><ShieldCheck size={19} /><span>مؤهلون للحساب</span><b>{eligible}</b></article><article><KeyRound size={19} /><span>حسابات منشأة</span><b>{created}</b></article></div>
      <section className="teacher-admin-card student-account-tools"><div><strong>إنشاء الحسابات دفعة واحدة</strong><p>تُنشأ الحسابات للطلاب الذين يحملون رقم هوية رقميًا، وكلمة المرور المؤقتة الموحدة هي <b dir="ltr">{defaultPassword}</b>.</p></div><div><button type="button" className="outline-button" onClick={() => void load()} disabled={busy !== ''}><RefreshCw size={16} /> تحديث</button><button type="button" className="primary-button" onClick={() => void generate()} disabled={busy !== ''}><KeyRound size={16} /> {busy === 'generate' ? 'جارٍ الإنشاء…' : 'توليد حسابات الطلاب'}</button></div></section>
      {notice && <p className="student-portal-notice success">{notice}</p>}{error && <p className="student-portal-notice error">{error}</p>}
      <input className="student-account-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الطالب أو رقم الهوية أو الفصل" />
      <div className="teacher-account-list student-account-list">{filtered.map(student => <article key={student.studentId}>
        <div className="teacher-account-avatar">{student.name.charAt(0)}</div><div><strong>{student.name}</strong><span>{student.grade} · الفصل {student.classroom}</span><small dir="ltr">{student.identityNumber || 'لا يوجد رقم هوية رقمي'}</small></div>
        <span className={`teacher-account-badge ${student.accountCreated && student.accountActive ? 'ready' : ''}`}>{!student.eligible ? 'رقم الهوية غير صالح' : !student.accountCreated ? 'غير منشأ' : student.accountActive ? student.mustChangePassword ? 'بانتظار تغيير المرور' : 'نشط' : 'موقوف'}</span>
        {student.accountCreated && <div className="teacher-account-actions"><button type="button" onClick={() => void reset(student)} disabled={busy !== ''}><RefreshCw size={14} /> إعادة ضبط</button><button type="button" onClick={() => void changeStatus(student)} disabled={busy !== ''}><Power size={14} /> {student.accountActive ? 'إيقاف' : 'تفعيل'}</button></div>}
      </article>)}</div>
    </>}
  </section>
}
