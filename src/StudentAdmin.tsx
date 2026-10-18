import { useEffect, useMemo, useState } from 'react'
import { Camera, FolderOpen, KeyRound, Power, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { api, type StudentAccountGeneration, type StudentPortalAccount } from './api'
import { StudentPortfolioBoard } from './StudentPortfolio'

export function StudentAdminCenter() {
  const [tab, setTab] = useState<'accounts' | 'portfolio'>('accounts')
  const [students, setStudents] = useState<StudentPortalAccount[]>([])
  const [defaultPassword, setDefaultPassword] = useState('12345678')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [generation, setGeneration] = useState<StudentAccountGeneration | null>(null)

  const refreshOverview = async () => {
    const result = await api.studentAdminOverview()
    setStudents(result.students)
    setDefaultPassword(result.defaultPassword)
  }
  const load = async () => {
    setBusy('load'); setError('')
    try { await refreshOverview() }
    catch { setError('تعذر تحميل حسابات الطلاب.') } finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])

  const followGeneration = async (jobId: string) => {
    try {
      while (true) {
        await new Promise(resolve => window.setTimeout(resolve, 650))
        const result = await api.studentAccountGenerationProgress(jobId)
        setGeneration(result)
        setDefaultPassword(result.defaultPassword)
        if (result.status === 'running') continue
        await refreshOverview()
        setNotice(result.failed
          ? `اكتمل إنشاء الحسابات مع تعذر إنشاء ${result.failed} حساب. تم إنشاء ${result.created} حساب وتجاوز ${result.skipped} حساب موجود.`
          : result.created
            ? `اكتمل إنشاء ${result.created} حساب طالب. كلمة المرور المؤقتة الموحدة: ${result.defaultPassword}`
            : 'اكتملت العملية؛ لا توجد حسابات جديدة لأن الحسابات المؤهلة موجودة بالفعل.')
        setBusy('')
        return
      }
    } catch {
      setError('تعذر متابعة تقدم إنشاء الحسابات. حدّث الصفحة للتحقق من حالة الحسابات.')
      setBusy('')
    }
  }
  const generate = async () => {
    setBusy('generate'); setNotice(''); setError('')
    try {
      const result = await api.startStudentAccountGeneration()
      setGeneration(result)
      setDefaultPassword(result.defaultPassword)
      void followGeneration(result.jobId)
    } catch { setError('تعذر بدء إنشاء حسابات الطلاب. تأكد أن أرقام الهوية رقمية ومكتملة.'); setBusy('') }
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
  const changeAttendanceCooperation = async (student: StudentPortalAccount) => {
    setBusy(`cooperation:${student.studentId}`); setNotice(''); setError('')
    try {
      const result = await api.setStudentAttendanceCooperationAccess(student.studentId, !student.attendanceCooperationAccess)
      setNotice(result.attendanceCooperationAccess
        ? `مُنح ${student.name} صلاحية تعاون الطالب لتحضير فصلِه بالكاميرا في الحصة الأولى.`
        : `أُلغيت صلاحية تعاون الطالب من حساب ${student.name}.`)
      await refreshOverview()
    } catch { setError('تعذر تغيير صلاحية تحضير الطالب.') } finally { setBusy('') }
  }
  const filtered = useMemo(() => {
    const value = search.trim().toLocaleLowerCase('ar')
    return value ? students.filter(student => [student.name, student.identityNumber, student.grade, student.classroom].join(' ').toLocaleLowerCase('ar').includes(value)) : students
  }, [students, search])
  const created = students.filter(student => student.accountCreated).length
  const eligible = students.filter(student => student.eligible).length
  const progress = generation?.total ? Math.round((generation.processed / generation.total) * 100) : generation ? 100 : 0

  return <section className="student-admin-center" dir="rtl">
    <div className="teacher-admin-head student-admin-head"><div><span>بوابة الطالب</span><h2>حسابات الطلاب وملف الإنجاز</h2><p>يستخدم الطالب رقم هويته للدخول، ثم يغير كلمة المرور المؤقتة في أول زيارة.</p></div><Users size={32} /></div>
    <div className="teacher-admin-tabs student-admin-tabs"><button type="button" className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}><KeyRound size={17} /> حسابات الطلاب</button><button type="button" className={tab === 'portfolio' ? 'active' : ''} onClick={() => setTab('portfolio')}><FolderOpen size={17} /> ملف الإنجاز</button></div>
    {tab === 'portfolio' ? <StudentPortfolioBoard scope="school" /> : <>
      <div className="student-account-summary"><article><Users size={19} /><span>الطلاب</span><b>{students.length}</b></article><article><ShieldCheck size={19} /><span>مؤهلون للحساب</span><b>{eligible}</b></article><article><KeyRound size={19} /><span>حسابات منشأة</span><b>{created}</b></article></div>
      <section className="teacher-admin-card student-account-tools"><div><strong>إنشاء الحسابات دفعة واحدة</strong><p>تُنشأ الحسابات للطلاب الذين يحملون رقم هوية رقميًا، وكلمة المرور المؤقتة الموحدة هي <b dir="ltr">{defaultPassword}</b>.</p></div><div><button type="button" className="outline-button" onClick={() => void load()} disabled={busy !== ''}><RefreshCw size={16} /> تحديث</button><button type="button" className="primary-button" onClick={() => void generate()} disabled={busy !== ''}><KeyRound size={16} /> {busy === 'generate' ? 'جارٍ الإنشاء…' : 'توليد حسابات الطلاب'}</button></div></section>
      {generation && <section className={`student-account-progress ${generation.status}`} aria-live="polite"><div><strong>{generation.status === 'running' ? 'جارٍ إنشاء حسابات الطلاب' : generation.status === 'failed' ? 'توقفت عملية إنشاء الحسابات' : 'اكتمل إنشاء حسابات الطلاب'}</strong><span><b dir="ltr">{generation.processed}</b> من <b dir="ltr">{generation.total}</b> · <b dir="ltr">{progress}%</b></span></div><div className="student-account-progress-track"><i style={{ width: `${progress}%` }} /></div><small>تم إنشاء <b dir="ltr">{generation.created}</b> · موجود مسبقًا <b dir="ltr">{generation.skipped}</b>{generation.failed ? <> · تعذر <b dir="ltr">{generation.failed}</b></> : null}</small></section>}
      {notice && <p className="student-portal-notice success">{notice}</p>}{error && <p className="student-portal-notice error">{error}</p>}
      <input className="student-account-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الطالب أو رقم الهوية أو الفصل" />
      <div className="teacher-account-list student-account-list">{filtered.map(student => <article key={student.studentId}>
        <div className="teacher-account-avatar">{student.name.charAt(0)}</div><div><strong>{student.name}</strong><span>{student.grade} · الفصل {student.classroom}</span><small dir="ltr">{student.identityNumber || 'لا يوجد رقم هوية رقمي'}</small></div>
        <span className={`teacher-account-badge ${student.accountCreated && student.accountActive ? 'ready' : ''}`}>{!student.eligible ? 'رقم الهوية غير صالح' : !student.accountCreated ? 'غير منشأ' : student.accountActive ? student.mustChangePassword ? 'بانتظار تغيير المرور' : 'نشط' : 'موقوف'}</span>
        {student.accountCreated && <div className="teacher-account-actions"><button type="button" onClick={() => void reset(student)} disabled={busy !== ''}><RefreshCw size={14} /> إعادة ضبط</button><button type="button" onClick={() => void changeStatus(student)} disabled={busy !== ''}><Power size={14} /> {student.accountActive ? 'إيقاف' : 'تفعيل'}</button><button type="button" className={student.attendanceCooperationAccess ? 'student-cooperation-access enabled' : 'student-cooperation-access'} aria-pressed={student.attendanceCooperationAccess} onClick={() => void changeAttendanceCooperation(student)} disabled={busy !== ''}><Camera size={14} /> {student.attendanceCooperationAccess ? 'إلغاء صلاحية التحضير' : 'صلاحية التحضير'}</button></div>}
      </article>)}</div>
    </>}
  </section>
}
