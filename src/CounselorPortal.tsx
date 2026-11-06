import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ClipboardList, FileText, GraduationCap, Home, KeyRound, LockKeyhole, LogOut, Menu, MessageSquare, RefreshCw, Send, ShieldAlert, UserRound, Users, X } from 'lucide-react'
import { api, type Account, type CounselorPortalDashboard } from './api'
import { BehaviorCenter } from './BehaviorCenter'
import { CounselorReferralCenter } from './StudentReferrals'
import { MessageCenter, ReportsCenter } from './SchoolFeatures'
import { AbsenceProcedureGuide, CounselorAbsenceReferralQueue } from './AbsenceProcedureGuide'
import { StudentExcuseCenter } from './StudentExcuses'
import { RecipientCirculars } from './TeacherCirculars'

type CounselorView = 'home' | 'behavior' | 'referrals' | 'absenceProcedures' | 'studentExcuses' | 'circulars' | 'reports' | 'teachers' | 'students' | 'messages' | 'password'

const nav: Array<{ id: CounselorView; label: string; icon: typeof Home }> = [
  { id: 'home', label: 'الرئيسية', icon: Home },
  { id: 'behavior', label: 'السلوك', icon: ShieldAlert },
  { id: 'referrals', label: 'الإحالات', icon: Send },
  { id: 'absenceProcedures', label: 'إجراءات التعامل مع الغياب', icon: ClipboardList },
  { id: 'studentExcuses', label: 'استئذان الطلاب', icon: ClipboardList },
  { id: 'circulars', label: 'التعاميم', icon: FileText },
  { id: 'reports', label: 'التقارير', icon: FileText },
  { id: 'teachers', label: 'المعلمون', icon: Users },
  { id: 'students', label: 'الطلاب', icon: GraduationCap },
  { id: 'messages', label: 'الرسائل', icon: MessageSquare },
  { id: 'password', label: 'كلمة المرور', icon: KeyRound },
]

type CounselorNavGroup = 'students' | 'staff' | 'operations' | 'communication' | 'account'

function counselorNavGroupFor(view: CounselorView): CounselorNavGroup | '' {
  if (['students', 'behavior', 'referrals', 'studentExcuses'].includes(view)) return 'students'
  if (view === 'teachers') return 'staff'
  if (['absenceProcedures', 'circulars'].includes(view)) return 'operations'
  if (['messages', 'reports'].includes(view)) return 'communication'
  if (view === 'password') return 'account'
  return ''
}

function CounselorSidebarGroup({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return <section className={open ? 'counselor-nav-group open' : 'counselor-nav-group'}>
    <button type="button" className="counselor-nav-group-toggle" onClick={onToggle} aria-expanded={open}><span>{title}</span><ChevronDown size={16} /></button>
    {open && <div className="counselor-nav-group-items">{children}</div>}
  </section>
}

export function CounselorPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<CounselorPortalDashboard | null>(null)
  const [view, setView] = useState<CounselorView>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [openNavGroup, setOpenNavGroup] = useState<CounselorNavGroup | ''>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordNotice, setPasswordNotice] = useState('')
  const [mustChangePassword, setMustChangePassword] = useState(Boolean(account.mustChangePassword))
  const [search, setSearch] = useState('')
  const [attendance, setAttendance] = useState<unknown[]>([])

  const load = async () => {
    setLoading(true); setError('')
    try {
      const result = await api.counselorPortalDashboard()
      setDashboard(result)
      setMustChangePassword(result.mustChangePassword)
      void api.attendance().then(response => setAttendance(response.records)).catch(() => setAttendance([]))
    } catch { setError('تعذر تحميل بوابة الموجّه الطلابي. حدّث الصفحة أو أعد المحاولة.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const changePassword = async () => {
    setPasswordNotice('')
    if (newPassword.length < 8) { setPasswordNotice('استخدم كلمة مرور من 8 أحرف أو أرقام على الأقل.'); return }
    if (newPassword !== confirmPassword) { setPasswordNotice('تأكيد كلمة المرور غير مطابق.'); return }
    setSavingPassword(true)
    try {
      await api.changeCounselorPassword(newPassword)
      setMustChangePassword(false); setNewPassword(''); setConfirmPassword('')
      setPasswordNotice('تم حفظ كلمة المرور الجديدة بنجاح.')
    } catch { setPasswordNotice('تعذر تغيير كلمة المرور. حاول مرة أخرى.') }
    finally { setSavingPassword(false) }
  }
  const students = useMemo(() => {
    const value = search.trim()
    return value ? (dashboard?.students || []).filter(row => `${row.name} ${row.id} ${row.grade} ${row.classroom}`.includes(value)) : dashboard?.students || []
  }, [dashboard, search])
  const teachers = useMemo(() => {
    const value = search.trim()
    return value ? (dashboard?.teachers || []).filter(row => `${row.name} ${row.identityNumber} ${row.phone}`.includes(value)) : dashboard?.teachers || []
  }, [dashboard, search])
  const go = (next: CounselorView) => {
    setView(next)
    const group = counselorNavGroupFor(next)
    if (group) setOpenNavGroup(group)
    setMenuOpen(false)
    setSearch('')
  }

  if (loading) return <main className="counselor-loading" dir="rtl">جارٍ تجهيز بوابة الموجّه الطلابي…</main>
  if (error || !dashboard) return <main className="counselor-load-error" dir="rtl"><ShieldAlert size={34} /><h1>بوابة الموجّه الطلابي</h1><p>{error || 'تعذر تحميل البيانات.'}</p><button className="primary-button" onClick={() => void load()}><RefreshCw size={16} /> تحديث البيانات</button><button className="outline-button" onClick={onLogout}>تسجيل الخروج</button></main>

  const activeLabel = nav.find(item => item.id === view)?.label || 'الرئيسية'
  return <main className="student-portal counselor-portal" dir="rtl">
    {menuOpen && <button type="button" className="student-sidebar-backdrop" aria-label="إغلاق القائمة" onClick={() => setMenuOpen(false)} />}
    <button type="button" className="student-mobile-menu" onClick={() => setMenuOpen(true)} aria-label="فتح القائمة"><Menu size={21} /></button>
    <aside className={`student-sidebar${menuOpen ? ' open' : ''}`}>
      <div className="student-brand"><UserRound size={24} /><div><strong>بوابة الموجّه الطلابي</strong><small>{dashboard.counselor.name}</small></div><button type="button" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة"><X size={18} /></button></div>
      <nav className="counselor-sidebar-nav" aria-label="التنقل الرئيسي للموجّه">
        <button type="button" className={view === 'home' ? 'active' : ''} onClick={() => go('home')}><Home size={18} />الرئيسية</button>
        <CounselorSidebarGroup title="الطلاب" open={openNavGroup === 'students'} onToggle={() => setOpenNavGroup(current => current === 'students' ? '' : 'students')}>
          <button type="button" className={view === 'students' ? 'active' : ''} onClick={() => go('students')}><GraduationCap size={18} />الطلاب</button>
          <button type="button" className={view === 'studentExcuses' ? 'active' : ''} onClick={() => go('studentExcuses')}><ClipboardList size={18} />استئذان الطلاب</button>
          <button type="button" className={view === 'behavior' ? 'active' : ''} onClick={() => go('behavior')}><ShieldAlert size={18} />سجل السلوك</button>
          <button type="button" className={view === 'referrals' ? 'active' : ''} onClick={() => go('referrals')}><Send size={18} />إحالات الطلاب</button>
        </CounselorSidebarGroup>
        <CounselorSidebarGroup title="الكادر المدرسي" open={openNavGroup === 'staff'} onToggle={() => setOpenNavGroup(current => current === 'staff' ? '' : 'staff')}>
          <button type="button" className={view === 'teachers' ? 'active' : ''} onClick={() => go('teachers')}><Users size={18} />المعلمون</button>
        </CounselorSidebarGroup>
        <CounselorSidebarGroup title="التشغيل اليومي" open={openNavGroup === 'operations'} onToggle={() => setOpenNavGroup(current => current === 'operations' ? '' : 'operations')}>
          <button type="button" className={view === 'absenceProcedures' ? 'active' : ''} onClick={() => go('absenceProcedures')}><ClipboardList size={18} />إجراءات التعامل مع الغياب <b className="absence-procedure-new-badge">جديد</b></button>
          <button type="button" className={view === 'circulars' ? 'active' : ''} onClick={() => go('circulars')}><FileText size={18} />التعاميم <b className="absence-procedure-new-badge">جديد</b></button>
        </CounselorSidebarGroup>
        <CounselorSidebarGroup title="التواصل والتقارير" open={openNavGroup === 'communication'} onToggle={() => setOpenNavGroup(current => current === 'communication' ? '' : 'communication')}>
          <button type="button" className={view === 'messages' ? 'active' : ''} onClick={() => go('messages')}><MessageSquare size={18} />الرسائل</button>
          <button type="button" className={view === 'reports' ? 'active' : ''} onClick={() => go('reports')}><FileText size={18} />التقارير</button>
        </CounselorSidebarGroup>
        <CounselorSidebarGroup title="الحساب" open={openNavGroup === 'account'} onToggle={() => setOpenNavGroup(current => current === 'account' ? '' : 'account')}>
          <button type="button" className={view === 'password' ? 'active' : ''} onClick={() => go('password')}><KeyRound size={18} />كلمة المرور</button>
        </CounselorSidebarGroup>
      </nav>
      <button type="button" className="student-logout" onClick={onLogout}><LogOut size={18} /> تسجيل الخروج</button>
    </aside>
    <section className="student-workspace counselor-workspace">
      <header className="student-topbar"><div><span>بوابة الموجّه الطلابي / {activeLabel}</span><h1>{dashboard.schoolName}</h1></div><button type="button" className="outline-button" onClick={() => void load()}><RefreshCw size={15} /> تحديث البيانات</button></header>
      {mustChangePassword && view !== 'password' && <section className="student-password-required"><LockKeyhole size={21} /><div><strong>تغيير كلمة المرور مطلوب</strong><span>هذه أول زيارة أو تمت إعادة ضبط الحساب. غيّر كلمة المرور قبل متابعة أعمال اليوم.</span></div><button type="button" onClick={() => go('password')}>تغيير كلمة المرور</button></section>}

      {view === 'home' && <section className="counselor-home"><section className="counselor-welcome"><div><span>مرحبًا بك</span><h2>{dashboard.counselor.name}</h2><p>تابع السلوك والإحالات وبيانات الطلاب والمعلمين من بوابة واحدة.</p></div><ShieldAlert size={42} /></section><div className="counselor-home-grid"><article><GraduationCap size={23} /><span>الطلاب</span><strong>{dashboard.students.length}</strong><button type="button" onClick={() => go('students')}>عرض الطلاب</button></article><article><Users size={23} /><span>المعلمون</span><strong>{dashboard.teachers.length}</strong><button type="button" onClick={() => go('teachers')}>عرض المعلمين</button></article><article><ShieldAlert size={23} /><span>متابعة الحالات</span><strong>السلوك والإحالات</strong><button type="button" onClick={() => go('behavior')}>فتح السلوك</button></article></div><section className="counselor-profile-card"><h3>بيانات الموجّه</h3><dl><div><dt>الاسم</dt><dd>{dashboard.counselor.name}</dd></div><div><dt>رقم الهوية</dt><dd dir="ltr">{dashboard.counselor.identityNumber}</dd></div><div><dt>رقم الجوال</dt><dd dir="ltr">{dashboard.counselor.phone || '—'}</dd></div></dl></section></section>}
      {view === 'behavior' && <BehaviorCenter school={{ schoolName: dashboard.schoolName, principalName: '', academicYear: '', semester: '' }} role="counselor" />}
      {view === 'referrals' && <CounselorReferralCenter schoolName={dashboard.schoolName} />}
      {view === 'absenceProcedures' && <><AbsenceProcedureGuide role="counselor" /><CounselorAbsenceReferralQueue /></>}
      {view === 'studentExcuses' && <StudentExcuseCenter schoolName={dashboard.schoolName} />}
      {view === 'circulars' && <RecipientCirculars schoolName={dashboard.schoolName} />}
      {view === 'reports' && <ReportsCenter students={dashboard.students} schoolName={dashboard.schoolName} viewer="counselor" />}
      {view === 'messages' && <MessageCenter students={dashboard.students} attendance={attendance as never[]} schoolName={dashboard.schoolName} />}
      {view === 'teachers' && <section className="counselor-directory"><header><div><span>بيانات المدرسة</span><h2>المعلمون</h2><p>عرض قائمة المعلمين ووسائل التواصل.</p></div><Users size={30} /></header><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم المعلم أو رقم الهوية أو الجوال" /> <div className="counselor-directory-grid">{teachers.map(teacher => <article key={teacher.teacherId}><strong>{teacher.name}</strong><span>رقم الهوية <b dir="ltr">{teacher.identityNumber || '—'}</b></span><small dir="ltr">{teacher.phone || 'لا يوجد رقم جوال'}</small></article>)}</div>{!teachers.length && <p className="teacher-empty">لا يوجد معلمون مطابقون للبحث.</p>}</section>}
      {view === 'students' && <section className="counselor-directory"><header><div><span>بيانات المدرسة</span><h2>الطلاب</h2><p>عرض الطلاب حسب الصف والفصل وبيانات التواصل.</p></div><GraduationCap size={30} /></header><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الطالب أو رقمه أو الصف أو الفصل" /> <div className="counselor-directory-grid student-directory-grid">{students.map(student => <article key={student.id}><strong>{student.name}</strong><span>{student.grade} · الفصل {student.classroom}</span><small><b dir="ltr">{student.id}</b>{student.phone ? ` · ${student.phone}` : ''}</small></article>)}</div>{!students.length && <p className="teacher-empty">لا يوجد طلاب مطابقون للبحث.</p>}</section>}
      {view === 'password' && <section className="student-password-card counselor-password-card"><div><KeyRound size={24} /><div><span>أمان الحساب</span><h2>تغيير كلمة المرور</h2><p>استخدم كلمة مرور جديدة لا يعرفها أحد غيرك.</p></div></div><label>كلمة المرور الجديدة<input type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} /></label><label>تأكيد كلمة المرور<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={8} /></label>{passwordNotice && <p className={passwordNotice.startsWith('تم') ? 'student-portal-notice success' : 'student-portal-notice error'}>{passwordNotice}</p>}<button type="button" className="primary-button" onClick={() => void changePassword()} disabled={savingPassword}>{savingPassword ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}</button></section>}
    </section>
  </main>
}
