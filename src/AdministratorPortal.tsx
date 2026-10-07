import { useEffect, useMemo, useRef, useState } from 'react'
import * as jsQRNs from 'jsqr'
import { Camera, CheckCircle2, FileDown, KeyRound, LogOut, MoreVertical, Printer, Search, Square, UsersRound, XCircle } from 'lucide-react'
import { api, type Account, type AdministratorAttendanceRecord, type AdministratorAttendanceStudent } from './api'
import { downloadWorkbook, openPrintDocument } from './SchoolFeatures'
import { formatHijriDate } from './dateUtils'

const jsQR = ((jsQRNs as unknown as { default?: unknown }).default || jsQRNs) as (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: 'attemptBoth' }) => { data: string } | null
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character))
type View = 'attendance' | 'reports' | 'password'

function reportHtml(records: AdministratorAttendanceRecord[], date: string, administrator: string) {
  return `<section class="page"><h1>سجل حضور الطلاب</h1><p class="meta">التاريخ: ${escapeHtml(formatHijriDate(date))} · مُعد السجل: ${escapeHtml(administrator)}</p><table><thead><tr><th>الطالب</th><th>الصف والفصل</th><th>الحالة</th><th>وقت التسجيل</th><th>المسجل</th></tr></thead><tbody>${records.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(`${row.grade} ${row.classroom}`)}</td><td>${row.status === 'late' ? 'متأخر' : 'حاضر'}</td><td dir="ltr">${escapeHtml(row.time)}</td><td>${escapeHtml(row.recordedBy || '—')}</td></tr>`).join('') || '<tr><td colspan="5">لا توجد سجلات لهذا التاريخ.</td></tr>'}</tbody></table><p class="meta">التوقيع: ....................................</p></section>`
}

export function AdministratorPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [view, setView] = useState<View>('attendance')
  const [menuOpen, setMenuOpen] = useState(false)
  const [schoolName, setSchoolName] = useState('')
  const [students, setStudents] = useState<AdministratorAttendanceStudent[]>([])
  const [records, setRecords] = useState<AdministratorAttendanceRecord[]>([])
  const [mode, setMode] = useState<'present' | 'late'>('present')
  const [query, setQuery] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [notice, setNotice] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const [camera, setCamera] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reportDate, setReportDate] = useState(today())
  const [reportRecords, setReportRecords] = useState<AdministratorAttendanceRecord[]>([])
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef(0)
  const lastCode = useRef({ value: '', at: 0 })
  const scanning = useRef(false)

  const stopCamera = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamera(false)
  }
  const loadAttendance = async () => {
    try { const result = await api.administratorAttendance(); setSchoolName(result.schoolName); setStudents(result.students); setRecords(result.records) }
    catch { setNotice({ type: 'error', text: 'تعذر تحميل سجل الحضور. تحقق من الاتصال ثم حدّث الصفحة.' }) }
  }
  useEffect(() => { void loadAttendance(); return () => stopCamera() }, [])
  useEffect(() => { if (view !== 'attendance') stopCamera() }, [view])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 3800); return () => window.clearTimeout(timer) }, [notice])

  const recordStudent = async (raw: string) => {
    const code = raw.trim(); if (!code || scanning.current) return
    const student = students.find(item => item.id === code || item.phone === code)
    if (!student) { setNotice({ type: 'error', text: 'لم يتم التعرف على باركود الطالب في هذه المدرسة.' }); return }
    scanning.current = true; setBusy(true)
    try {
      const result = await api.recordAdministratorAttendance(student.id, mode)
      if (result.duplicate) setNotice({ type: 'warning', text: `${student.name}: الطالب تم تحضيره مسبقًا في سجل المدرسة.` })
      else {
        const record: AdministratorAttendanceRecord = { studentId: student.id, name: student.name, grade: student.grade, classroom: student.classroom, phone: student.phone, date: result.date, time: result.time, status: mode, recordedBy: account.displayName }
        setRecords(current => [record, ...current.filter(item => item.studentId !== student.id)])
        setNotice({ type: 'success', text: `تم تسجيل ${student.name} ${mode === 'late' ? 'متأخرًا' : 'حاضرًا'} في سجل المدرسة.` })
      }
      setManualCode('')
    } catch { setNotice({ type: 'error', text: 'تعذر حفظ الحضور الآن. أعد المحاولة.' }) }
    finally { setBusy(false); window.setTimeout(() => { scanning.current = false }, 400) }
  }
  const scanFrame = () => {
    const video = videoRef.current; const canvas = canvasRef.current
    if (!streamRef.current || !video || !canvas) return
    if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth) {
      const ratio = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight)); canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context) { context.drawImage(video, 0, 0, canvas.width, canvas.height); const image = context.getImageData(0, 0, canvas.width, canvas.height); const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' }); if (code?.data) { const now = Date.now(); if (lastCode.current.value !== code.data || now - lastCode.current.at > 1800) { lastCode.current = { value: code.data, at: now }; void recordStudent(code.data) } } }
    }
    frameRef.current = requestAnimationFrame(scanFrame)
  }
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setNotice({ type: 'error', text: 'هذا المتصفح لا يدعم تشغيل الكاميرا. استخدم Safari أو Chrome محدثًا.' }); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      streamRef.current = stream; setCamera(true)
      window.setTimeout(async () => { if (!videoRef.current || !streamRef.current) return; videoRef.current.srcObject = streamRef.current; videoRef.current.playsInline = true; try { await videoRef.current.play() } catch { /* video is still available after an interaction */ }; frameRef.current = requestAnimationFrame(scanFrame) }, 40)
    } catch { setNotice({ type: 'error', text: 'تعذر فتح الكاميرا. اسمح للمتصفح باستخدامها ثم حاول مرة أخرى.' }) }
  }
  const filteredStudents = useMemo(() => students.filter(student => !query.trim() || `${student.name} ${student.id} ${student.grade} ${student.classroom}`.includes(query.trim())).slice(0, 35), [students, query])
  const present = records.filter(record => record.status === 'present').length; const late = records.filter(record => record.status === 'late').length
  const loadReport = async () => { setBusy(true); try { const result = await api.administratorReport(reportDate); setReportRecords(result.records) } catch { setNotice({ type: 'error', text: 'تعذر تحميل التقرير.' }) } finally { setBusy(false) } }
  useEffect(() => { if (view === 'reports') void loadReport() }, [view])
  const exportReport = () => downloadWorkbook('سجل حضور الطلاب', [['الطالب', 'الصف', 'الفصل', 'الحالة', 'الوقت', 'المسجل'], ...reportRecords.map(row => [row.name, row.grade, row.classroom, row.status === 'late' ? 'متأخر' : 'حاضر', row.time, row.recordedBy || ''])], 'سجل الحضور', schoolName, `سجل حضور الطلاب ${formatHijriDate(reportDate)}`)
  const changePassword = async () => {
    if (newPassword.length < 8) { setNotice({ type: 'error', text: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.' }); return }
    if (newPassword !== confirmPassword) { setNotice({ type: 'error', text: 'تأكيد كلمة المرور غير مطابق.' }); return }
    setBusy(true); try { await api.changeAdministratorPassword(currentPassword, newPassword); setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); setNotice({ type: 'success', text: 'تم تغيير كلمة المرور بنجاح.' }) } catch { setNotice({ type: 'error', text: 'تعذر تغيير كلمة المرور. تحقق من كلمة المرور الحالية.' }) } finally { setBusy(false) }
  }
  const chooseView = (next: View) => { setView(next); setMenuOpen(false) }

  return <main className="administrator-portal" dir="rtl"><header className="administrator-topbar"><div><span>{schoolName || 'بوابة الإداري'}</span><h1>مرحبًا، {account.displayName}</h1></div><div className="administrator-menu-wrap"><button className="administrator-menu" onClick={() => setMenuOpen(current => !current)} aria-label="القائمة"><MoreVertical size={24} /></button>{menuOpen && <nav><button onClick={() => chooseView('attendance')}>سجل الحضور</button><button onClick={() => chooseView('reports')}>التقارير</button><button onClick={() => chooseView('password')}>تغيير كلمة المرور</button><button className="logout" onClick={onLogout}><LogOut size={16} /> تسجيل الخروج</button></nav>}</div></header>
    {notice && <p className={`administrator-notice ${notice.type}`}>{notice.type === 'error' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}{notice.text}</p>}
    {view === 'attendance' && <section className="administrator-attendance"><header><div><span>سجل اليوم · {formatHijriDate(today())}</span><h2>تحضير الطلاب وحصر التأخر</h2><p>كل عملية تُسجل مباشرة في حساب المدرسة. لا توجد صلاحية حذف من هذا الحساب.</p></div><UsersRound size={31} /></header><div className="administrator-stats"><article><b>{records.length}</b><span>إجمالي المسجلين</span></article><article><b>{present}</b><span>حاضر</span></article><article><b>{late}</b><span>متأخر</span></article></div><div className="administrator-mode"><button className={mode === 'present' ? 'active' : ''} onClick={() => setMode('present')}>تحضير الطلاب</button><button className={mode === 'late' ? 'late active' : 'late'} onClick={() => setMode('late')}>حصر التأخر</button></div><section className="administrator-camera"><div className="administrator-camera-head"><div><Camera size={20} /><strong>{mode === 'late' ? 'رصد المتأخرين' : 'تحضير الطلاب'}</strong></div>{camera ? <button className="outline-button" onClick={stopCamera}><Square size={15} fill="currentColor" /> إيقاف الكاميرا</button> : <button className="primary-button" onClick={() => void startCamera()}><Camera size={16} /> فتح الكاميرا</button>}</div>{camera && <div className="administrator-video"><video ref={videoRef} autoPlay muted playsInline /><canvas ref={canvasRef} hidden /><span>وجّه الكاميرا نحو باركود الطالب</span></div>}<form className="administrator-manual" onSubmit={event => { event.preventDefault(); void recordStudent(manualCode) }}><input value={manualCode} onChange={event => setManualCode(event.target.value)} inputMode="numeric" placeholder="أدخل رقم الطالب أو امسح الباركود بالكاميرا" /><button className="primary-button" disabled={!manualCode.trim() || busy}><Search size={17} /> تسجيل</button></form></section><section className="administrator-manual-list"><div><label><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="الحصر اليدوي: ابحث باسم الطالب أو رقمه" /></label></div>{query && <div className="administrator-student-list">{filteredStudents.map(student => <button key={student.id} onClick={() => void recordStudent(student.id)} disabled={busy}><span><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></span><b>{mode === 'late' ? 'تسجيل متأخر' : 'تسجيل حاضر'}</b></button>)}</div>}</section><section className="administrator-recent"><h3>آخر العمليات</h3>{records.slice(0, 12).map(record => <article key={`${record.studentId}-${record.date}`}><CheckCircle2 size={18} /><span><strong>{record.name}</strong><small>{record.grade} · {record.classroom}</small></span><b className={record.status}>{record.status === 'late' ? 'متأخر' : 'حاضر'}</b><time>{record.time}</time></article>)}{!records.length && <p>لا توجد عمليات تسجيل حتى الآن.</p>}</section></section>}
    {view === 'reports' && <section className="administrator-report"><header><div><span>التقارير</span><h2>سجل الحضور اليومي</h2></div><FileDown size={29} /></header><div className="administrator-report-actions"><label>التاريخ<input type="date" value={reportDate} onChange={event => setReportDate(event.target.value)} /></label><button className="primary-button" onClick={() => void loadReport()} disabled={busy}>عرض التقرير</button></div><div className="teacher-report-actions"><button className="primary-button" onClick={exportReport} disabled={!reportRecords.length}><FileDown size={16} /> Excel</button><button className="outline-button" onClick={() => openPrintDocument('سجل حضور الطلاب', reportHtml(reportRecords, reportDate, account.displayName), schoolName)}><Printer size={16} /> PDF / طباعة</button></div><div className="administrator-report-table"><table><thead><tr><th>الطالب</th><th>الصف والفصل</th><th>الحالة</th><th>الوقت</th><th>المسجل</th></tr></thead><tbody>{reportRecords.map(row => <tr key={row.studentId}><td>{row.name}</td><td>{row.grade} · {row.classroom}</td><td>{row.status === 'late' ? 'متأخر' : 'حاضر'}</td><td dir="ltr">{row.time}</td><td>{row.recordedBy || '—'}</td></tr>)}</tbody></table>{!reportRecords.length && <p>لا توجد سجلات في التاريخ المحدد.</p>}</div></section>}
    {view === 'password' && <section className="administrator-password"><header><KeyRound size={28} /><div><span>الحساب الإداري</span><h2>تغيير كلمة المرور</h2><p>استخدم كلمة مرور جديدة لا تقل عن 8 أحرف.</p></div></header><div><label>كلمة المرور الحالية<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label><label>كلمة المرور الجديدة<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} /></label><label>تأكيد كلمة المرور<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={8} /></label><button className="primary-button" onClick={() => void changePassword()} disabled={busy}><KeyRound size={17} /> حفظ كلمة المرور</button></div></section>}
  </main>
}
