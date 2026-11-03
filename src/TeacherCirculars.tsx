import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Eraser, FileText, PenLine, RefreshCw } from 'lucide-react'
import { api, type TeacherCircular } from './api'
import { formatHijriDate } from './dateUtils'

function circularStatus(item: TeacherCircular) {
  return item.status === 'signed' ? 'تم التوقيع بالعلم' : 'بانتظار توقيعك'
}

export function TeacherCirculars({ schoolName }: { schoolName: string }) {
  const [circulars, setCirculars] = useState<TeacherCircular[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [hasInk, setHasInk] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)

  const selected = circulars.find(item => item.id === selectedId) || null
  const load = async () => {
    setLoading(true); setError('')
    try {
      const result = await api.teacherCirculars()
      setCirculars(result.circulars)
      setSelectedId(current => current && result.circulars.some(item => item.id === current) ? current : (result.circulars[0]?.id || ''))
    } catch { setError('تعذر تحميل التعاميم الآن. حدّث الصفحة ثم أعد المحاولة.') }
    finally { setLoading(false) }
  }

  const clearSignature = () => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }

  const prepareSignature = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const bounds = canvas.getBoundingClientRect()
    const scale = Math.max(window.devicePixelRatio || 1, 1)
    canvas.width = Math.max(2, Math.floor(bounds.width * scale))
    canvas.height = Math.max(2, Math.floor(bounds.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return
    context.strokeStyle = '#1268c4'
    context.lineWidth = 5 * scale
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }

  useEffect(() => { void load() }, [])
  useEffect(() => {
    if (!selected || selected.status === 'signed') return
    const frame = window.requestAnimationFrame(prepareSignature)
    return () => window.cancelAnimationFrame(frame)
  }, [selectedId, selected?.status])

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const bounds = canvas?.getBoundingClientRect()
    if (!canvas || !bounds) return null
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height }
  }
  const beginDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    const start = point(event)
    if (!canvas || !context || !start) return
    event.preventDefault()
    drawingRef.current = true
    canvas.setPointerCapture(event.pointerId)
    context.beginPath(); context.moveTo(start.x, start.y)
    setHasInk(true)
  }
  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || busy) return
    const context = canvasRef.current?.getContext('2d')
    const next = point(event)
    if (!context || !next) return
    event.preventDefault()
    context.lineTo(next.x, next.y); context.stroke()
  }
  const stopDrawing = () => { drawingRef.current = false }

  const sign = async () => {
    const canvas = canvasRef.current
    if (!selected || !canvas || selected.status === 'signed') return
    if (!hasInk) { setError('ارسم توقيعك أولاً بعد قراءة التعميم.'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await api.signTeacherCircular(selected.id, canvas.toDataURL('image/png'))
      setCirculars(current => current.map(item => item.id === selected.id ? { ...item, ...result.recipient } : item))
      setNotice('تم التوقيع بالعلم والاطلاع. وصل توقيعك مباشرة إلى سجل التعميم في المدرسة.')
      setHasInk(false)
    } catch {
      await load()
      setError('تعذر حفظ التوقيع، أو أنه تم اعتماده من رابط واتساب مسبقًا. حدّث السجل للتحقق.')
    } finally { setBusy(false) }
  }

  return <section className="teacher-circulars" dir="rtl">
    <header className="teacher-circulars-head"><div><span>إقرار إلكتروني داخل الحساب</span><h2>التعاميم</h2><p>اقرأ التعميم ثم وقّع بالعلم. لا تحتاج إلى واتساب عند التوقيع من هنا.</p></div><FileText size={31} /></header>
    {notice && <p className="teacher-notice success">{notice}</p>}{error && <p className="teacher-notice error">{error}</p>}
    <div className="teacher-circulars-layout">
      <aside className="teacher-circulars-list"><header><strong>التعاميم الواردة</strong><button type="button" className="outline-button" onClick={() => void load()} disabled={loading || busy}><RefreshCw size={15} /> تحديث</button></header>
        {loading ? <p className="teacher-empty">جارٍ تحميل التعاميم…</p> : !circulars.length ? <p className="teacher-empty">لا توجد تعاميم موجهة لك حاليًا.</p> : circulars.map(item => <button type="button" key={item.id} className={selected?.id === item.id ? 'selected' : ''} onClick={() => { setSelectedId(item.id); setNotice(''); setError('') }}><FileText size={18} /><span><strong>{item.title}</strong><small>{formatHijriDate(item.circularDate)}</small></span><b className={item.status}>{circularStatus(item)}</b></button>)}</aside>
      <section className="teacher-circular-read">
        {!selected ? <p className="teacher-empty">اختر تعميمًا لقراءته والتوقيع بالعلم.</p> : <>
          <header><span>تعميم رسمي</span><h3>{selected.title}</h3><p>{schoolName} · {formatHijriDate(selected.circularDate)}</p></header>
          <section className="teacher-circular-file"><div><strong>مرفق التعميم</strong><small>{selected.fileName}</small></div>{selected.fileType === 'application/pdf' ? <object data={selected.fileData} type="application/pdf">يتعذر عرض ملف PDF هنا؛ نزّله ثم اقرأه.</object> : <img src={selected.fileData} alt={`تعميم: ${selected.title}`} />}</section>
          {selected.status === 'signed' ? <section className="teacher-circular-signed"><CheckCircle2 size={25} /><div><strong>تم التوقيع بالعلم</strong><span>{selected.signedAt ? `وقت التوقيع: ${selected.signedAt}` : 'تم حفظ التوقيع في سجل المدرسة.'}</span></div>{selected.signatureData && <img src={selected.signatureData} alt="توقيع المعلم" />}</section> : <section className="teacher-circular-signature"><header><div><PenLine size={20} /><div><strong>التوقيع بالعلم والاطلاع</strong><small>ارسم توقيعك بالماوس أو باللمس ثم اضغط زر الاعتماد.</small></div></div><button type="button" className="outline-button" onClick={clearSignature} disabled={busy}><Eraser size={15} /> مسح التوقيع</button></header><canvas ref={canvasRef} className="teacher-circular-signature-pad" onPointerDown={beginDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} /><button type="button" className="primary-button" onClick={() => void sign()} disabled={busy}>{busy ? 'جارٍ حفظ التوقيع…' : 'التوقيع بالعلم'}</button></section>}
        </>}
      </section>
    </div>
  </section>
}
