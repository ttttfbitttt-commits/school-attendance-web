import { useEffect, useMemo, useRef, useState } from 'react'
import * as jsQRNs from 'jsqr'
import { Camera, CheckCircle2, Download, Flashlight, Handshake, Maximize2, Minimize2, Printer, RefreshCw, Search, Square, Users, XCircle } from 'lucide-react'
import { api, type TeacherCooperationEntry, type TeacherCooperationScan, type TeacherCooperationStatus, type TeacherCooperationStudent } from './api'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate } from './dateUtils'
import { downloadWorkbook, openPrintDocument } from './SchoolFeatures'

const jsQR = ((jsQRNs as unknown as { default?: unknown }).default || jsQRNs) as (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: 'attemptBoth' }) => { data: string } | null
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const periodLabel = (period: number) => period === 1 ? 'الحصة الأولى' : 'الحصة الثانية'
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
const SCAN_INTERVAL_MS = 150
const SCAN_MAX_DIMENSION = 360
const SCAN_PAUSE_AFTER_READ_MS = 450

type ScanFeedback = {
  kind: 'created' | 'duplicate' | 'error'
  title: string
  message: string
  student?: { name: string; grade: string; classroom: string }
}

function playFeedback(kind: ScanFeedback['kind']) {
  try {
    const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioContextCtor) return
    const context = new AudioContextCtor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = kind === 'error' ? 'sawtooth' : kind === 'duplicate' ? 'triangle' : 'sine'
    oscillator.frequency.setValueAtTime(kind === 'error' ? 230 : kind === 'duplicate' ? 520 : 880, context.currentTime)
    if (kind === 'created') oscillator.frequency.exponentialRampToValueAtTime(1174, context.currentTime + .12)
    gain.gain.setValueAtTime(.16, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .2)
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .2)
  } catch { /* الصوت اختياري */ }
}

export function TeacherCooperationPanel({ status, onRefresh }: { status: TeacherCooperationStatus; onRefresh: () => Promise<void> }) {
  const [cameraActive, setCameraActive] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [fullScreen, setFullScreen] = useState(false)
  const [manualQuery, setManualQuery] = useState('')
  const [manualCandidates, setManualCandidates] = useState<TeacherCooperationStudent[]>([])
  const [manualSelection, setManualSelection] = useState<TeacherCooperationStudent[]>([])
  const [manualSearching, setManualSearching] = useState(false)
  const [recent, setRecent] = useState<TeacherCooperationScan[]>(status.recent)
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null)
  const [notice, setNotice] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef(0)
  const scanTimerRef = useRef<number | null>(null)
  const scanPauseUntilRef = useRef(0)
  const scanBusyRef = useRef(false)
  const lastCodeRef = useRef({ code: '', at: 0 })
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const manualSearchRef = useRef<HTMLInputElement>(null)
  const manualSearchRequestRef = useRef(0)

  useEffect(() => setRecent(status.recent), [status.recent])
  useEffect(() => {
    const query = manualQuery.trim()
    if (!query) { manualSearchRequestRef.current += 1; setManualCandidates([]); setManualSearching(false); return }
    const request = ++manualSearchRequestRef.current
    const timer = window.setTimeout(() => {
      setManualSearching(true)
      void api.searchTeacherCooperationStudents(query)
        .then(result => { if (manualSearchRequestRef.current === request) setManualCandidates(result.students) })
        .catch(() => { if (manualSearchRequestRef.current === request) setManualCandidates([]) })
        .finally(() => { if (manualSearchRequestRef.current === request) setManualSearching(false) })
    }, 160)
    return () => window.clearTimeout(timer)
  }, [manualQuery])
  useEffect(() => {
    const handler = () => setFullScreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const stopCamera = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
    scanTimerRef.current = null
    scanPauseUntilRef.current = 0
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false); setTorchOn(false)
  }
  useEffect(() => () => { stopCamera(); if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current) }, [])
  useEffect(() => { if (!status.available) stopCamera() }, [status.available])
  useEffect(() => {
    const stopWhenHidden = () => { if (document.hidden) stopCamera() }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => document.removeEventListener('visibilitychange', stopWhenHidden)
  }, [])

  const showFeedback = (next: ScanFeedback) => {
    setFeedback(next)
    playFeedback(next.kind)
    if (navigator.vibrate) navigator.vibrate(next.kind === 'error' ? [80, 50, 80] : 70)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), next.kind === 'duplicate' ? 3000 : 2200)
  }

  const processCode = async (rawCode: string, source: 'camera' | 'manual' = 'camera') => {
    const code = rawCode.trim()
    if (!code || scanBusyRef.current) return
    const now = Date.now()
    if (source === 'camera' && lastCodeRef.current.code === code && now - lastCodeRef.current.at < 1800) return
    lastCodeRef.current = { code, at: now }
    scanBusyRef.current = true
    let completed = false
    try {
      const result = await api.scanTeacherCooperation(code)
      completed = true
      const student = { name: result.student.name, grade: result.student.grade, classroom: result.student.classroom }
      if (result.outcome === 'duplicate') {
        showFeedback({ kind: 'duplicate', title: 'الطالب تم تحضيره مسبقًا', message: 'الطالب مسجل بالفعل في سجل حضور المدرسة.', student })
      } else {
        const entry: TeacherCooperationScan = { id: `${result.student.id}-${Date.now()}`, studentId: result.student.id, studentName: result.student.name, grade: result.student.grade, classroom: result.student.classroom, periodNumber: result.periodNumber, status: result.attendance.status, time: result.attendance.time }
        setRecent(current => [entry, ...current.filter(item => item.studentId !== entry.studentId)])
        showFeedback({ kind: 'created', title: 'تم تسجيل الحضور بنجاح', message: `${periodLabel(result.periodNumber)} · ${result.attendance.time}`, student })
        await onRefresh()
      }
    } catch (reason) {
      const error = reason as Error & { code?: string }
      const message = error.code === 'student_not_found' ? 'لم يتم التعرف على باركود الطالب في هذه المدرسة.' : error.code === 'cooperation_closed' ? 'انتهت فترة تعاون المعلمين لهذا اليوم.' : 'تعذر حفظ الحضور. تحقق من الاتصال ثم أعد المحاولة.'
      showFeedback({ kind: 'error', title: 'تعذر تسجيل الطالب', message })
    } finally {
      if (source === 'manual' && completed) {
        setManualSelection([])
        setManualQuery('')
        setManualCandidates([])
        window.setTimeout(() => manualSearchRef.current?.focus(), 0)
      }
      window.setTimeout(() => { scanBusyRef.current = false }, 350)
    }
  }

  const addManualSelection = (student: TeacherCooperationStudent) => {
    if (manualSelection.some(item => item.id === student.id)) {
      showFeedback({ kind: 'duplicate', title: 'الطالب محدد بالفعل', message: 'راجع قائمة الطلاب المختارين قبل التأكيد.' })
      return
    }
    setManualSelection(current => [...current, student])
    setManualQuery('')
    setManualCandidates([])
    window.setTimeout(() => manualSearchRef.current?.focus(), 0)
  }
  const removeManualSelection = (studentId: string) => setManualSelection(current => current.filter(student => student.id !== studentId))
  const confirmManualSelection = async () => {
    const selected = manualSelection
    if (!selected.length || scanBusyRef.current) return
    scanBusyRef.current = true
    try {
      const result = await api.scanTeacherCooperationBulk(selected.map(student => student.id))
      if (result.created.length) {
        const createdIds = new Set(result.created.map(item => item.student.id))
        const entries: TeacherCooperationScan[] = result.created.map((item, index) => ({
          id: `${item.student.id}-${Date.now()}-${index}`, studentId: item.student.id, studentName: item.student.name,
          grade: item.student.grade, classroom: item.student.classroom, periodNumber: result.periodNumber,
          status: item.attendance.status, time: item.attendance.time,
        }))
        setRecent(current => [...entries, ...current.filter(item => !createdIds.has(item.studentId))])
        showFeedback({ kind: 'created', title: 'تم تسجيل الحضور بنجاح', message: `تم تسجيل ${result.created.length} طلاب · ${periodLabel(result.periodNumber)}` })
        await onRefresh()
      } else {
        showFeedback({ kind: 'duplicate', title: 'الطلاب تم تحضيرهم مسبقًا', message: `${result.duplicates.length} طلاب مسجلون بالفعل في سجل الحضور.` })
      }
      setManualSelection([])
      setManualQuery('')
      setManualCandidates([])
      window.setTimeout(() => manualSearchRef.current?.focus(), 0)
    } catch (reason) {
      const error = reason as Error & { code?: string }
      const message = error.code === 'cooperation_closed' ? 'انتهت فترة تعاون المعلمين لهذا اليوم.' : 'تعذر حفظ الحضور. تحقق من الاتصال ثم أعد المحاولة.'
      showFeedback({ kind: 'error', title: 'تعذر تسجيل الطلاب', message })
    } finally {
      window.setTimeout(() => { scanBusyRef.current = false }, 350)
    }
  }

  const scanFrame = (time: number) => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!streamRef.current || !video || !canvas) return
    if (time >= scanPauseUntilRef.current && video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      const scale = Math.min(1, SCAN_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
        if (code?.data) {
          scanPauseUntilRef.current = performance.now() + SCAN_PAUSE_AFTER_READ_MS
          void processCode(code.data)
        }
      }
    }
    if (!streamRef.current) return
    scanTimerRef.current = window.setTimeout(() => {
      scanTimerRef.current = null
      if (streamRef.current) frameRef.current = requestAnimationFrame(scanFrame)
    }, SCAN_INTERVAL_MS)
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setNotice('المتصفح لا يدعم تشغيل الكاميرا. استخدم Chrome أو Safari المحدث.'); return }
    setNotice('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 960, max: 1280 }, height: { ideal: 540, max: 720 }, frameRate: { ideal: 15, max: 20 } }, audio: false })
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      try { setTorchSupported(Boolean((track.getCapabilities?.() as MediaTrackCapabilities & { torch?: boolean })?.torch)) } catch { setTorchSupported(false) }
      setCameraActive(true)
      window.setTimeout(async () => {
        if (!videoRef.current || !streamRef.current) return
        videoRef.current.srcObject = streamRef.current; videoRef.current.playsInline = true; videoRef.current.muted = true
        try { await videoRef.current.play() } catch { setNotice('اضغط داخل شاشة الكاميرا للسماح بتشغيل الفيديو.') }
        frameRef.current = requestAnimationFrame(scanFrame)
      }, 50)
    } catch { setNotice('تعذر الوصول إلى الكاميرا. اسمح باستخدامها من إعدادات المتصفح ثم أعد المحاولة.') }
  }

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try { const next = !torchOn; await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }); setTorchOn(next) } catch { setNotice('الفلاش غير متاح في هذا الجهاز.') }
  }
  const toggleFullScreen = async () => {
    if (!viewportRef.current) return
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
    else await viewportRef.current.requestFullscreen?.().catch(() => {})
  }

  return <section className="teacher-cooperation-panel">
    <header className="cooperation-motivation"><Handshake size={32} /><div><span>{periodLabel(status.activePeriod || 1)} متاحة الآن حتى {status.windowEnd}</span><h2>تعاونك مع الإدارة يدل على وعيك</h2><p>ساهم في سرعة تحضير الطلاب وانضباط بداية اليوم الدراسي.</p></div></header>
    <div className="cooperation-live-stats"><article><strong>{status.ownCount}</strong><span>طالبًا ساهمت في تحضيرهم اليوم</span></article><article><strong>{status.contributors.length}</strong><span>معلمًا متعاونًا اليوم</span></article><article><strong>{periodLabel(status.activePeriod || 1)}</strong><span>{status.windowStart} — {status.windowEnd}</span></article></div>
    <div className="cooperation-camera-actions">
      {!cameraActive ? <button className="cooperation-camera-start" onClick={() => void startCamera()}><Camera size={21} /> بدء تحضير الطلاب</button> : <button className="cooperation-camera-stop" onClick={stopCamera}><Square size={18} fill="currentColor" /> إيقاف الكاميرا</button>}
      <button onClick={() => void toggleFullScreen()}>{fullScreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}{fullScreen ? 'تصغير' : 'ملء الشاشة'}</button>
      {torchSupported && <button className={torchOn ? 'active' : ''} onClick={() => void toggleTorch()}><Flashlight size={17} />{torchOn ? 'إطفاء الفلاش' : 'تشغيل الفلاش'}</button>}
    </div>
    {notice && <p className="teacher-notice error">{notice}</p>}
    <div ref={viewportRef} className={`cooperation-camera-viewport ${cameraActive ? 'live' : 'idle'}`}>
      {cameraActive ? <><video ref={videoRef} autoPlay muted playsInline /><canvas ref={canvasRef} hidden /><div className="cooperation-scan-frame"><span /><i>وجّه الكاميرا نحو باركود الطالب</i></div></> : <div className="cooperation-camera-idle"><Camera size={48} /><strong>الكاميرا في وضع الاستعداد</strong><span>اضغط «فتح الكاميرا» وابدأ التحضير المتتابع.</span></div>}
      {feedback && <div className={`cooperation-scan-feedback ${feedback.kind}`} role="status" aria-live="assertive">{feedback.kind === 'error' ? <XCircle size={23} /> : <CheckCircle2 size={23} />}<div><strong>{feedback.title}</strong>{feedback.student && <b>{feedback.student.name}</b>}<span>{feedback.student ? `${feedback.student.grade} · ${feedback.student.classroom} — ` : ''}{feedback.message}</span></div></div>}
      {fullScreen && <button className="cooperation-exit-fullscreen" onClick={() => void toggleFullScreen()}><Minimize2 size={16} /> خروج</button>}
    </div>
    <section className="cooperation-manual-search"><label>التحضير اليدوي بالاسم أو الرقم<div className="cooperation-search-input"><Search size={17} /><input ref={manualSearchRef} type="search" value={manualQuery} onChange={event => setManualQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && manualCandidates.length === 1) { event.preventDefault(); addManualSelection(manualCandidates[0]) } }} placeholder="اكتب اسم الطالب أو رقمه..." aria-label="ابحث عن طالب لتسجيل حضوره" aria-autocomplete="list" /></div></label>
      {manualQuery.trim() && <div className="cooperation-manual-results" role="listbox" aria-label="نتائج البحث عن الطلاب">{manualSearching ? <p>جارٍ البحث...</p> : manualCandidates.length ? manualCandidates.map(student => {
        const selected = manualSelection.some(item => item.id === student.id)
        return <button type="button" role="option" key={student.id} onClick={() => addManualSelection(student)} disabled={selected || scanBusyRef.current}><span><strong>{student.name}</strong><small>رقم {student.id} · {student.grade} · فصل {student.classroom}</small></span><b>{selected ? 'محدد' : 'إضافة'}</b></button>
      }) : <p>لم يتم العثور على طالب بهذا الاسم أو الرقم.</p>}</div>}
      {manualSelection.length > 0 && <div className="cooperation-manual-selection">
        <div className="manual-selected-heading"><strong>الطلاب المختارون ({manualSelection.length})</strong><span>أضف أسماء أخرى ثم أكد تسجيلهم دفعة واحدة.</span></div>
        <div className="manual-selected-list">{manualSelection.map(student => <article key={student.id}><span><strong>{student.name}</strong><small>رقم {student.id} · {student.grade} · فصل {student.classroom}</small></span><button type="button" className="manual-selected-remove" onClick={() => removeManualSelection(student.id)} disabled={scanBusyRef.current}>إزالة</button></article>)}</div>
        <div className="manual-selection-actions"><button type="button" onClick={() => { setManualSelection([]); window.setTimeout(() => manualSearchRef.current?.focus(), 0) }} disabled={scanBusyRef.current}>إلغاء التحديد</button><button type="button" className="confirm" onClick={() => void confirmManualSelection()} disabled={scanBusyRef.current}>تأكيد تسجيل {manualSelection.length} طلاب</button></div>
      </div>}
    </section>
    <section className="cooperation-recent"><div><span>سجل هذه الفترة</span><strong>{recent.length} عملية ناجحة</strong></div>{recent.length ? <div className="cooperation-recent-list">{recent.map(item => <article key={item.id}><CheckCircle2 size={18} /><div><strong>{item.studentName}</strong><span>{item.grade} · {item.classroom}</span></div><small>{periodLabel(item.periodNumber)}<b>{item.time}</b></small></article>)}</div> : <p>لم تسجل أي طالب حتى الآن.</p>}</section>
  </section>
}

type CooperationGroup = { key: string; teacherId: string; teacherName: string; date: string; periodNumber: number; firstTime: string; lastTime: string; entries: TeacherCooperationEntry[] }

export function TeacherCooperationAdmin({ schoolName, principalName }: { schoolName: string; principalName: string }) {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(today())
  const [teacherId, setTeacherId] = useState('')
  const [periodNumber, setPeriodNumber] = useState('')
  const [entries, setEntries] = useState<TeacherCooperationEntry[]>([])
  const [teachers, setTeachers] = useState<Array<{ teacherId: string; name: string }>>([])
  const [expanded, setExpanded] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setBusy(true); setError('')
    try { const result = await api.teacherCooperationReport({ from, to, teacherId, periodNumber }); setEntries(result.entries); setTeachers(result.teachers) }
    catch { setError('تعذر تحميل سجل المعلمين المتعاونين.') } finally { setBusy(false) }
  }
  useEffect(() => { void load() }, [])
  const groups = useMemo(() => {
    const map = new Map<string, CooperationGroup>()
    for (const entry of entries) {
      const key = `${entry.teacherId}-${entry.date}-${entry.periodNumber}`
      const current = map.get(key) || { key, teacherId: entry.teacherId, teacherName: entry.teacherName, date: entry.date, periodNumber: entry.periodNumber, firstTime: entry.time, lastTime: entry.time, entries: [] }
      current.entries.push(entry)
      if (entry.time < current.firstTime) current.firstTime = entry.time
      if (entry.time > current.lastTime) current.lastTime = entry.time
      map.set(key, current)
    }
    return [...map.values()].sort((a, b) => `${b.date}-${b.lastTime}`.localeCompare(`${a.date}-${a.lastTime}`))
  }, [entries])
  const uniqueTeachers = new Set(entries.map(entry => entry.teacherId)).size
  const firstPeriodCount = entries.filter(entry => entry.periodNumber === 1).length
  const secondPeriodCount = entries.filter(entry => entry.periodNumber === 2).length

  const exportExcel = () => downloadWorkbook('سجل_المعلمين_المتعاونين', [['المعلم', 'التاريخ', 'الحصة', 'الطالب', 'رقم الطالب', 'الصف', 'الفصل', 'وقت التسجيل', 'الحالة'], ...entries.map(entry => [entry.teacherName, formatHijriDate(entry.date), periodLabel(entry.periodNumber), entry.studentName, entry.studentId, entry.grade, entry.classroom, entry.time, entry.status === 'present' ? 'حاضر' : 'متأخر'])], 'المعلم المتعاون', schoolName, 'سجل المعلمين المتعاونين في تحضير الطلاب')
  const exportPdf = () => {
    const rows = entries.map(entry => `<tr><td>${escapeHtml(entry.teacherName)}</td><td>${escapeHtml(formatHijriDate(entry.date))}</td><td>${escapeHtml(periodLabel(entry.periodNumber))}</td><td>${escapeHtml(entry.studentName)}</td><td>${escapeHtml(entry.studentId)}</td><td>${escapeHtml(`${entry.grade} ${entry.classroom}`)}</td><td dir="ltr">${escapeHtml(entry.time)}</td></tr>`).join('')
    openPrintDocument('سجل المعلمين المتعاونين في تحضير الطلاب', `<section class="page"><h1>سجل المعلمين المتعاونين</h1><p class="meta">الفترة: ${escapeHtml(formatHijriDate(from))} إلى ${escapeHtml(formatHijriDate(to))}</p><table><thead><tr><th>المعلم</th><th>التاريخ</th><th>الحصة</th><th>الطالب</th><th>رقم الطالب</th><th>الصف والفصل</th><th>الوقت</th></tr></thead><tbody>${rows || '<tr><td colspan="7">لا توجد بيانات</td></tr>'}</tbody></table><p class="meta">مدير المدرسة: ${escapeHtml(principalName)} &nbsp;&nbsp;&nbsp; التوقيع: ........................</p></section>`, schoolName, 'landscape')
  }

  return <section className="cooperation-admin-page" dir="rtl">
    <header className="cooperation-admin-head"><div><span>الشراكة في الانضباط</span><h2>المعلم المتعاون</h2><p>سجل مساهمات المعلمين في تحضير الطلاب خلال الحصتين الأولى والثانية.</p></div><Handshake size={34} /></header>
    <div className="cooperation-admin-stats"><article><Users /><div><strong>{uniqueTeachers}</strong><span>معلمون متعاونون</span></div></article><article><CheckCircle2 /><div><strong>{entries.length}</strong><span>طلاب تم تحضيرهم</span></div></article><article><span>١</span><div><strong>{firstPeriodCount}</strong><small>الحصة الأولى</small></div></article><article><span>٢</span><div><strong>{secondPeriodCount}</strong><small>الحصة الثانية</small></div></article></div>
    <section className="cooperation-admin-panel">
      <div className="cooperation-admin-filters"><HijriDatePicker label="من التاريخ" value={from} max={to} onChange={setFrom} /><HijriDatePicker label="إلى التاريخ" value={to} min={from} max={today()} onChange={setTo} /><label>المعلم<select value={teacherId} onChange={event => setTeacherId(event.target.value)}><option value="">جميع المعلمين</option>{teachers.map(teacher => <option key={teacher.teacherId} value={teacher.teacherId}>{teacher.name}</option>)}</select></label><label>الحصة<select value={periodNumber} onChange={event => setPeriodNumber(event.target.value)}><option value="">الحصتان</option><option value="1">الحصة الأولى</option><option value="2">الحصة الثانية</option></select></label><button className="primary-button" onClick={() => void load()}><RefreshCw size={17} /> عرض</button></div>
      <div className="cooperation-admin-exports"><button className="outline-button" disabled={!entries.length} onClick={exportExcel}><Download size={16} /> Excel</button><button className="outline-button" disabled={!entries.length} onClick={exportPdf}><Printer size={16} /> PDF</button></div>
      {error && <p className="teacher-notice error">{error}</p>}
      {busy ? <p className="cooperation-admin-empty">جارٍ تحميل السجل…</p> : !groups.length ? <p className="cooperation-admin-empty">لا توجد مساهمات ضمن الفترة المحددة.</p> : <div className="cooperation-groups">{groups.map(group => <article key={group.key} className={expanded === group.key ? 'open' : ''}><button className="cooperation-group-summary" onClick={() => setExpanded(current => current === group.key ? '' : group.key)}><span className="cooperation-group-avatar">{group.teacherName.charAt(0)}</span><div><strong>{group.teacherName}</strong><small>{formatHijriDate(group.date)} · {periodLabel(group.periodNumber)}</small></div><b>{group.entries.length} طالب</b><span>{group.firstTime} — {group.lastTime}</span></button>{expanded === group.key && <div className="cooperation-group-details">{group.entries.map(entry => <div key={entry.id}><CheckCircle2 size={16} /><span><strong>{entry.studentName}</strong><small>{entry.studentId} · {entry.grade} · {entry.classroom}</small></span><time>{entry.time}</time></div>)}</div>}</article>)}</div>}
    </section>
  </section>
}
