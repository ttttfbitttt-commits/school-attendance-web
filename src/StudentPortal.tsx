import { useEffect, useMemo, useState } from 'react'
import * as QRCode from 'qrcode'
import { BookOpenCheck, CalendarDays, Camera, FileText, Home, KeyRound, LogOut, Menu, QrCode, UserRound, X } from 'lucide-react'
import { api, type Account, type StudentPortfolioSubject, type StudentPortalDashboard } from './api'

type StudentTab = 'home' | 'portfolio' | 'schedule' | 'password'
const days = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const portfolioFileTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
const portfolioTypeFromName = (file: File) => {
  if (portfolioFileTypes.has(file.type)) return file.type
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'doc') return 'application/msword'
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (extension === 'png') return 'image/png'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'webp') return 'image/webp'
  return ''
}

export function StudentPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<StudentPortalDashboard | null>(null)
  const [activeTab, setActiveTab] = useState<StudentTab>('home')
  const [menuOpen, setMenuOpen] = useState(false)
  const [qr, setQr] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState('dashboard')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState('')

  const load = async () => {
    setBusy('dashboard'); setError('')
    try { setDashboard(await api.studentPortalDashboard()) }
    catch { setError('تعذر تحميل بيانات بوابة الطالب. أعد المحاولة بعد قليل.') }
    finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!dashboard?.student.qrValue) return
    void QRCode.toDataURL(dashboard.student.qrValue, { width: 300, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b3a68', light: '#ffffff' } }).then(setQr).catch(() => setQr(''))
  }, [dashboard?.student.qrValue])

  const switchTab = (tab: StudentTab) => {
    setMenuOpen(false)
    if (dashboard?.mustChangePassword && tab !== 'home' && tab !== 'password') {
      setActiveTab('password'); setNotice('غيّر كلمة المرور المؤقتة أولًا لفتح بقية خدمات بوابة الطالب.'); return
    }
    setNotice(''); setError(''); setActiveTab(tab)
  }
  const changePassword = async () => {
    if (password.length < 8 || password !== confirmPassword) { setError('اكتب كلمة مرور من 8 أحرف على الأقل، ثم اكتبها متطابقة في الحقل الثاني.'); return }
    setBusy('password'); setError('')
    try {
      await api.changeStudentPassword(password)
      setDashboard(current => current ? { ...current, mustChangePassword: false } : current)
      setPassword(''); setConfirmPassword(''); setNotice('تم حفظ كلمة المرور الجديدة. يمكنك الآن استخدام جميع الخدمات.')
      setActiveTab('home')
    } catch { setError('تعذر تغيير كلمة المرور.') } finally { setBusy('') }
  }
  const upload = async (subject: StudentPortfolioSubject, slotNumber: number, file?: File) => {
    if (!file) return
    const fileType = portfolioTypeFromName(file)
    if (!fileType || file.size > 4_000_000) { setError('اختر صورة PNG أو JPG أو WEBP، أو ملف PDF أو Word، بحجم لا يتجاوز 4 ميجابايت.'); return }
    setUploading(`${subject.assignmentId}:${slotNumber}`); setError(''); setNotice('')
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const fileData = String(reader.result || '').replace(/^data:[^;]+;/, `data:${fileType};`)
        const result = await api.uploadStudentPortfolioFile(subject.assignmentId, slotNumber, fileData, file.name)
        setDashboard(current => current ? { ...current, subjects: current.subjects.map(item => item.assignmentId !== subject.assignmentId ? item : { ...item, slots: item.slots.map(slot => slot.slotNumber === slotNumber ? result.file : slot) }) } : current)
        setNotice(`تم حفظ ملف المربع ${slotNumber} في مادة ${subject.subject}.`)
      } catch { setError('تعذر رفع الملف. تأكد من اتصالك ثم حاول مرة أخرى.') } finally { setUploading('') }
    }
    reader.onerror = () => { setError('تعذر قراءة الملف.'); setUploading('') }
    reader.readAsDataURL(file)
  }
  const remove = async (subject: StudentPortfolioSubject, slotNumber: number) => {
    setUploading(`${subject.assignmentId}:${slotNumber}`); setError('')
    try {
      await api.deleteStudentPortfolioImage(subject.assignmentId, slotNumber)
      setDashboard(current => current ? { ...current, subjects: current.subjects.map(item => item.assignmentId !== subject.assignmentId ? item : { ...item, slots: item.slots.map(slot => slot.slotNumber === slotNumber ? { ...slot, fileUrl: '', fileName: '', fileType: '', uploadedAt: null } : slot) }) } : current)
      setNotice('تمت إزالة الملف من مربع الإنجاز.')
    } catch { setError('تعذر إزالة الملف.') } finally { setUploading('') }
  }
  const schedule = useMemo(() => {
    const groups = new Map<number, StudentPortalDashboard['schedule']>()
    for (const item of dashboard?.schedule || []) groups.set(item.weekday, [...(groups.get(item.weekday) || []), item])
    return [...groups.entries()].sort((a, b) => a[0] - b[0])
  }, [dashboard])

  return <main className="student-portal" dir="rtl">
    <button type="button" className="student-mobile-menu" onClick={() => setMenuOpen(true)} aria-label="فتح قائمة بوابة الطالب"><Menu size={20} /></button>
    <aside className={`student-sidebar ${menuOpen ? 'open' : ''}`}><div className="student-brand"><BookOpenCheck size={25} /><div><strong>بوابة الطالب</strong><small>{dashboard?.student.name || account.displayName}</small></div><button type="button" onClick={() => setMenuOpen(false)}><X size={19} /></button></div>
      <nav><button type="button" className={activeTab === 'home' ? 'active' : ''} onClick={() => switchTab('home')}><Home size={18} /> الرئيسية</button><button type="button" className={activeTab === 'portfolio' ? 'active' : ''} onClick={() => switchTab('portfolio')}><BookOpenCheck size={18} /> ملف إنجازي</button><button type="button" className={activeTab === 'schedule' ? 'active' : ''} onClick={() => switchTab('schedule')}><CalendarDays size={18} /> جدولي</button><button type="button" className={activeTab === 'password' ? 'active' : ''} onClick={() => switchTab('password')}><KeyRound size={18} /> كلمة المرور</button></nav><button type="button" className="student-logout" onClick={onLogout}><LogOut size={18} /> تسجيل الخروج</button>
    </aside>
    {menuOpen && <button type="button" className="student-sidebar-backdrop" onClick={() => setMenuOpen(false)} aria-label="إغلاق القائمة" />}
    <div className="student-workspace"><header className="student-topbar"><div><span>بوابة الطالب</span><h1>{dashboard?.schoolName || 'نظام الحصر'}</h1></div><button type="button" className="outline-button" onClick={() => void load()} disabled={busy !== ''}>تحديث البيانات</button></header>
      {dashboard?.mustChangePassword && <section className="student-password-required"><KeyRound size={22} /><div><strong>كلمة المرور المؤقتة تحتاج إلى تغيير</strong><span>غيّرها من تبويب كلمة المرور قبل رفع صور ملف الإنجاز أو فتح الجدول.</span></div><button type="button" onClick={() => switchTab('password')}>تغييرها الآن</button></section>}
      {notice && <p className="student-portal-notice success">{notice}</p>}{error && <p className="student-portal-notice error">{error}</p>}
      {busy === 'dashboard' ? <p className="teacher-empty">جارٍ تحميل بياناتك…</p> : <>
        {activeTab === 'home' && dashboard && <section className="student-home-grid"><article className="student-profile-card"><div className="student-profile-icon"><UserRound size={25} /></div><span>بيانات الطالب</span><h2>{dashboard.student.name}</h2><p>{dashboard.student.grade} · الفصل {dashboard.student.classroom}</p><dl><div><dt>رقم الهوية</dt><dd dir="ltr">{dashboard.student.identityNumber}</dd></div>{dashboard.student.phone && <div><dt>رقم الجوال</dt><dd dir="ltr">{dashboard.student.phone}</dd></div>}</dl></article><article className="student-qr-card"><div><QrCode size={24} /><span>باركود الطالب</span><h2>بطاقة التحضير</h2><p>اعرض هذا الرمز عند الحاجة إلى التحقق من حضورك.</p></div>{qr ? <img src={qr} alt="باركود الطالب" /> : <div className="student-qr-placeholder">جارٍ إنشاء الباركود…</div>}</article></section>}
        {activeTab === 'password' && <section className="student-password-card"><div><KeyRound size={23} /><div><span>حماية الحساب</span><h2>تغيير كلمة المرور</h2><p>استخدم كلمة مرور لا تقل عن 8 أحرف ولا تشاركها مع أي شخص.</p></div></div><label>كلمة المرور الجديدة<input type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label><label>تأكيد كلمة المرور<input type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} /></label><button type="button" className="primary-button" onClick={() => void changePassword()} disabled={busy === 'password'}>{busy === 'password' ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}</button></section>}
        {activeTab === 'portfolio' && dashboard && (
          <section className="student-portfolio-page">
            <header><BookOpenCheck size={28} /><div><span>ملف إنجازي</span><h2>موادي الدراسية</h2><p>لكل مادة 10 مربعات؛ يرفع الطالب في كل مربع صورة أو ملف PDF أو Word.</p></div></header>
            {!dashboard.subjects.length ? <p className="teacher-empty">لا توجد مواد مرتبطة بفصلك حتى الآن.</p> : (
              <div className="student-subject-grid">
                {dashboard.subjects.map(subject => (
                  <article key={subject.assignmentId}>
                    <header><div><strong>{subject.subject}</strong><span>المعلم: {subject.teacherName}</span></div><small>{subject.grade} · {subject.classroom}</small></header>
                    <div className="student-upload-slots">
                      {subject.slots.map(slot => (
                        <div className={`student-upload-slot ${slot.fileUrl ? 'filled' : ''}`} key={slot.slotNumber}>
                          {slot.fileUrl ? <>
                            {slot.fileType.startsWith('image/') ? <img src={slot.fileUrl} alt={`${subject.subject} المهمة ${slot.slotNumber}`} /> : <a className="student-upload-file-link" href={slot.fileUrl} target="_blank" rel="noreferrer"><FileText size={26} /><span>{slot.fileName || 'فتح الملف'}</span></a>}
                            <button type="button" onClick={() => void remove(subject, slot.slotNumber)} disabled={uploading !== ''}>حذف</button>
                          </> : (
                            <label><Camera size={22} /><strong>المربع {slot.slotNumber}</strong><span>{uploading === `${subject.assignmentId}:${slot.slotNumber}` ? 'جارٍ الرفع…' : 'رفع ملف'}</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.doc,.docx" onChange={event => void upload(subject, slot.slotNumber, event.target.files?.[0])} disabled={uploading !== ''} /></label>
                          )}
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        {activeTab === 'schedule' && (
          <section className="student-schedule-page">
            <header><CalendarDays size={28} /><div><span>جدولي الدراسي</span><h2>الحصص الأسبوعية</h2></div></header>
            {!schedule.length ? <p className="teacher-empty">لم يُربط جدول دراسي بفصلك بعد.</p> : (
              <div className="student-schedule-days">
                {schedule.map(([weekday, items]) => (
                  <article key={weekday}><h3>{days[weekday] || 'اليوم'}</h3>{items.sort((a, b) => a.periodNumber - b.periodNumber).map(item => (
                    <div key={item.assignmentId}><b>الحصة {item.periodNumber}</b><strong>{item.subject}</strong><span>{item.teacherName}</span>{item.startTime && <small dir="ltr">{item.startTime} – {item.endTime}</small>}</div>
                  ))}</article>
                ))}
              </div>
            )}
          </section>
        )}      </>}
    </div>
  </main>
}
