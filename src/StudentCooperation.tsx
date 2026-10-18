import { useEffect, useRef, useState } from 'react'
import * as jsQRNs from 'jsqr'
import { Camera, CheckCircle2, ShieldCheck, Square, XCircle } from 'lucide-react'
import { api, type StudentCooperationStatus } from './api'

const jsQR = ((jsQRNs as unknown as { default?: unknown }).default || jsQRNs) as (data: Uint8ClampedArray, width: number, height: number, options?: { inversionAttempts?: 'attemptBoth' }) => { data: string } | null
const SCAN_INTERVAL_MS = 150
const SCAN_MAX_DIMENSION = 360

type Feedback = { kind: 'created' | 'duplicate' | 'error'; title: string; message: string; student?: { name: string; grade: string; classroom: string } }

export function StudentCooperationPanel({ status, onStatus }: { status: StudentCooperationStatus; onStatus: (status: StudentCooperationStatus) => void }) {
  const [cameraActive, setCameraActive] = useState(false)
  const [notice, setNotice] = useState('')
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [recent, setRecent] = useState<Array<{ studentId: string; studentName: string; time: string }>>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef(0)
  const scanTimerRef = useRef<number | null>(null)
  const scanBusyRef = useRef(false)
  const lastCodeRef = useRef({ code: '', at: 0 })
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopCamera = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
    scanTimerRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraActive(false)
  }
  const refreshStatus = async () => {
    try {
      const next = await api.studentCooperationStatus()
      onStatus(next)
      if (!next.available) stopCamera()
    } catch { /* سيظهر الخطأ عند تنفيذ التحضير إذا انقطعت الجلسة. */ }
  }
  useEffect(() => {
    const timer = window.setInterval(() => { void refreshStatus() }, 20_000)
    return () => window.clearInterval(timer)
  })
  useEffect(() => () => { stopCamera(); if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current) }, [])
  useEffect(() => { if (!status.available) stopCamera() }, [status.available])
  useEffect(() => {
    const stopWhenHidden = () => { if (document.hidden) stopCamera() }
    document.addEventListener('visibilitychange', stopWhenHidden)
    return () => document.removeEventListener('visibilitychange', stopWhenHidden)
  }, [])

  const showFeedback = (next: Feedback) => {
    setFeedback(next)
    if (navigator.vibrate) navigator.vibrate(next.kind === 'error' ? [80, 50, 80] : 70)
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), next.kind === 'duplicate' ? 3000 : 2300)
  }
  const processCode = async (rawCode: string) => {
    const code = rawCode.trim()
    if (!code || scanBusyRef.current) return
    const now = Date.now()
    if (lastCodeRef.current.code === code && now - lastCodeRef.current.at < 1800) return
    lastCodeRef.current = { code, at: now }
    scanBusyRef.current = true
    try {
      const result = await api.scanStudentCooperation(code)
      const student = { name: result.student.name, grade: result.student.grade, classroom: result.student.classroom }
      if (result.outcome === 'duplicate') {
        showFeedback({ kind: 'duplicate', title: 'تم تحضير الطالب مسبقًا', message: 'هذا الطالب مسجل بالفعل في حضور اليوم.', student })
      } else {
        setRecent(current => [{ studentId: result.student.id, studentName: result.student.name, time: result.attendance.time }, ...current.filter(item => item.studentId !== result.student.id)].slice(0, 12))
        showFeedback({ kind: 'created', title: 'تم تسجيل الحضور بنجاح', message: `حاضر · ${result.attendance.time}`, student })
      }
    } catch (reason) {
      const error = reason as Error & { code?: string }
      const message = error.code === 'student_not_in_classroom' ? 'هذا الباركود لا يخص طالبًا في فصلك.'
        : error.code === 'own_barcode_not_allowed' ? 'لا يمكن تحضير حسابك من تبويب تعاون الطالب.'
          : error.code === 'cooperation_closed' ? 'انتهت الحصة الأولى، وأُغلق تبويب تعاون الطالب.'
            : error.code === 'cooperation_not_authorized' ? 'لم تعد صلاحية التعاون مفعّلة لهذا الحساب.'
              : 'تعذر قراءة الباركود أو حفظ الحضور. حاول مرة أخرى.'
      showFeedback({ kind: 'error', title: 'تعذر تسجيل الحضور', message })
      if (error.code === 'cooperation_closed' || error.code === 'cooperation_not_authorized') await refreshStatus()
    } finally {
      window.setTimeout(() => { scanBusyRef.current = false }, 350)
    }
  }
  const scanFrame = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!streamRef.current || !video || !canvas) return
    if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      const scale = Math.min(1, SCAN_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight))
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })
        if (code?.data) void processCode(code.data)
      }
    }
    if (!streamRef.current) return
    scanTimerRef.current = window.setTimeout(() => { if (streamRef.current) frameRef.current = requestAnimationFrame(scanFrame) }, SCAN_INTERVAL_MS)
  }
  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setNotice('المتصفح لا يدعم تشغيل الكاميرا. استخدم Chrome أو Safari محدثًا.'); return }
    setNotice('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 960, max: 1280 }, height: { ideal: 540, max: 720 }, frameRate: { ideal: 15, max: 20 } }, audio: false })
      streamRef.current = stream
      setCameraActive(true)
      window.setTimeout(async () => {
        if (!videoRef.current || !streamRef.current) return
        videoRef.current.srcObject = streamRef.current
        videoRef.current.playsInline = true
        videoRef.current.muted = true
        try { await videoRef.current.play() } catch { setNotice('اضغط داخل شاشة الكاميرا للسماح بتشغيل الفيديو.') }
        frameRef.current = requestAnimationFrame(scanFrame)
      }, 50)
    } catch { setNotice('تعذر الوصول إلى الكاميرا. اسمح باستخدامها من إعدادات المتصفح ثم أعد المحاولة.') }
  }

  return <section className="student-cooperation-panel">
    <header className="cooperation-motivation"><ShieldCheck size={32} /><div><span>متاح في الحصة الأولى حتى {status.windowEnd}</span><h2>تعاون الطالب في تحضير الفصل</h2><p>وجّه الكاميرا إلى باركود زملائك في الفصل. تسجل هذه الخدمة الحضور فقط ولا تدعم التحضير اليدوي أو التأخر.</p></div></header>
    <div className="cooperation-live-stats student-cooperation-stats"><article><strong>{status.classroom?.grade || '—'}</strong><span>الصف</span></article><article><strong>{status.classroom?.classroom || '—'}</strong><span>الفصل</span></article><article><strong>{status.windowStart} — {status.windowEnd}</strong><span>وقت الصلاحية</span></article></div>
    <div className="cooperation-camera-actions">
      {!cameraActive ? <button className="cooperation-camera-start" onClick={() => void startCamera()}><Camera size={21} /> فتح الكاميرا لتحضير الطلاب</button> : <button className="cooperation-camera-stop" onClick={stopCamera}><Square size={18} fill="currentColor" /> إيقاف الكاميرا</button>}
    </div>
    {notice && <p className="teacher-notice error">{notice}</p>}
    <div className={`cooperation-camera-viewport ${cameraActive ? 'live' : 'idle'}`}>
      {cameraActive ? <><video ref={videoRef} autoPlay muted playsInline /><canvas ref={canvasRef} hidden /><div className="cooperation-scan-frame"><span /><i>وجّه الكاميرا نحو باركود طالب من فصلك</i></div></> : <div className="cooperation-camera-idle"><Camera size={48} /><strong>الكاميرا في وضع الاستعداد</strong><span>التحضير بالكاميرا فقط، لطلاب فصلك، وخلال الحصة الأولى.</span></div>}
      {feedback && <div className={`cooperation-scan-feedback ${feedback.kind}`} role="status" aria-live="assertive">{feedback.kind === 'error' ? <XCircle size={23} /> : <CheckCircle2 size={23} />}<div><strong>{feedback.title}</strong>{feedback.student && <b>{feedback.student.name}</b>}<span>{feedback.student ? `${feedback.student.grade} · ${feedback.student.classroom} — ` : ''}{feedback.message}</span></div></div>}
    </div>
    <section className="cooperation-recent"><div><span>عملياتك الناجحة</span><strong>{recent.length} طالبًا</strong></div>{recent.length ? <div className="cooperation-recent-list">{recent.map(item => <article key={item.studentId}><CheckCircle2 size={18} /><div><strong>{item.studentName}</strong><span>تم تسجيله حاضرًا</span></div><small><b>{item.time}</b></small></article>)}</div> : <p>لم تسجل حضور أي طالب حتى الآن.</p>}</section>
  </section>
}
