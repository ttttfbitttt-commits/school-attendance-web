import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ClipboardList, ExternalLink, MessageCircle, Printer, RefreshCw, Search, UserRound } from 'lucide-react'
import { api, type StudentExcuseReason, type StudentExcuseRequest, type StudentExcuseStudent } from './api'
import { formatHijriDate } from './dateUtils'
import { brandReportHtmlDocument, installReportPdfDownload } from './SchoolFeatures'

const REASONS: Array<{ value: StudentExcuseReason; label: string }> = [
  { value: 'health_condition', label: 'ظرف صحي' },
  { value: 'family_condition', label: 'ظرف عائلي' },
  { value: 'medical_appointment', label: 'موعد صحي' },
  { value: 'government_appointment', label: 'موعد حكومي' },
  { value: 'exam', label: 'اختبار' },
  { value: 'job_interview', label: 'مقابلة عمل' },
  { value: 'national_mission', label: 'مهمة وطنية' },
]

const statusLabel: Record<StudentExcuseRequest['status'], string> = { pending: 'تحت الإجراء', approved: 'تمت الموافقة', rejected: 'تم الرفض' }
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
const dateNow = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())

function whatsappPhone(value: string) {
  let number = value.replace(/\D/g, '')
  if (number.startsWith('00966')) number = number.slice(2)
  if (number.startsWith('05') && number.length === 10) number = `966${number.slice(1)}`
  if (number.startsWith('5') && number.length === 9) number = `966${number}`
  return number.startsWith('966') && number.length >= 11 ? number : ''
}

function studentExcuseReport(rows: StudentExcuseRequest[], schoolName: string) {
  const tableRows = rows.map(item => `<tr>
    <td>${esc(formatHijriDate(item.requestDate))}</td><td>${esc(item.studentName)}</td><td>${esc(`${item.grade} / ${item.classroom}`)}</td>
    <td>${esc(item.reasonLabel)}</td><td>${esc(statusLabel[item.status])}</td>
    <td>${esc(item.sentByName || item.createdByName || 'لم يُرسل')}</td><td>${esc(item.sentAt || '—')}</td>
    <td>${item.signatureData ? `<img class="signature" src="${item.signatureData}" alt="توقيع ولي الأمر" />` : '—'}</td>
  </tr>`).join('')
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>سجل استئذان الطلاب</title><style>
    @page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial;color:#143d45;margin:0}.head{text-align:center;border-bottom:3px solid #078376;padding-bottom:10px}.head h1{margin:5px;font-size:22px}.meta{display:flex;justify-content:space-between;margin:11px 0;font-size:12px}table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border:1px solid #a8c7c0;padding:6px;text-align:right;vertical-align:middle}th{background:#075a62;color:#fff}.signature{width:85px;height:28px;object-fit:contain}.actions{position:sticky;top:0;background:#075a62;padding:8px;display:flex;gap:8px}.actions button{border:0;border-radius:7px;padding:9px 14px;cursor:pointer}@media print{.actions{display:none}}
  </style></head><body><div class="actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div><div class="head"><h1>سجل استئذان الطلاب</h1><strong>${esc(schoolName)}</strong></div><div class="meta"><span>عدد الطلبات: ${rows.length}</span><span>تاريخ الاستخراج: ${esc(formatHijriDate(new Date()))}</span></div><table><thead><tr><th>التاريخ</th><th>الطالب</th><th>الصف / الفصل</th><th>السبب</th><th>الحالة</th><th>مرسل الرابط</th><th>وقت الإرسال</th><th>توقيع ولي الأمر</th></tr></thead><tbody>${tableRows}</tbody></table></body></html>`
  const popup = window.open('', '_blank')
  if (!popup) return false
  const objectUrl = URL.createObjectURL(new Blob([brandReportHtmlDocument(html, schoolName)], { type: 'text/html;charset=utf-8' }))
  popup.onload = () => installReportPdfDownload(popup.document, 'سجل استئذان الطلاب', 'landscape')
  popup.location.href = objectUrl
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 600000)
  return true
}

export function StudentExcuseCenter({ schoolName }: { schoolName: string }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StudentExcuseStudent[]>([])
  const [selected, setSelected] = useState<StudentExcuseStudent | null>(null)
  const [reason, setReason] = useState<StudentExcuseReason>('health_condition')
  const [requestDate, setRequestDate] = useState(dateNow)
  const [requests, setRequests] = useState<StudentExcuseRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [gradeFilter, setGradeFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [whatsappFallback, setWhatsappFallback] = useState<{ url: string; phone: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setRequests((await api.studentExcuseRequests()).requests) }
    catch { setError('تعذر تحميل سجل الاستئذان. حدّث الصفحة ثم أعد المحاولة.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    void load()
    const refresh = window.setInterval(() => { void load() }, 30000)
    return () => window.clearInterval(refresh)
  }, [load])

  useEffect(() => {
    const value = query.trim()
    if (value.length < 2) { setResults([]); return }
    const timer = window.setTimeout(() => {
      void api.searchStudentExcuseStudents(value).then(result => setResults(result.students)).catch(() => setResults([]))
    }, 230)
    return () => window.clearTimeout(timer)
  }, [query])

  const grades = useMemo(() => [...new Set(requests.map(row => row.grade).filter(Boolean))].sort(), [requests])
  const classrooms = useMemo(() => [...new Set(requests.filter(row => !gradeFilter || row.grade === gradeFilter).map(row => row.classroom).filter(Boolean))].sort(), [requests, gradeFilter])
  const filtered = useMemo(() => {
    const term = filter.trim()
    return requests.filter(row => (!gradeFilter || row.grade === gradeFilter) && (!classFilter || row.classroom === classFilter) && (!term || `${row.studentName} ${row.grade} ${row.classroom} ${row.reasonLabel} ${row.createdByName} ${row.sentByName}`.includes(term)))
  }, [requests, filter, gradeFilter, classFilter])

  const createAndSend = async () => {
    if (!selected) { setError('ابحث عن الطالب ثم اختر اسمه أولًا.'); return }
    const phone = whatsappPhone(selected.phone)
    if (!phone) { setError('لا يوجد رقم جوال صالح لولي أمر هذا الطالب. حدّث رقم الجوال من بيانات الطلاب أولًا.'); return }
    setSending(true); setError(''); setNotice(''); setWhatsappFallback(null)
    const whatsappTab = window.open('about:blank', '_blank')
    if (whatsappTab) {
      whatsappTab.document.title = 'تجهيز رسالة واتساب'
      whatsappTab.document.body.innerHTML = '<main dir="rtl" style="font-family:Tahoma,Arial;padding:32px;text-align:center;color:#075a62">جارٍ تجهيز رسالة واتساب لولي الأمر…</main>'
    }
    try {
      const created = await api.createStudentExcuse({ studentId: selected.id, reason, requestDate })
      const marked = await api.markStudentExcuseSent(created.request.id)
      setRequests(current => [marked.request, ...current.filter(row => row.id !== marked.request.id)])
      const message = `ولي أمر الطالب/ـة ${selected.name}\nطلب استئذان بتاريخ ${requestDate} بسبب: ${REASONS.find(item => item.value === reason)?.label || ''}\nيرجى فتح الرابط للتوقيع واختيار الموافقة أو الرفض:\n${created.link}`
      const target = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      if (whatsappTab) whatsappTab.location.replace(target)
      else window.open(target, '_blank')
      setWhatsappFallback({ url: target, phone })
      setNotice(`تم تجهيز الرابط وتوثيق إرسالِه باسم المستخدم. سيفتح واتساب لرقم ولي الأمر.`)
      setSelected(null); setQuery(''); setResults([])
    } catch (caught: any) {
      whatsappTab?.close()
      const code = String(caught?.code || caught?.message || '')
      setError(code === 'guardian_phone_missing' ? 'لا يوجد رقم جوال لولي الأمر لهذا الطالب.' : 'تعذر تجهيز رابط الاستئذان. أعد المحاولة.')
    } finally { setSending(false) }
  }

  return <section className="student-excuses" dir="rtl">
    <header className="student-excuses-heading"><div><span>توثيق إلكتروني</span><h2>استئذان الطلاب</h2><p>أرسل لولي الأمر رابطًا لا يحتاج إلى تسجيل دخول؛ يختار الموافقة أو الرفض ويوقّع داخل الرابط، ثم يُحدَّث السجل تلقائيًا.</p></div><ClipboardList size={36} /></header>
    <section className="student-excuse-create">
      <header><div><UserRound size={22} /><div><h3>إصدار طلب استئذان</h3><p>ابحث بالاسم الأول أو الأخير أو أي جزء من اسم الطالب.</p></div></div></header>
      <div className="student-excuse-search"><label>البحث عن الطالب<input value={query} onChange={event => { setQuery(event.target.value); setSelected(null) }} placeholder="مثال: محمد، العتيبي، أو جزء من الاسم" /></label><Search size={19} /></div>
      {results.length > 0 && <div className="student-excuse-results">{results.map(student => <button key={student.id} type="button" onClick={() => { setSelected(student); setQuery(student.name); setResults([]) }}><strong>{student.name}</strong><span>{student.grade} · الفصل {student.classroom}</span><small dir="ltr">{student.phone || 'لا يوجد رقم جوال'}</small></button>)}</div>}
      {selected && <div className="student-excuse-selected"><CheckCircle2 size={20} /><div><strong>{selected.name}</strong><span>{selected.grade} · الفصل {selected.classroom} · <b dir="ltr">{selected.phone || 'لا يوجد رقم جوال'}</b></span></div></div>}
      <div className="student-excuse-options"><label>سبب الاستئذان<select value={reason} onChange={event => setReason(event.target.value as StudentExcuseReason)}>{REASONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>تاريخ الاستئذان<input type="date" value={requestDate} onChange={event => setRequestDate(event.target.value)} /></label><button type="button" className="primary-button" onClick={() => void createAndSend()} disabled={sending}><MessageCircle size={18} />{sending ? 'جارٍ تجهيز الرابط…' : 'إرسال رابط عبر واتساب'}</button></div>
      {notice && <p className="teacher-notice success">{notice}</p>}{whatsappFallback && <a className="student-excuse-whatsapp-fallback" href={whatsappFallback.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />لم يفتح واتساب؟ افتحه الآن للرقم {whatsappFallback.phone}</a>}{error && <p className="teacher-notice error">{error}</p>}
    </section>
    <section className="student-excuse-log">
      <header><div><span>سجل موثق</span><h3>سجل الاستئذان</h3><p>يوثق اسم المستخدم الذي أرسل الرابط ووقت الإرسال، مع نتيجة وتوقيع ولي الأمر.</p></div><div className="student-excuse-actions"><button type="button" className="outline-button" onClick={() => studentExcuseReport(filtered, schoolName)} disabled={!filtered.length}><Printer size={16} /> طباعة PDF</button><button type="button" className="outline-button" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> تحديث</button></div></header>
      <div className="student-excuse-filters"><label><Search size={16} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="بحث بالطالب أو المستخدم أو السبب" /></label><select value={gradeFilter} onChange={event => { setGradeFilter(event.target.value); setClassFilter('') }}><option value="">كل الصفوف</option>{grades.map(grade => <option key={grade} value={grade}>{grade}</option>)}</select><select value={classFilter} onChange={event => setClassFilter(event.target.value)}><option value="">كل الفصول</option>{classrooms.map(classroom => <option key={classroom} value={classroom}>{classroom}</option>)}</select></div>
      {loading ? <p className="teacher-empty">جارٍ تحميل السجل…</p> : !filtered.length ? <p className="teacher-empty">لا توجد طلبات استئذان مطابقة.</p> : <div className="student-excuse-table-wrap"><table><thead><tr><th>الطالب</th><th>الصف / الفصل</th><th>السبب</th><th>التاريخ</th><th>الحالة</th><th>مرسل الرابط</th><th>وقت الإرسال</th><th>توقيع ولي الأمر</th></tr></thead><tbody>{filtered.map(item => <tr key={item.id}><td><strong>{item.studentName}</strong><small dir="ltr">{item.guardianPhone}</small></td><td>{item.grade}<br />{item.classroom}</td><td>{item.reasonLabel}</td><td>{formatHijriDate(item.requestDate)}</td><td><span className={`student-excuse-status ${item.status}`}>{statusLabel[item.status]}</span></td><td>{item.sentByName || item.createdByName || 'لم يُرسل'}</td><td>{item.sentAt || '—'}</td><td>{item.signatureData ? <img className="student-excuse-signature" src={item.signatureData} alt="توقيع ولي الأمر" /> : '—'}</td></tr>)}</tbody></table></div>}
    </section>
  </section>
}
