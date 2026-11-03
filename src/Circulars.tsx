import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, FileText, Image, Plus, Printer, RefreshCw, Send, Upload, Users } from 'lucide-react'
import * as pdfjs from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { api, type CircularRecipient, type SchoolCircular, type SchoolCircularDetail } from './api'
import { formatHijriDate } from './dateUtils'
import { brandReportHtmlDocument, installReportPdfDownload, reportBrandHeader } from './SchoolFeatures'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))

function validWhatsApp(value: string) {
  let phone = value.replace(/\D/g, '')
  if (phone.startsWith('00966')) phone = phone.slice(2)
  if (phone.startsWith('05') && phone.length === 10) phone = `966${phone.slice(1)}`
  if (phone.startsWith('5') && phone.length === 9) phone = `966${phone}`
  return phone.startsWith('966') && phone.length >= 11 ? phone : ''
}

function status(recipient: CircularRecipient) {
  if (recipient.status === 'signed') return { label: 'وقّع بالعلم', tone: 'signed' }
  if (!validWhatsApp(recipient.teacherPhone)) return { label: 'لا يوجد رقم', tone: 'missing' }
  return { label: recipient.sentAt ? 'تحت الإجراء' : 'جاهز للإرسال', tone: recipient.sentAt ? 'pending' : 'ready' }
}

function readAttachment(file: File) {
  return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('file_read')); reader.onload = () => resolve(String(reader.result || '')); reader.readAsDataURL(file) })
}

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

function dataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function pdfPages(fileData: string) {
  const document = await pdfjs.getDocument({ data: dataUrlBytes(fileData) }).promise
  const images: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('pdf_canvas')
      await page.render({ canvasContext: context, viewport }).promise
      images.push(canvas.toDataURL('image/jpeg', 0.94))
    }
  } finally {
    await document.destroy()
  }
  return images
}

async function circularAttachmentPages(circular: SchoolCircularDetail['circular'], schoolName: string) {
  const attachmentHeader = `${reportBrandHeader('مرفق التعميم الرسمي', schoolName)}<div class="details"><strong>عنوان التعميم:</strong> ${esc(circular.title)}<br><strong>تاريخ التعميم:</strong> ${esc(formatHijriDate(circular.circularDate))}<br><strong>المرفق:</strong> ${esc(circular.fileName)}</div>`
  if (circular.fileType !== 'application/pdf') return `<section class="page attachment-page">${attachmentHeader}<img class="circular-attachment-image" src="${circular.fileData}" alt="مرفق التعميم" /></section>`
  const images = await pdfPages(circular.fileData)
  return images.map((image, index) => `<section class="page attachment-page">${attachmentHeader}<p class="attachment-page-number">صفحة ${index + 1} من ${images.length}</p><img class="circular-attachment-image" src="${image}" alt="صفحة ${index + 1} من مرفق التعميم" /></section>`).join('')
}

async function circularReport(circulars: SchoolCircularDetail[], schoolName: string) {
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.body.innerHTML = '<main dir="rtl" style="font-family:Tahoma,Arial;padding:32px;text-align:center;color:#075a62">جارٍ تجهيز التعميم كاملاً مع سجل التوقيعات…</main>'
  try {
    const pages = (await Promise.all(circulars.map(async ({ circular, recipients }) => {
      const rows = recipients.map(item => `<tr><td>${esc(item.teacherName)}</td><td dir="ltr">${esc(item.teacherPhone || '—')}</td><td>${esc(status(item).label)}</td><td>${esc(item.sentByName || '—')}</td><td>${esc(item.sentAt || '—')}</td><td>${esc(item.signedAt || '—')}</td><td>${item.signatureData ? `<img class="signature" src="${item.signatureData}" alt="توقيع المعلم" />` : '—'}</td></tr>`).join('')
      const acknowledgement = `<section class="page acknowledgement-page">${reportBrandHeader('سجل التوقيع بالعلم على تعميم', schoolName)}<div class="details"><strong>عنوان التعميم:</strong> ${esc(circular.title)}<br><strong>تاريخ التعميم:</strong> ${esc(formatHijriDate(circular.circularDate))}<br><strong>المرفق:</strong> ${esc(circular.fileName)}</div><table><thead><tr><th>المعلم</th><th>الجوال</th><th>الحالة</th><th>مرسل الرابط</th><th>وقت الإرسال</th><th>وقت التوقيع</th><th>التوقيع</th></tr></thead><tbody>${rows || '<tr><td colspan="7">لم تُنشأ روابط المعلمين بعد.</td></tr>'}</tbody></table></section>`
      return `${await circularAttachmentPages(circular, schoolName)}${acknowledgement}`
    }))).join('')
    const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل التوقيع على التعاميم</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial;color:#143d45;margin:0}.page{break-after:page}.page:last-child{break-after:auto}.details{margin:0 0 11px;line-height:1.9;font-size:12px}.attachment-page-number{margin:-4px 0 7px;color:#5a7678;font-size:11px;font-weight:700}.circular-attachment-image{display:block;max-width:100%;width:auto;max-height:158mm;margin:0 auto;object-fit:contain}.acknowledgement-page table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border:1px solid #a8c7c0;padding:6px;text-align:right;vertical-align:middle}th{background:#075a62;color:#fff}.signature{width:90px;height:28px;object-fit:contain}.actions{position:sticky;top:0;background:#075a62;padding:8px;display:flex;gap:8px}.actions button{border:0;border-radius:7px;padding:9px 14px;cursor:pointer}@media print{.actions{display:none}}</style></head><body><div class="actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div>${pages}</body></html>`
    const objectUrl = URL.createObjectURL(new Blob([brandReportHtmlDocument(html, schoolName)], { type: 'text/html;charset=utf-8' }))
    popup.onload = () => installReportPdfDownload(popup.document, 'سجل التوقيع على التعاميم', 'landscape')
    popup.location.href = objectUrl
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 600000)
    return true
  } catch (error) {
    popup.close()
    throw error
  }
}

export function CircularsCenter({ schoolName }: { schoolName: string }) {
  const [circulars, setCirculars] = useState<SchoolCircular[]>([])
  const [detail, setDetail] = useState<SchoolCircularDetail | null>(null)
  const [openId, setOpenId] = useState('')
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [circularDate, setCircularDate] = useState(today)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [fallbackLink, setFallbackLink] = useState<{ url: string; name: string } | null>(null)

  const load = async () => {
    try { setCirculars((await api.circulars()).circulars) } catch { setError('تعذر تحميل سجل التعاميم. حدّث الصفحة ثم حاول مرة أخرى.') }
  }
  useEffect(() => { void load() }, [])
  const openCircular = async (id: string) => {
    setError(''); setNotice(''); setFallbackLink(null)
    if (openId === id) { setOpenId(''); setDetail(null); return }
    setOpenId(id); setDetail(null); setBusy(`open-${id}`)
    try { setDetail(await api.circular(id)) } catch { setError('تعذر فتح سجل هذا التعميم.') } finally { setBusy('') }
  }

  const create = async () => {
    if (title.trim().length < 2) { setError('اكتب عنوانًا واضحًا للتعميم.'); return }
    if (!attachment) { setError('أرفق صورة أو ملف PDF للتعميم.'); return }
    if (!['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(attachment.type)) { setError('الصيغ المدعومة هي JPG وPNG وWEBP وPDF فقط.'); return }
    if (attachment.size > 8 * 1024 * 1024) { setError('حجم الملف كبير. الحد الأعلى 8 ميجابايت.'); return }
    setBusy('create'); setError(''); setNotice('')
    try {
      const fileData = await readAttachment(attachment)
      const created = await api.createCircular({ title: title.trim(), circularDate, fileName: attachment.name, fileData })
      setCirculars(currentRows => [created.circular, ...currentRows])
      setTitle(''); setAttachment(null); setAdding(false); setNotice('تم حفظ التعميم. افتحه ثم اضغط «إنشاء روابط المعلمين».')
      void openCircular(created.circular.id)
    } catch { setError('تعذر حفظ التعميم. تحقق من الملف ثم أعد المحاولة.') } finally { setBusy('') }
  }

  const generateRecipients = async () => {
    if (!detail) return
    setBusy('generate'); setError(''); setNotice('')
    try {
      const result = await api.generateCircularRecipients(detail.circular.id)
      setDetail(currentDetail => currentDetail ? { ...currentDetail, recipients: result.recipients } : currentDetail)
      setCirculars(rows => rows.map(row => row.id === detail.circular.id ? { ...row, recipients: result.recipients.length, pending: result.recipients.filter(item => item.status === 'pending').length, signed: result.recipients.filter(item => item.status === 'signed').length } : row))
      setNotice(result.generated ? `تم إنشاء روابط ${result.generated} معلمًا من أصل ${result.total}.` : 'روابط المعلمين منشأة مسبقًا؛ يمكنك إرسال أي رابط من القائمة.')
    } catch { setError('تعذر إنشاء روابط المعلمين. تحقق من وجود معلمين مستوردين في النظام.') } finally { setBusy('') }
  }

  const sendRecipient = async (recipient: CircularRecipient) => {
    if (!detail) return
    const phone = validWhatsApp(recipient.teacherPhone)
    if (!phone) { setError(`لا يوجد رقم جوال صالح للمعلم ${recipient.teacherName}.`); return }
    setBusy(`send-${recipient.id}`); setError(''); setFallbackLink(null)
    const whatsappTab = window.open('about:blank', '_blank')
    if (whatsappTab) whatsappTab.document.body.innerHTML = '<main dir="rtl" style="font-family:Tahoma,Arial;padding:32px;text-align:center;color:#075a62">جارٍ تجهيز رسالة واتساب للمعلم…</main>'
    try {
      const sent = await api.sendCircularRecipient(detail.circular.id, recipient.id)
      const message = `الزميل/ـة ${recipient.teacherName}\nيرجى الاطلاع على التعميم التالي ثم التوقيع بالعلم:\n${detail.circular.title}\n${sent.link}`
      const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      if (whatsappTab) whatsappTab.location.replace(url); else window.open(url, '_blank')
      setFallbackLink({ url, name: recipient.teacherName })
      setDetail(currentDetail => currentDetail ? { ...currentDetail, recipients: currentDetail.recipients.map(item => item.id === recipient.id ? sent.recipient : item) } : currentDetail)
      setCirculars(rows => rows.map(row => row.id === detail.circular.id ? { ...row, sent: row.sent + (recipient.sentAt ? 0 : 1) } : row))
    } catch { whatsappTab?.close(); setError('تعذر تجهيز رسالة واتساب. أعد المحاولة.') } finally { setBusy('') }
  }

  const printAll = async () => {
    setBusy('print-all'); setError('')
    try { await circularReport(await Promise.all(circulars.map(row => api.circular(row.id))), schoolName) } catch { setError('تعذر تجهيز التعميم كاملاً للطباعة. تحقق من الملف ثم أعد المحاولة.') } finally { setBusy('') }
  }

  return <section className="circulars-center" dir="rtl">
    <header className="circulars-hero"><div><span>توثيق إلكتروني للمعلمين</span><h2>التعاميم</h2><p>ارفع التعميم، أنشئ روابط المعلمين، ثم تابع توقيعات العلم والاطلاع من سجل واحد.</p></div><FileText size={38} /></header>
    <div className="circulars-toolbar"><button type="button" className="primary-button" onClick={() => { setAdding(value => !value); setError(''); setNotice('') }}><Plus size={18} /> إضافة تعميم</button><button type="button" className="outline-button" onClick={() => void printAll()} disabled={!circulars.length || busy === 'print-all'}><Printer size={17} /> طباعة جميع التعاميم</button><button type="button" className="outline-button" onClick={() => void load()}><RefreshCw size={17} /> تحديث السجل</button></div>
    {adding && <section className="circular-create"><header><Upload size={23} /><div><h3>إضافة تعميم رسمي</h3><p>أدخل العنوان وأرفق صورة أو ملف PDF، ثم أنشئ روابط توقيع المعلمين بعد الحفظ.</p></div></header><div className="circular-create-fields"><label>عنوان التعميم<input value={title} onChange={event => setTitle(event.target.value)} placeholder="مثال: تعميم بشأن الانضباط المدرسي" /></label><label>تاريخ التعميم<input type="date" value={circularDate} onChange={event => setCircularDate(event.target.value)} /></label><label className="circular-upload">إرفاق التعميم<input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={event => setAttachment(event.target.files?.[0] || null)} /><span>{attachment ? attachment.name : 'اختر صورة أو PDF (حتى 8 ميجابايت)'}</span></label><button type="button" className="primary-button" onClick={() => void create()} disabled={busy === 'create'}>{busy === 'create' ? 'جارٍ الحفظ…' : 'حفظ التعميم'}</button></div></section>}
    {notice && <p className="teacher-notice success">{notice}</p>}{error && <p className="teacher-notice error">{error}</p>}{fallbackLink && <a className="circular-whatsapp-fallback" href={fallbackLink.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />لم يفتح واتساب؟ افتح رسالة {fallbackLink.name} الآن</a>}
    <section className="circulars-log"><header><div><span>سجل متتابع</span><h3>سجل التعاميم والتوقيعات</h3><p>اضغط على أي صف لعرض تفاصيله. عند فتح تعميم آخر تُغلق التفاصيل السابقة تلقائيًا.</p></div></header>{!circulars.length ? <p className="teacher-empty">لا توجد تعاميم حتى الآن.</p> : <div className="circulars-list">{circulars.map(row => <article key={row.id} className={openId === row.id ? 'open' : ''}><button type="button" className="circular-summary" onClick={() => void openCircular(row.id)}><span className="circular-summary-icon">{row.fileType === 'application/pdf' ? <FileText size={20} /> : <Image size={20} />}</span><div><strong>{row.title}</strong><small>{formatHijriDate(row.circularDate)} · {row.fileName}</small></div><div className="circular-counts"><span>المعلمون {row.recipients}</span><b>{row.signed} وقّعوا</b><em>{row.pending} بانتظار التوقيع</em></div>{openId === row.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}</button>{openId === row.id && <div className="circular-detail">{busy === `open-${row.id}` || !detail ? <p className="teacher-empty">جارٍ تحميل تفاصيل التعميم…</p> : <CircularDetail detail={detail} generating={busy === 'generate'} onGenerate={() => void generateRecipients()} onSend={recipient => void sendRecipient(recipient)} busy={busy} onPrint={() => { void circularReport([detail], schoolName).catch(() => window.alert('تعذر تجهيز التعميم كاملاً للطباعة. تحقق من الملف ثم أعد المحاولة.')) }} />}</div>}</article>)}</div>}</section>
  </section>
}

function CircularDetail({ detail, generating, onGenerate, onSend, busy, onPrint }: { detail: SchoolCircularDetail; generating: boolean; onGenerate: () => void; onSend: (recipient: CircularRecipient) => void; busy: string; onPrint: () => void }) {
  const { circular, recipients } = detail
  return <><div className="circular-detail-actions"><button type="button" className="primary-button" onClick={onGenerate} disabled={generating}><Users size={17} />{generating ? 'جارٍ إنشاء الروابط…' : recipients.length ? 'مراجعة روابط المعلمين' : 'إنشاء روابط المعلمين'}</button><button type="button" className="outline-button" onClick={onPrint}><Printer size={16} /> طباعة هذا التعميم</button></div><section className="circular-attachment-preview"><header><strong>مرفق التعميم</strong><small>{circular.fileName}</small></header>{circular.fileType === 'application/pdf' ? <object data={circular.fileData} type="application/pdf">يتعذر عرض PDF في هذا المتصفح.</object> : <img src={circular.fileData} alt={`تعميم: ${circular.title}`} />}</section>{recipients.length > 0 && <div className="circular-recipients"><header><strong>المعلمون ({recipients.length})</strong><span>وقّع {recipients.filter(item => item.status === 'signed').length} · بانتظار {recipients.filter(item => item.status === 'pending').length}</span></header>{recipients.map(recipient => { const state = status(recipient); return <article key={recipient.id}><div><strong>{recipient.teacherName}</strong><small dir="ltr">{recipient.teacherPhone || 'لا يوجد رقم جوال'}</small></div><span className={`circular-recipient-status ${state.tone}`}>{state.label}</span><time>{recipient.signedAt ? `وقّع: ${recipient.signedAt}` : recipient.sentAt ? `أرسل: ${recipient.sentAt}` : 'لم يُرسل بعد'}</time>{recipient.status === 'signed' && recipient.signatureData ? <img src={recipient.signatureData} alt="توقيع المعلم" /> : <button type="button" className="outline-button" onClick={() => onSend(recipient)} disabled={!validWhatsApp(recipient.teacherPhone) || busy === `send-${recipient.id}`}><Send size={15} />{busy === `send-${recipient.id}` ? 'جارٍ التجهيز…' : 'إرسال واتساب'}</button>}</article> })}</div>}</>
}
