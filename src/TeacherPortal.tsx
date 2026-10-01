import { useEffect, useState } from 'react'
import { BarChart3, BookOpenCheck, FileSpreadsheet, KeyRound, LayoutDashboard, LogOut, Menu, Save, UserRound, X } from 'lucide-react'
import { api, type Account, type TeacherLesson, type TeacherNote, type TeacherPortalDashboard, type TeacherPortalScheduleItem } from './api'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate } from './dateUtils'

const notes: TeacherNote[] = ['هروب من الحصة', 'نائم أثناء الدرس', 'لم يحل الواجب', 'لم يشارك', 'مشارك فعال', 'لم يحضر الكتاب أو المذكرة', 'استخدام الجوال أثناء الحصة']
const dayNames = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const periodLabel = (period: number) => `الحصة ${['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'][period] || period}`

type StudentState = { status: 'present' | 'absent'; note: TeacherNote | '' }
type TeacherTab = 'home' | 'sheets' | 'reports' | 'password'

export function TeacherPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [date, setDate] = useState(today())
  const [dashboard, setDashboard] = useState<TeacherPortalDashboard | null>(null)
  const [lesson, setLesson] = useState<TeacherLesson | null>(null)
  const [selected, setSelected] = useState<TeacherPortalScheduleItem | null>(null)
  const [states, setStates] = useState<Record<string, StudentState>>({})
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [passwordChanged, setPasswordChanged] = useState(!account.mustChangePassword)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [activeTab, setActiveTab] = useState<TeacherTab>('home')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const loadDashboard = async () => {
    setBusy('dashboard')
    setError('')
    try { setDashboard(await api.teacherDashboard(date)) } catch { setError('تعذر تحميل جدولك. اطلب من الإدارة التأكد من ربط حسابك بالجدول.') } finally { setBusy('') }
  }

  useEffect(() => { void loadDashboard() }, [date])

  const openLesson = async (item: TeacherPortalScheduleItem) => {
    setBusy(`lesson-${item.assignmentId}`)
    setError('')
    try {
      const next = await api.teacherLesson(item.classroomId, date, item.periodNumber)
      setLesson(next)
      setSelected(item)
      setStates(Object.fromEntries(next.students.map(student => [student.id, { status: student.status, note: student.note }])))
    } catch {
      setError('تعذر فتح طلاب الفصل. اطلب من الإدارة مطابقة الصف والفصل مع بيانات الطلاب أولًا.')
    } finally { setBusy('') }
  }

  const updateStudent = (studentId: string, update: Partial<StudentState>) => {
    setStates(current => ({ ...current, [studentId]: { ...current[studentId], ...update } }))
  }

  const saveLesson = async () => {
    if (!lesson || !selected) return
    setBusy('save')
    setNotice('')
    setError('')
    try {
      const result = await api.saveTeacherLesson({
        classroomId: selected.classroomId,
        date,
        periodNumber: selected.periodNumber,
        students: lesson.students.map(student => ({ studentId: student.id, ...(states[student.id] || { status: 'present', note: '' }) })),
      })
      setNotice(`تم حفظ متابعة ${result.saved} طالبًا. يُسجّل الحاضر بلا ملاحظة كمشارك فعال.`)
    } catch { setError('تعذر حفظ المتابعة. تحقق من اتصالك ثم أعد المحاولة.') } finally { setBusy('') }
  }

  const savePassword = async () => {
    if (password.length < 8 || password !== passwordConfirm) { setError('اكتب كلمة مرور من 8 أحرف على الأقل، وتأكد من تطابقها.'); return }
    setBusy('password')
    try {
      await api.changeTeacherPassword(password)
      setPassword('')
      setPasswordConfirm('')
      setPasswordChanged(true)
      setNotice('تم حفظ كلمة المرور الجديدة.')
    } catch { setError('تعذر تغيير كلمة المرور.') } finally { setBusy('') }
  }


  const navigate = (tab: TeacherTab) => { setActiveTab(tab); setMobileNavOpen(false); setLesson(null); setSelected(null) }
  return <main className="teacher-portal" dir="rtl">
    <button type="button" className="teacher-mobile-nav-button" onClick={() => setMobileNavOpen(true)} aria-label="فتح قائمة بوابة المعلم"><Menu size={20} /></button>
    <aside className={`teacher-sidebar ${mobileNavOpen ? 'open' : ''}`}>
      <div className="teacher-sidebar-brand"><BookOpenCheck size={24} /><div><strong>بوابة المعلم</strong><small>{dashboard?.teacher.name || account.displayName}</small></div><button type="button" className="teacher-sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="إغلاق القائمة"><X size={19} /></button></div>
      <nav className="teacher-sidebar-nav" aria-label="أقسام بوابة المعلم">
        <button type="button" className={activeTab === 'home' ? 'active' : ''} onClick={() => navigate('home')}><LayoutDashboard size={18} /> الرئيسية</button>
        <button type="button" className={activeTab === 'sheets' ? 'active' : ''} onClick={() => navigate('sheets')}><FileSpreadsheet size={18} /> الكشوف</button>
        <button type="button" className={activeTab === 'reports' ? 'active' : ''} onClick={() => navigate('reports')}><BarChart3 size={18} /> التقارير</button>
        <button type="button" className={activeTab === 'password' ? 'active' : ''} onClick={() => navigate('password')}><KeyRound size={18} /> كلمة المرور</button>
      </nav>
      <button type="button" className="teacher-sidebar-logout" onClick={onLogout}><LogOut size={18} /> تسجيل الخروج</button>
    </aside>
    {mobileNavOpen && <button type="button" className="teacher-sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="إغلاق القائمة" />}
    <div className="teacher-workspace">
    <header className="teacher-topbar">
      <div><span>بوابة المعلم</span><h1>{dashboard?.schoolName || 'نظام حصر الطلاب'}</h1></div>
      <button className="outline-button teacher-topbar-logout" onClick={onLogout}><LogOut size={17} /> تسجيل الخروج</button>
    </header>
    <section className="teacher-welcome">
      <div><UserRound size={27} /><div><strong>{dashboard?.teacher.name || account.displayName}</strong><small>يعرض هذا الحساب جدولك وطلاب فصولك فقط.</small></div></div>
      <HijriDatePicker label="التاريخ الهجري" value={date} max={today()} onChange={value => { setDate(value); setLesson(null); setSelected(null) }} />
    </section>

    {activeTab === 'password' && <section className="teacher-security-card">
      <div><KeyRound size={22} /><div><h2>غيّر كلمة المرور المؤقتة</h2><p>لا يمكن استخدام بوابة المعلم قبل اختيار كلمة مرورك الخاصة.</p></div></div>
      <div className="teacher-password-form"><input type="password" placeholder="كلمة المرور الجديدة" value={password} onChange={event => setPassword(event.target.value)} /><input type="password" placeholder="تأكيد كلمة المرور" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} /><button onClick={() => void savePassword()} disabled={busy === 'password'}>حفظ كلمة المرور</button></div>
    </section>}

    {notice && <div className="teacher-notice success">{notice}</div>}
    {error && <div className="teacher-notice error">{error}</div>}

    {activeTab === 'home' && <>
    {!passwordChanged && <section className="teacher-security-card">
      <div><KeyRound size={22} /><div><h2>غيّر كلمة المرور المؤقتة</h2><p>لا يمكن استخدام بوابة المعلم قبل اختيار كلمة مرورك الخاصة.</p></div></div>
      <div className="teacher-password-form"><input type="password" placeholder="كلمة المرور الجديدة" value={password} onChange={event => setPassword(event.target.value)} /><input type="password" placeholder="تأكيد كلمة المرور" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} /><button onClick={() => void savePassword()} disabled={busy === 'password'}>حفظ كلمة المرور</button></div>
    </section>}
    <section className="teacher-card">
      <div className="teacher-section-head"><div><span>جدول اليوم</span><h2>{dayNames[dashboard?.weekday || 0]} · {formatHijriDate(date)}</h2></div><BookOpenCheck size={26} /></div>
      {busy === 'dashboard' ? <p className="teacher-empty">جارٍ تحميل الجدول…</p> : !dashboard?.schedule.length ? <p className="teacher-empty">لا توجد حصص مسندة لك في هذا اليوم.</p> : <div className="teacher-schedule-grid">
        {dashboard.schedule.map(item => <button key={item.assignmentId} className={`teacher-schedule-card ${selected?.assignmentId === item.assignmentId ? 'selected' : ''}`} onClick={() => void openLesson(item)}>
          <strong>{periodLabel(item.periodNumber)}</strong><span>{item.classroom}</span><small>{item.subject || 'بدون مادة محددة'}{item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : ''}</small>
        </button>)}
      </div>}
    </section>

    {lesson && selected && <section className="teacher-card teacher-roster-card">
      <div className="teacher-section-head"><div><span>{lesson.mapping.grade} · الفصل {lesson.mapping.classroom}</span><h2>{periodLabel(selected.periodNumber)} — {selected.classroom}</h2></div><div className="teacher-report-actions"><button className="primary-button" onClick={() => void saveLesson()} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}</button></div></div>
      <p className="teacher-help">اختيار الحالة والملاحظة هنا خاص بمتابعة المعلم، ولا يغيّر سجل الحضور والغياب الإداري.</p>
      <div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>
        {lesson.students.map(student => { const state = states[student.id] || { status: 'present' as const, note: '' as const }; return <tr key={student.id}>
          <td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>
          <td><div className="teacher-status-toggle"><button className={state.status === 'present' ? 'active present' : ''} onClick={() => updateStudent(student.id, { status: 'present' })}>حاضر</button><button className={state.status === 'absent' ? 'active absent' : ''} onClick={() => updateStudent(student.id, { status: 'absent', note: '' })}>غائب</button></div></td>
          <td><select value={state.note} disabled={state.status === 'absent'} onChange={event => updateStudent(student.id, { note: event.target.value as TeacherNote | '' })}><option value="">مشارك فعال عند الحفظ</option>{notes.map(note => <option key={note} value={note}>{note}</option>)}</select></td>
        </tr> })}
      </tbody></table></div>
      <div className="teacher-roster-save-bottom"><button className="primary-button" onClick={() => void saveLesson()} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}</button></div>
    </section>}
    </>}
    {activeTab === 'sheets' && <section className="teacher-card teacher-tab-placeholder"><FileSpreadsheet size={30} /><h2>الكشوف</h2><p>ستظهر هنا كشوف المواد المرتبطة بجدولك، مع إعداد الدرجات والتصدير.</p><button type="button" className="primary-button" onClick={() => setNotice('سيتم إعداد الكشوف من هذا القسم بعد اختيار المادة.')}>إعداد الكشوف</button></section>}
    {activeTab === 'reports' && <section className="teacher-card teacher-tab-placeholder"><BarChart3 size={30} /><h2>التقارير</h2><p>ستظهر هنا تقارير الطلاب والمواد والفصول مع خيارات الطباعة والتصدير.</p></section>}
    </div>
  </main>
}
