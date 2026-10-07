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
const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const comparable = (value: unknown) => normalize(value).toLocaleLowerCase('ar')
const normalizedStudentId = (value: unknown) => normalize(value).replace(/^([+-]?\d+)\.0+$/, '$1')
function barcodeCandidates(raw: string) {
  const code = normalize(raw)
  if (!code) return []
  const candidates = [code]
  const legacyPath = code.replace(/\\/g, '/').match(/(?:^|\/)student_barcodes\/([^/]+)\.png$/i)
  if (legacyPath?.[1]) candidates.push(legacyPath[1])
  return [...new Set(candidates)]
}

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
  const [scanResult, setScanResult] = useState<{ type: 'success' | 'duplicate'; text: string } | null>(null)
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
  const scanResultTimer = useRef<number | undefined>(undefined)
  const audioContextRef = useRef<AudioContext | null>(null)

  const showScanResult = (result: { type: 'success' | 'duplicate'; text: string }) => {
    if (scanResultTimer.current) window.clearTimeout(scanResultTimer.current)
    setScanResult(result)
    scanResultTimer.current = window.setTimeout(() => setScanResult(null), 2600)
  }

  const prepareScanSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextClass) return null
      const context = audioContextRef.current || new AudioContextClass()
      audioContextRef.current = context
      if (context.state === 'suspended') void context.resume()
      return context
    } catch { return null }
  }
  const playScanSound = (type: 'success' | 'duplicate') => {
    const context = prepareScanSound()
    if (!context) return
    const play = () => {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = type === 'success' ? 880 : 440
      gain.gain.setValueAtTime(0.0001, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.14, context.currentTime + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (type === 'success' ? 0.17 : 0.24))
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(); oscillator.stop(context.currentTime + (type === 'success' ? 0.18 : 0.25))
    }
    if (context.state === 'suspended') void context.resume().then(play).catch(() => undefined)
    else play()
  }

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
  useEffect(() => {
    void loadAttendance()
    return () => {
      stopCamera()
      if (scanResultTimer.current) window.clearTimeout(scanResultTimer.current)
    }
  }, [])
  useEffect(() => { if (view !== 'attendance') stopCamera() }, [view])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(null), 3800); return () => window.clearTimeout(timer) }, [notice])

  const findStudent = (raw: string) => {
    const code = normalize(raw)
    const candidates = barcodeCandidates(code)
    const direct = students.find(item => item.id === code || item.phone === code || comparable(item.name) === comparable(code))
    return direct || students.find(item => candidates.some(candidate => item.id === candidate || comparable(item.id) === comparable(candidate) || normalizedStudentId(item.id) === normalizedStudentId(candidate)))
  }
  const recordStudent = async (raw: string, source: 'camera' | 'manual' = 'camera') => {
    const code = normalize(raw); if (!code || scanning.current) return
    const student = findStudent(code)
    if (!student) {
      if (source === 'manual') {
        setQuery(code)
        setNotice({ type: 'warning', text: 'اختر الطالب من نتائج البحث الظاهرة أدناه لتسجيل حضوره.' })
      } else setNotice({ type: 'error', text: 'تعذّر مطابقة الباركود مع طالب في هذه المدرسة.' })
      return
    }
    scanning.current = true; setBusy(true)
    try {
      const result = await api.recordAdministratorAttendance(student.id, mode)
      if (result.duplicate) {
        if (source === 'camera') { showScanResult({ type: 'duplicate', text: 'الطالب تم تحضيره مسبقًا' }); playScanSound('duplicate') }
        else setNotice({ type: 'warning', text: `${student.name}: الطالب تم تحضيره مسبقًا في سجل المدرسة.` })
      }
      else {
        const record: AdministratorAttendanceRecord = { studentId: student.id, name: student.name, grade: student.grade, classroom: student.classroom, phone: student.phone, date: result.date, time: result.time, status: mode, recordedBy: account.displayName }
        setRecords(current => [record, ...current.filter(item => item.studentId !== student.id)])
        if (source === 'camera') { showScanResult({ type: 'success', text: student.name }); playScanSound('success') }
        else setNotice({ type: 'success', text: `تم تسجيل ${student.name} ${mode === 'late' ? 'متأخرًا' : 'حاضرًا'} في سجل المدرسة.` })
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
    prepareScanSound()
    if (!navigator.mediaDevices?.getUserMedia) { setNotice({ type: 'error', text: 'هذا المتصفح لا يدعم تشغيل الكاميرا. استخدم Safari أو Chrome محدثًا.' }); return }
    try {
      const options: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 }, frameRate: { ideal: 24, max: 30 } }, audio: false },
        { video: { facingMode: { ideal: 'user' }, width: { ideal: 1280, min: 640 }, height: { ideal: 720, min: 480 } }, audio: false },
        { video: true, audio: false },
      ]
      let stream: MediaStream | null = null
      for (const constraints of options) {
        try { stream = await navigator.mediaDevices.getUserMedia(constraints); if (stream.getVideoTracks().length) break } catch { /* try the next supported camera setup */ }
      }
      if (!stream) throw new Error('camera_unavailable')
      streamRef.current = stream; setCamera(true)
      window.setTimeout(async () => {
        if (!videoRef.current || !streamRef.current) return
        videoRef.current.srcObject = streamRef.current; videoRef.current.playsInline = true; videoRef.current.muted = true
        try { await videoRef.current.play() } catch { /* iPhone may defer playback after permission */ }
        frameRef.current = requestAnimationFrame(scanFrame)
      }, 80)
    } catch { setNotice({ type: 'error', text: 'تعذر فتح الكاميرا. اسمح للمتصفح باستخدامها ثم حاول مرة أخرى.' }) }
  }
  const filteredStudents = useMemo(() => {
    const wanted = comparable(query)
    return students.filter(student => !wanted || comparable(`${student.name} ${student.id} ${student.phone} ${student.grade} ${student.classroom}`).includes(wanted)).slice(0, 35)
  }, [students, query])
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
    {view === 'attendance' && <section className="administrator-attendance"><header><div><span>سجل اليوم · {formatHijriDate(today())}</span><h2>تحضير الطلاب وحصر التأخر</h2><p>كل عملية تُسجل مباشرة في حساب المدرسة. لا توجد صلاحية حذف من هذا الحساب.</p></div><UsersRound size={31} /></header><div className="administrator-stats"><article><b>{records.length}</b><span>إجمالي المسجلين</span></article><article><b>{present}</b><span>حاضر</span></article><article><b>{late}</b><span>متأخر</span></article></div><div className="administrator-mode"><button className={mode === 'present' ? 'active' : ''} onClick={() => setMode('present')}>تحضير الطلاب</button><button className={mode === 'late' ? 'late active' : 'late'} onClick={() => setMode('late')}>حصر التأخر</button></div><section className="administrator-camera"><div className="administrator-camera-head"><div><Camera size={20} /><strong>{mode === 'late' ? 'رصد المتأخرين' : 'تحضير الطلاب'}</strong></div>{camera ? <button className="outline-button" onClick={stopCamera}><Square size={15} fill="currentColor" /> إيقاف الكاميرا</button> : <button className="primary-button" onClick={() => void startCamera()}><Camera size={16} /> فتح الكاميرا</button>}</div>{camera && <div className="administrator-video"><video ref={videoRef} autoPlay muted playsInline /><canvas ref={canvasRef} hidden />{scanResult && <div className={`administrator-scan-result ${scanResult.type}`} role="status" aria-live="assertive">{scanResult.text}</div>}<span>وجّه الكاميرا نحو باركود الطالب</span></div>}<form className="administrator-manual" onSubmit={event => { event.preventDefault(); void recordStudent(manualCode, 'manual') }}><input value={manualCode} onChange={event => setManualCode(event.target.value)} placeholder="أدخل اسم الطالب أو رقمه أو امسح الباركود بالكاميرا" /><button className="primary-button" disabled={!manualCode.trim() || busy}><Search size={17} /> بحث وتسجيل</button></form></section><section className="administrator-manual-list"><div><label><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="الحصر اليدوي: ابحث باسم الطالب أو رقمه" /></label></div>{query && <div className="administrator-student-list">{filteredStudents.map(student => <button key={student.id} onClick={() => void recordStudent(student.id, 'manual')} disabled={busy}><span><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></span><b>{mode === 'late' ? 'تسجيل متأخر' : 'تسجيل حاضر'}</b></button>)}</div>}</section><section className="administrator-recent"><h3>آخر العمليات</h3>{records.slice(0, 12).map(record => <article key={`${record.studentId}-${record.date}`}><CheckCircle2 size={18} /><span><strong>{record.name}</strong><small>{record.grade} · {record.classroom}</small></span><b className={record.status}>{record.status === 'late' ? 'متأخر' : 'حاضر'}</b><time>{record.time}</time></article>)}{!records.length && <p>لا توجد عمليات تسجيل حتى الآن.</p>}</section></section>}
    {view === 'reports' && <section className="administrator-report"><header><div><span>التقارير</span><h2>سجل الحضور اليومي</h2></div><FileDown size={29} /></header><div className="administrator-report-actions"><label>التاريخ<input type="date" value={reportDate} onChange={event => setReportDate(event.target.value)} /></label><button className="primary-button" onClick={() => void loadReport()} disabled={busy}>عرض التقرير</button></div><div className="teacher-report-actions"><button className="primary-button" onClick={exportReport} disabled={!reportRecords.length}><FileDown size={16} /> Excel</button><button className="outline-button" onClick={() => openPrintDocument('سجل حضور الطلاب', reportHtml(reportRecords, reportDate, account.displayName), schoolName)}><Printer size={16} /> PDF / طباعة</button></div><div className="administrator-report-table"><table><thead><tr><th>الطالب</th><th>الصف والفصل</th><th>الحالة</th><th>الوقت</th><th>المسجل</th></tr></thead><tbody>{reportRecords.map(row => <tr key={row.studentId}><td>{row.name}</td><td>{row.grade} · {row.classroom}</td><td>{row.status === 'late' ? 'متأخر' : 'حاضر'}</td><td dir="ltr">{row.time}</td><td>{row.recordedBy || '—'}</td></tr>)}</tbody></table>{!reportRecords.length && <p>لا توجد سجلات في التاريخ المحدد.</p>}</div></section>}
    {view === 'password' && <section className="administrator-password"><header><KeyRound size={28} /><div><span>الحساب الإداري</span><h2>تغيير كلمة المرور</h2><p>استخدم كلمة مرور جديدة لا تقل عن 8 أحرف.</p></div></header><div><label>كلمة المرور الحالية<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label><label>كلمة المرور الجديدة<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} minLength={8} /></label><label>تأكيد كلمة المرور<input type="password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} minLength={8} /></label><button className="primary-button" onClick={() => void changePassword()} disabled={busy}><KeyRound size={17} /> حفظ كلمة المرور</button></div></section>}
  </main>
}
