import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { CheckCircle2, Download, FileText, Mail, Printer, RefreshCw, Save, Send, ShieldCheck, Trash2 } from 'lucide-react'
import { api, type AbsenceDetails, type AbsenceReport, type AbsenceRow, type AbsenceStatus, type MessageLog } from './api'

export type FeatureStudent = { id: string; name: string; phone: string; grade: string; classroom: string }
export type FeatureAttendance = { studentId: string; status: 'present' | 'late' }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const monthStart = () => `${today().slice(0, 8)}01`
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character))
const maskPhone = (phone: string) => phone.length > 4 ? `${phone.slice(0, 3)}••••${phone.slice(-3)}` : phone
const formatDateTime = (value: string) => new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(value))

function openPrintDocument(title: string, contents: string) {
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{font-family:Tahoma,Arial,sans-serif;color:#172033;margin:24px;background:#fff;direction:rtl}.page{box-sizing:border-box;min-height:250mm;padding:28mm 22mm;page-break-after:always;border:1px solid #dbe3ed}.page:last-child{page-break-after:auto}h1{font-size:25px;color:#163b65;margin:0 0 26px;text-align:center}.heading{color:#334155;line-height:2;font-size:17px}.notice{padding:18px;border-radius:12px;background:#f8fafc;border-right:7px solid #eab308;margin-top:22px}.notice.orange{border-color:#f97316}.notice.red{border-color:#dc2626}.notice.excuse{border-color:#86efac;background:#f0fdf4}.label{font-weight:700;color:#0f3d67}.meta{margin-top:28px;color:#64748b;font-size:12px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:right}th{background:#eaf2fb;color:#123b63}.green{background:#dcfce7}.yellow{background:#fef9c3}.orange{background:#ffedd5}.red{background:#fee2e2}@media print{body{margin:0}.page{border:0}}
  </style></head><body>${contents}<script>window.onload=()=>window.print()<\/script></body></html>`)
  popup.document.close()
  return true
}

function downloadWorkbook(name: string, rows: Array<Array<string | number>>, sheetName = 'تقرير') {
  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = rows[0]?.map(() => ({ wch: 24 })) || []
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  XLSX.writeFile(workbook, `${name}.xlsx`)
}

export function AlmadarSettings({ schoolName }: { schoolName: string }) {
  const [configured, setConfigured] = useState(false)
  const [senderName, setSenderName] = useState(schoolName)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [notice, setNotice] = useState('')
  const [balance, setBalance] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const load = () => {
    void api.almadar().then(({ account }) => {
      setConfigured(account.configured)
      setSenderName(account.senderName || schoolName)
      setBalance(account.lastBalance ?? null)
    }).catch(() => setNotice('تعذر تحميل إعداد حساب المدار التقني.'))
  }

  useEffect(load, [schoolName])

  const save = async () => {
    if (!configured && (!username.trim() || !password || !apiKey.trim())) {
      setNotice('أدخل اسم المستخدم وكلمة المرور ومفتاح API قبل الحفظ.')
      return
    }
    if (!senderName.trim()) { setNotice('أدخل اسم المرسل المعتمد في المدار التقني.'); return }
    setBusy(true)
    try {
      await api.saveAlmadar({ username, password, apiKey, senderName: senderName.trim() })
      setNotice('تم حفظ بيانات حساب المدار التقني بشكل مشفر.')
      load()
    } catch { setNotice('تعذر حفظ الحساب. تحقق من البيانات ثم أعد المحاولة.') } finally { setBusy(false) }
  }

  const verify = async () => {
    setBusy(true)
    try {
      const result = await api.verifyAlmadar()
      const nextBalance = result.balance === null ? 'غير متوفر' : String(result.balance)
      setBalance(nextBalance)
      setNotice(`تم الاتصال بالمدار التقني بنجاح. رصيد الرسائل المتبقي: ${nextBalance}`)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setNotice(
        code === 'provider_unreachable'
          ? 'تعذر الوصول إلى خادم المدار التقني من خادم الموقع. أعد المحاولة بعد التحقق من الاتصال.'
          : code === 'api_key_not_authorized'
            ? 'رفض المدار التقني مفتاح API لهذا الحساب. تحقق من المفتاح في لوحة المدار.'
            : 'تعذر التحقق من حساب المدار التقني. أعد المحاولة بعد التأكد من البيانات.'
      )
    } finally { setBusy(false) }
  }

  return <section className="panel almadar-settings-panel">
    <div className="panel-header">
      <div><span className="panel-kicker">الرسائل النصية</span><h2>إعداد حساب المدار التقني</h2><p>لكل مدرسة حساب مستقل. لا تعاد كلمة المرور أو مفتاح API إلى المتصفح بعد الحفظ.</p></div>
      <div className="feature-actions"><button type="button" className="primary-button" onClick={() => setIsOpen(current => !current)}><ShieldCheck size={16} /> إعداد حساب المدار التقني</button>{configured && <span className="status-chip success"><CheckCircle2 size={15} /> الحساب محفوظ</span>}</div>
    </div>
    {isOpen && <><div className="school-settings-grid">
      <label className="school-settings-field">اسم المستخدم<input name="almadar-username" autoComplete="off" data-lpignore="true" data-1p-ignore="true" value={username} onChange={event => setUsername(event.target.value)} placeholder={configured ? 'اتركه فارغاً للإبقاء على القيمة المحفوظة' : 'اسم المستخدم'} /></label>
      <label className="school-settings-field">كلمة المرور<input name="almadar-password" autoComplete="off" data-lpignore="true" data-1p-ignore="true" className="credential-secret" value={password} onChange={event => setPassword(event.target.value)} placeholder={configured ? 'اتركها فارغة للإبقاء على القيمة المحفوظة' : 'كلمة المرور'} /></label>
      <label className="school-settings-field">مفتاح API<input name="almadar-api-key" autoComplete="off" data-lpignore="true" data-1p-ignore="true" className="credential-secret" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={configured ? 'اتركه فارغاً للإبقاء على القيمة المحفوظة' : 'مفتاح API'} /></label>
      <label className="school-settings-field">اسم المرسل<input name="almadar-sender-name" autoComplete="off" value={senderName} onChange={event => setSenderName(event.target.value)} placeholder="اسم المرسل المعتمد" /></label>
    </div>
    <div className="feature-actions">
      <button className="primary-button" type="button" onClick={() => void save()} disabled={busy}><Save size={16} /> حفظ الحساب</button>
      <button className="secondary-button" type="button" onClick={() => void verify()} disabled={busy || !configured}><RefreshCw size={16} /> التحقق من الاتصال</button>
      {configured && balance !== null && <span className="status-chip success"><CheckCircle2 size={15} /> الرصيد الأخير: {balance}</span>}
    </div>
    {notice && <div className="notice-box settings-notice" role="status">{notice}</div>}</>}
  </section>
}

export function MessageCenter({ students, attendance }: { students: FeatureStudent[]; attendance: FeatureAttendance[] }) {
  const [accountReady, setAccountReady] = useState(false)
  const [type, setType] = useState<'late' | 'absence' | 'general'>('general')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [logs, setLogs] = useState<MessageLog[]>([])
  const [confirmedAbsenceIds, setConfirmedAbsenceIds] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)

  const load = () => {
    void Promise.all([api.almadar(), api.messages(), api.absenceReport(today(), today())]).then(([account, history, absenceReport]) => {
      setAccountReady(account.account.configured)
      setLogs(history.messages)
      const absenceIds = absenceReport.rows
        .map(row => row.studentId || row.id)
        .filter((id): id is string => Boolean(id))
      setConfirmedAbsenceIds(new Set(absenceIds))
    }).catch(() => setNotice('تعذر تحميل حالة الرسائل.'))
  }
  useEffect(load, [])

  const lateIds = useMemo(() => new Set(attendance.filter(record => record.status === 'late').map(record => record.studentId)), [attendance])
  const candidates = useMemo(() => students.filter(student => {
    if (type === 'late' && !lateIds.has(student.id)) return false
    if (type === 'absence' && !confirmedAbsenceIds.has(student.id)) return false
    const query = search.trim().toLowerCase()
    return !query || `${student.name} ${student.id} ${student.grade} ${student.classroom}`.toLowerCase().includes(query)
  }), [students, type, lateIds, confirmedAbsenceIds, search])

  const toggle = (studentId: string) => setSelected(current => {
    const next = new Set(current)
    next.has(studentId) ? next.delete(studentId) : next.add(studentId)
    return next
  })
  const chooseType = (nextType: 'late' | 'absence' | 'general') => { setType(nextType); setSelected(new Set()); setMessage('') }

  const send = async () => {
    if (!accountReady) { setNotice('أكمل إعداد حساب المدار التقني وتحقق من الاتصال أولاً.'); return }
    if (!selected.size) { setNotice('اختر طالباً واحداً على الأقل.'); return }
    if (type === 'general' && !message.trim()) { setNotice('اكتب نص الرسالة العامة.'); return }
    if (!window.confirm(`سيتم إرسال ${selected.size} رسالة. هل تريد المتابعة؟`)) return
    setSending(true)
    try {
      const result = await api.sendMessages({ studentIds: [...selected], type, message: type === 'general' ? message.trim() : undefined })
      setNotice(`اكتمل الإرسال: ${result.sent} ناجحة، ${result.failed} فاشلة.`)
      setSelected(new Set())
      load()
    } catch { setNotice('تعذر إتمام الإرسال. راجع سجل الرسائل أو تحقق من حساب المدار التقني.') } finally { setSending(false) }
  }

  return <section className="feature-page">
    <section className="panel feature-intro"><div><span className="panel-kicker">المدار التقني</span><h2>الرسائل النصية</h2><p>اختر الطلاب، راجع النوع، ثم أرسل. رسائل الغياب والتأخر تنشأ تلقائياً باسم الطالب والمدرسة.</p></div><Mail size={34} /></section>
    <section className="panel message-compose-panel">
      <div className="message-type-tabs">
        <button className={type === 'general' ? 'active' : ''} onClick={() => chooseType('general')} type="button">رسالة عامة</button>
        <button className={type === 'late' ? 'active' : ''} onClick={() => chooseType('late')} type="button">رسائل التأخر اليوم</button>
        <button className={type === 'absence' ? 'active' : ''} onClick={() => chooseType('absence')} type="button">رسائل الغياب اليوم</button>
      </div>
      {type === 'general' ? <label className="message-body-field">نص الرسالة<textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="اكتب الرسالة التي سترسل للطلاب المحددين..." maxLength={1200} /></label> : <div className="automatic-message-note">سيُنشأ النص تلقائياً لكل طالب بحسب {type === 'late' ? 'وقت تأخره' : 'غيابه'} اليوم، ويتضمن اسمه واسم المدرسة.</div>}
      <div className="feature-toolbar"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث عن طالب بالاسم أو الرقم..." /><button type="button" className="secondary-button" onClick={() => setSelected(new Set(candidates.map(student => student.id)))}>تحديد الظاهرين ({candidates.length})</button><button type="button" className="primary-button" onClick={() => void send()} disabled={sending || !selected.size}><Send size={16} /> إرسال إلى {selected.size}</button></div>
      <div className="table-wrap"><table className="feature-table"><thead><tr><th>اختيار</th><th>الطالب</th><th>الصف والفصل</th><th>الجوال</th></tr></thead><tbody>{candidates.map(student => <tr key={student.id}><td><input type="checkbox" checked={selected.has(student.id)} onChange={() => toggle(student.id)} /></td><td><strong>{student.name}</strong><small>{student.id}</small></td><td>{student.grade || '—'} · {student.classroom || '—'}</td><td dir="ltr">{student.phone || '—'}</td></tr>)}{!candidates.length && <tr><td colSpan={4}>لا يوجد طلاب مناسبون لهذا النوع من الرسائل اليوم.</td></tr>}</tbody></table></div>
      {notice && <div className="notice-box" role="status">{notice}</div>}
    </section>
    <section className="panel"><div className="panel-header"><div><span className="panel-kicker">آخر 200 عملية</span><h2>سجل الرسائل</h2></div><button className="secondary-button" type="button" onClick={load}><RefreshCw size={16} /> تحديث السجل</button></div><div className="table-wrap"><table className="feature-table"><thead><tr><th>الوقت</th><th>الطالب</th><th>المستلم</th><th>النوع</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>{logs.map(log => <tr key={log.id}><td>{formatDateTime(log.createdAt)}</td><td>{log.studentName || '—'}</td><td dir="ltr">{maskPhone(log.recipient)}</td><td>{log.type === 'late' ? 'تأخر' : log.type === 'absence' ? 'غياب' : 'عامة'}</td><td><span className={`status-chip ${log.status === 'sent' ? 'success' : 'failed'}`}>{log.status === 'sent' ? 'تم الإرسال' : 'فشل'}</span></td><td>{log.errorDetail || log.body}</td></tr>)}{!logs.length && <tr><td colSpan={6}>لا يوجد إرسال مسجل حتى الآن.</td></tr>}</tbody></table></div></section>
  </section>
}

type SummaryStatus = AbsenceStatus | 'mixed'
type AbsenceSummaryRow = AbsenceRow & {
  studentId?: string
  unexcusedDays?: number
  excusedDays?: number
  specialDays?: number
  status?: SummaryStatus
}

function rowStudentId(row: AbsenceSummaryRow) {
  return row.studentId || row.id || ''
}

function summaryStatus(row: AbsenceSummaryRow): SummaryStatus {
  if (row.status === 'unexcused' || row.status === 'excused' || row.status === 'special' || row.status === 'mixed') return row.status
  return row.hasExcuse ? 'excused' : 'unexcused'
}

function statusText(status: SummaryStatus) {
  return status === 'excused' ? 'بعذر' : status === 'special' ? 'ظرف خاص' : status === 'mixed' ? 'مختلط' : 'بدون عذر'
}

function absenceTone(days: number) {
  return days >= 16 ? 'red' : days >= 11 ? 'orange' : days >= 6 ? 'yellow' : 'neutral'
}

export function ReportsCenter({ students, schoolName }: { students: FeatureStudent[]; schoolName: string }) {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [studentId, setStudentId] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [report, setReport] = useState<AbsenceReport | null>(null)
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [mutationBusy, setMutationBusy] = useState(false)
  const [details, setDetails] = useState<AbsenceDetails | null>(null)
  const [detailsBusy, setDetailsBusy] = useState(false)
  const [correction, setCorrection] = useState<null | { studentIds: string[]; from: string; to: string; dates?: string[]; label: string; irreversible?: boolean }>(null)
  const [correctionTime, setCorrectionTime] = useState('07:30')
  const [correctionStatus, setCorrectionStatus] = useState<'present' | 'late'>('present')

  const rows = useMemo(() => (report?.rows || []) as AbsenceSummaryRow[], [report])
  const filteredRows = useMemo(() => rows.filter(row => row.absenceDays > 0), [rows])
  const selectedRow = useMemo(() => studentId ? filteredRows.find(row => rowStudentId(row) === studentId) : undefined, [filteredRows, studentId])
  const studentMatches = useMemo(() => {
    const query = studentSearch.trim().toLocaleLowerCase('ar')
    if (!query || studentId) return []
    return students.filter(student => `${student.name} ${student.id} ${student.grade} ${student.classroom}`.toLocaleLowerCase('ar').includes(query)).slice(0, 8)
  }, [students, studentId, studentSearch])

  const yellow = useMemo(() => filteredRows.filter(row => row.absenceDays >= 6 && row.absenceDays <= 10), [filteredRows])
  const orange = useMemo(() => filteredRows.filter(row => row.absenceDays >= 11 && row.absenceDays <= 15), [filteredRows])
  const red = useMemo(() => filteredRows.filter(row => row.absenceDays >= 16), [filteredRows])
  const categories: Array<{ label: string; rows: AbsenceSummaryRow[]; tone: 'yellow' | 'orange' | 'red'; fileName: string }> = [
    { label: 'من 6 إلى 10 أيام', rows: yellow, tone: 'yellow', fileName: 'غياب_6_إلى_10_أيام' },
    { label: 'من 11 إلى 15 يومًا', rows: orange, tone: 'orange', fileName: 'غياب_11_إلى_15_يومًا' },
    { label: '16 يومًا فأكثر', rows: red, tone: 'red', fileName: 'غياب_16_يومًا_فأكثر' },
  ]

  const fetchReport = async () => {
    const next = await api.absenceReport(from, to, studentId)
    setReport(next)
    return next
  }

  const loadReport = async () => {
    if (!from || !to || from > to) {
      setNotice('اختر فترة زمنية صحيحة للتقرير.')
      return
    }
    setBusy(true)
    try {
      await fetchReport()
      setNotice('')
    } catch {
      setNotice('تعذر إعداد تقرير الغياب. اختر فترة لا تزيد عن سنة ثم أعد المحاولة.')
    } finally {
      setBusy(false)
    }
  }

  const chooseReportStudent = (student: FeatureStudent) => {
    setStudentId(student.id)
    setStudentSearch(student.name)
    setReport(null)
  }

  const clearReportStudent = () => {
    setStudentId('')
    setStudentSearch('')
    setReport(null)
  }

  const calculateToday = async () => {
    const date = today()
    if (!window.confirm(`سيُحتسب غياب الطلاب غير المسجلين كحاضرين أو متأخرين في ${date}. لن يُسجل غياب جديد قبل ضغط هذا الزر. هل تريد المتابعة؟`)) return
    setMutationBusy(true)
    try {
      await api.calculateAbsences(date)
      if (from <= date && to >= date) await fetchReport()
      setNotice('تم احتساب غياب اليوم. يمكن الآن تعديل حالة أي يوم أو تصحيح الحضور.')
    } catch {
      setNotice('تعذر احتساب غياب اليوم. تأكد من إعداد سجل الحضور ثم أعد المحاولة.')
    } finally {
      setMutationBusy(false)
    }
  }

  const applyStatus = async (studentIds: string[], status: AbsenceStatus, options?: { dates?: string[]; label?: string; note?: string }) => {
    if (!studentIds.length) return
    setMutationBusy(true)
    try {
      const targetDates = options?.dates || []
      const rangeFrom = targetDates[0] || from
      const rangeTo = targetDates[targetDates.length - 1] || to
      await api.setAbsenceStatus({ studentIds, from: rangeFrom, to: rangeTo, status, note: options?.note })
      await fetchReport()
      if (details && studentIds.includes(details.student.studentId)) {
        const refreshed = await api.absenceDetails(details.student.studentId, from, to)
        setDetails(refreshed)
      }
      setNotice(`تم تغيير الحالة إلى ${statusText(status)}${options?.label ? ` لـ ${options.label}` : ''}.`)
    } catch {
      setNotice('تعذر حفظ حالة الغياب. أعد المحاولة.')
    } finally {
      setMutationBusy(false)
    }
  }

  const applyVisibleStatus = async (status: AbsenceStatus) => {
    if (!filteredRows.length) return
    const label = status === 'excused' ? 'بعذر' : 'بدون عذر'
    if (!window.confirm(`سيُطبّق خيار ${label} على ${filteredRows.length} طالبًا وعلى أيام غيابهم ضمن الفترة المحددة. هل تريد المتابعة؟`)) return
    await applyStatus(filteredRows.map(rowStudentId), status, { label: 'الطلاب الظاهرين' })
  }

  const openDetails = async (row: AbsenceSummaryRow) => {
    setDetailsBusy(true)
    try {
      const result = await api.absenceDetails(rowStudentId(row), from, to)
      setDetails(result)
    } catch {
      setNotice('تعذر تحميل أيام غياب الطالب.')
    } finally {
      setDetailsBusy(false)
    }
  }

  const openCorrection = (studentIds: string[], correctionFrom: string, correctionTo: string, label: string, dates?: string[], irreversible = false) => {
    setCorrection({ studentIds, from: correctionFrom, to: correctionTo, dates, label, irreversible })
    setCorrectionTime('07:30')
    setCorrectionStatus('present')
  }

  const saveCorrection = async () => {
    if (!correction) return
    setMutationBusy(true)
    try {
      const { studentIds, from: correctionFrom, to: correctionTo, dates } = correction
      await api.correctAbsences({ studentIds, from: correctionFrom, to: correctionTo, dates, time: correctionTime, status: correctionStatus })
      setCorrection(null)
      if (details) {
        const refreshed = await api.absenceDetails(details.student.studentId, from, to)
        setDetails(refreshed)
      }
      await fetchReport()
      setNotice('تم تصحيح الحضور وحذف الغياب من التقرير.')
    } catch {
      setNotice('تعذر تصحيح الحضور. أعد المحاولة.')
    } finally {
      setMutationBusy(false)
    }
  }

  const exportPhones = () => downloadWorkbook('تقرير_هواتف_الطلاب', [['اسم الطالب', 'رقم الجوال'], ...students.map(student => [student.name, student.phone])], 'هواتف الطلاب')
  const printPhones = () => openPrintDocument('تقرير هواتف الطلاب', `<section class="page"><h1>تقرير هواتف الطلاب</h1><table><thead><tr><th>اسم الطالب</th><th>رقم الجوال</th></tr></thead><tbody>${students.map(student => `<tr><td>${escapeHtml(student.name)}</td><td dir="ltr">${escapeHtml(student.phone)}</td></tr>`).join('')}</tbody></table><p class="meta">${escapeHtml(schoolName)} · ${today()}</p></section>`)

  const exportSummary = (exportRows: AbsenceSummaryRow[], name: string) => downloadWorkbook(name, [
    ['اسم الطالب', 'الصف', 'الفصل', 'إجمالي الغياب', 'بدون عذر', 'بعذر', 'ظرف خاص', 'الحالة'],
    ...exportRows.map(row => [row.name, row.grade, row.classroom, row.absenceDays, row.unexcusedDays || 0, row.excusedDays || 0, row.specialDays || 0, statusText(summaryStatus(row))]),
  ], 'ملخص الغياب')

  const printSummary = (printRows: AbsenceSummaryRow[], title: string) => {
    if (!printRows.length) {
      setNotice('لا يوجد طلاب في هذه الفئة.')
      return
    }
    openPrintDocument(title, printRows.map(row => {
      const status = summaryStatus(row)
      const tone = absenceTone(row.absenceDays)
      const statusLine = status !== 'unexcused' ? `<p><span class="label">الحالة:</span> ${escapeHtml(statusText(status))}</p>` : ''
      return `<section class="page"><h1>تنبيه غياب متكرر</h1><div class="heading"><p>نفيدكم بأن الطالب <span class="label">${escapeHtml(row.name)}</span> من الصف <span class="label">${escapeHtml(row.grade || '—')}</span> والفصل <span class="label">${escapeHtml(row.classroom || '—')}</span> بلغ عدد أيام غيابه <span class="label">${row.absenceDays} يومًا</span> خلال الفترة من ${escapeHtml(from)} إلى ${escapeHtml(to)}.</p><div class="notice ${tone}">${statusLine}<p>نأمل متابعة انتظام الطالب في الدراسة والتواصل مع المدرسة عند الحاجة.</p></div><p class="meta">${escapeHtml(schoolName)} · تاريخ الطباعة: ${today()}</p></div></section>`
    }).join(''))
  }

  const detailStudentId = details?.student.studentId || ''
  const detailText = details ? `تنبيه غياب متكرر\nالطالب: ${details.student.name}\nالصف والفصل: ${details.student.grade || '—'} · ${details.student.classroom || '—'}\nعدد أيام الغياب: ${details.days.length}\nالتواريخ: ${details.days.map(day => `${day.date} (${statusText(day.status)})`).join('، ')}` : ''

  const exportDetails = () => {
    if (!details) return
    downloadWorkbook(`تفاصيل_غياب_${details.student.name}`, [
      ['اسم الطالب', details.student.name],
      ['الصف', details.student.grade || '—'],
      ['الفصل', details.student.classroom || '—'],
      [],
      ['التاريخ', 'الحالة', 'ملاحظات'],
      ...details.days.map(day => [day.date, statusText(day.status), day.note || '—']),
    ], 'تفاصيل الغياب')
  }

  const printDetails = () => {
    if (!details) return
    openPrintDocument(`تفاصيل غياب ${details.student.name}`, `<section class="page"><h1>تنبيه غياب متكرر</h1><div class="heading"><p>نفيدكم بأن الطالب <span class="label">${escapeHtml(details.student.name)}</span> من الصف <span class="label">${escapeHtml(details.student.grade || '—')}</span> والفصل <span class="label">${escapeHtml(details.student.classroom || '—')}</span> بلغ عدد أيام غيابه <span class="label">${details.days.length} يومًا</span> خلال الفترة من ${escapeHtml(from)} إلى ${escapeHtml(to)}.</p><div class="notice ${absenceTone(details.days.length)}"><p>نأمل متابعة انتظام الطالب في الدراسة والتواصل مع المدرسة عند الحاجة.</p></div><table><thead><tr><th>تاريخ الغياب</th><th>الحالة</th><th>ملاحظات</th></tr></thead><tbody>${details.days.map(day => `<tr><td>${escapeHtml(day.date)}</td><td>${escapeHtml(statusText(day.status))}</td><td>${escapeHtml(day.note || '—')}</td></tr>`).join('')}</tbody></table><p class="meta">${escapeHtml(schoolName)} · تاريخ الطباعة: ${today()}</p></div></section>`)
  }

  const copyDetailsText = async () => {
    if (!detailText) return
    try {
      await navigator.clipboard.writeText(detailText)
      setNotice('تم نسخ نص التقرير.')
    } catch {
      setNotice('تعذر نسخ النص من المتصفح.')
    }
  }

  return <section className="feature-page reports-center">
    <section className="panel feature-intro"><div><span className="panel-kicker">إدارة المدرسة</span><h2>التقارير</h2><p>لا يُنشأ الغياب تلقائيًا. استخدم زر احتساب غياب اليوم فقط بعد اكتمال تسجيل الحضور والتأخر.</p></div><FileText size={34} /></section>

    <section className="panel"><div className="panel-header"><div><span className="panel-kicker">بيانات الاتصال</span><h2>تقرير هواتف الطلاب</h2></div><div className="feature-actions"><button type="button" className="export-btn csv" onClick={exportPhones}><Download size={16} /> Excel</button><button type="button" className="export-btn pdf" onClick={printPhones}><Printer size={16} /> PDF</button></div></div><p className="feature-muted">يتضمن اسم الطالب ورقم الجوال فقط.</p></section>

    <section className="panel report-filter-panel">
      <div className="panel-header"><div><span className="panel-kicker">فترة الدراسة</span><h2>تقارير الغياب</h2><p className="feature-muted">كل طالب يظهر مرة واحدة، وتفاصيل أيامه متاحة من الزر داخل صفه.</p></div><button className="secondary-button calculate-absence-button" type="button" onClick={() => void calculateToday()} disabled={mutationBusy}><CheckCircle2 size={16} /> احتساب غياب اليوم</button></div>
      <div className="feature-toolbar report-filters">
        <label>من<input type="date" value={from} onChange={event => { setFrom(event.target.value); setReport(null) }} /></label>
        <label>إلى<input type="date" value={to} onChange={event => { setTo(event.target.value); setReport(null) }} /></label>
        <label className="report-student-search">طالب محدد<div className="student-search-box"><input value={studentSearch} onChange={event => { setStudentSearch(event.target.value); setStudentId(''); setReport(null) }} placeholder="اكتب اسم الطالب للبحث..." autoComplete="off" />{studentId && <button type="button" onClick={clearReportStudent} aria-label="إلغاء اختيار الطالب">×</button>}</div>{!studentId && studentSearch.trim() && <div className="student-search-results">{studentMatches.map(student => <button type="button" key={student.id} onClick={() => chooseReportStudent(student)}><strong>{student.name}</strong><small>{student.grade || '—'} · {student.classroom || '—'}</small></button>)}{!studentMatches.length && <span>لا يوجد طالب مطابق.</span>}</div>}</label>
        <button className="primary-button" type="button" onClick={() => void loadReport()} disabled={busy || mutationBusy}><RefreshCw size={16} /> إعداد التقرير</button>
      </div>
      {report && <p className="feature-muted">الطلاب ذوو الغياب المؤكد في الفترة: {filteredRows.length}.</p>}
      {notice && <div className="notice-box" role="status">{notice}</div>}
    </section>

    {report && <>
      <section className="panel absence-alerts-panel"><div className="panel-header"><div><span className="panel-kicker">تنبيهات الغياب</span><h2>الطلاب الغائبون أكثر من 5 أيام</h2><p>اللون يعبّر عن عدد أيام الغياب فقط، وحالة العذر تظهر بشكل مستقل.</p></div></div><div className="absence-category-grid">{categories.map(({ label, rows: categoryRows, tone, fileName }) => <article className={`absence-category ${tone}`} key={label}><h3>{label}</h3><strong>{categoryRows.length} طالب</strong><div><button type="button" className="export-btn csv" onClick={() => exportSummary(categoryRows, fileName)} disabled={!categoryRows.length}>Excel</button><button type="button" className="export-btn pdf" onClick={() => printSummary(categoryRows, label)} disabled={!categoryRows.length}>PDF</button></div></article>)}</div></section>

      <section className="panel absence-summary-panel">
        <div className="panel-header"><div><span className="panel-kicker">إدارة حالات الغياب</span><h2>{studentId && selectedRow ? `ملخص غياب ${selectedRow.name}` : 'ملخص غياب الطلاب'}</h2><p>الحالة الافتراضية هي بدون عذر. لتعديل كل أيام الطالب استخدم الحالة، ولتعديل يوم محدد افتح التفاصيل.</p></div><div className="feature-actions report-bulk-actions"><button type="button" className="secondary-button" onClick={() => void applyVisibleStatus('excused')} disabled={!filteredRows.length || mutationBusy}>اعتبار الظاهرين بعذر</button><button type="button" className="secondary-button" onClick={() => void applyVisibleStatus('unexcused')} disabled={!filteredRows.length || mutationBusy}>اعتبار الظاهرين بدون عذر</button><button type="button" className="danger-button" onClick={() => openCorrection(filteredRows.map(rowStudentId), from, to, 'كل الطلاب الظاهرين في الفترة', undefined, true)} disabled={!filteredRows.length || mutationBusy}><Trash2 size={16} /> حذف غياب جميع الطلاب</button></div></div>
        {!filteredRows.length ? <div className="report-empty-state">لا توجد حالات غياب مؤكدة ضمن الفترة المختارة. استخدم «احتساب غياب اليوم» عند الحاجة.</div> : <>
          <div className="table-wrap report-summary-table"><table className="feature-table"><thead><tr><th>الطالب</th><th>الصف والفصل</th><th>أيام الغياب</th><th>الحالة</th><th>التفاصيل</th><th>تصحيح</th></tr></thead><tbody>{filteredRows.map(row => <tr className={absenceTone(row.absenceDays)} key={rowStudentId(row)}><td><strong>{row.name}</strong></td><td>{row.grade || '—'} · {row.classroom || '—'}</td><td><strong>{row.absenceDays}</strong><small>بدون عذر: {row.unexcusedDays || 0} · بعذر: {row.excusedDays || 0} · ظرف: {row.specialDays || 0}</small></td><td><select className="absence-status-select" value={summaryStatus(row)} onChange={event => void applyStatus([rowStudentId(row)], event.target.value as AbsenceStatus, { label: row.name })} disabled={mutationBusy}><option value="unexcused">بدون عذر</option><option value="excused">بعذر</option><option value="special">ظرف خاص</option>{summaryStatus(row) === 'mixed' && <option value="mixed" disabled>مختلط — راجع التفاصيل</option>}</select></td><td><button type="button" className="text-action-button" onClick={() => void openDetails(row)} disabled={detailsBusy}>عرض أيام الغياب</button></td><td><button type="button" className="icon-danger" onClick={() => openCorrection([rowStudentId(row)], from, to, row.name)} aria-label={`تصحيح حضور ${row.name}`}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
          <div className="absence-summary-cards">{filteredRows.map(row => <article className={`student-summary-card ${absenceTone(row.absenceDays)}`} key={rowStudentId(row)}><div className="student-summary-heading"><div><h3>{row.name}</h3><p>{row.grade || '—'} · {row.classroom || '—'}</p></div><strong>{row.absenceDays}<small>يوم غياب</small></strong></div><p className="summary-counts">بدون عذر: {row.unexcusedDays || 0} · بعذر: {row.excusedDays || 0} · ظرف: {row.specialDays || 0}</p><label className="card-status-control">الحالة<select className="absence-status-select" value={summaryStatus(row)} onChange={event => void applyStatus([rowStudentId(row)], event.target.value as AbsenceStatus, { label: row.name })} disabled={mutationBusy}><option value="unexcused">بدون عذر</option><option value="excused">بعذر</option><option value="special">ظرف خاص</option>{summaryStatus(row) === 'mixed' && <option value="mixed" disabled>مختلط — راجع التفاصيل</option>}</select></label><div className="student-summary-actions"><button type="button" className="secondary-button" onClick={() => void openDetails(row)} disabled={detailsBusy}>عرض أيام الغياب</button><button type="button" className="danger-button" onClick={() => openCorrection([rowStudentId(row)], from, to, row.name)}>تصحيح حضور</button></div></article>)}</div>
        </>}
      </section>
    </>}

    {details && <div className="report-modal-overlay" role="dialog" aria-modal="true" aria-label="تفاصيل أيام الغياب"><section className="report-modal"><header className="report-modal-header"><div><span className="panel-kicker">تفاصيل الطالب</span><h2>{details.student.name}</h2><p>{details.student.grade || '—'} · {details.student.classroom || '—'} · {details.days.length} يوم غياب</p></div><button type="button" className="modal-close-button" onClick={() => setDetails(null)} aria-label="إغلاق">×</button></header><div className="report-modal-actions"><button className="export-btn csv" type="button" onClick={exportDetails}><Download size={16} /> Excel</button><button className="export-btn pdf" type="button" onClick={printDetails}><Printer size={16} /> PDF</button><button className="secondary-button" type="button" onClick={() => void copyDetailsText()}>نسخ النص</button><button className="danger-button" type="button" onClick={() => openCorrection([detailStudentId], from, to, details.student.name)}><Trash2 size={16} /> تصحيح كل الأيام</button></div><section className={`student-notice-copy ${absenceTone(details.days.length)}`}><h3>تنبيه غياب متكرر</h3><p>نفيدكم بأن الطالب <strong>{details.student.name}</strong> من الصف <strong>{details.student.grade || '—'}</strong> والفصل <strong>{details.student.classroom || '—'}</strong> بلغ عدد أيام غيابه <strong>{details.days.length} يومًا</strong> خلال الفترة المحددة.</p></section><div className="absence-detail-list">{details.days.map(day => <article className="absence-day-card" key={day.date}><div><strong>{day.date}</strong><small>{day.note || 'لا توجد ملاحظات'}</small></div><label>الحالة<select className="absence-status-select" value={day.status} onChange={event => void applyStatus([detailStudentId], event.target.value as AbsenceStatus, { dates: [day.date], label: day.date, note: day.note })} disabled={mutationBusy}><option value="unexcused">بدون عذر</option><option value="excused">بعذر</option><option value="special">ظرف خاص</option></select></label><button type="button" className="icon-danger" onClick={() => openCorrection([detailStudentId], day.date, day.date, `${details.student.name} في ${day.date}`, [day.date])} aria-label={`تصحيح حضور ${details.student.name} في ${day.date}`}><Trash2 size={16} /></button></article>)}</div></section></div>}

    {correction && <div className="report-modal-overlay" role="dialog" aria-modal="true" aria-label="تصحيح الحضور"><section className="correction-dialog"><header className="report-modal-header"><div><span className="panel-kicker">تصحيح الحضور</span><h2>{correction.label}</h2><p>{correction.from} إلى {correction.to}</p></div><button type="button" className="modal-close-button" onClick={() => setCorrection(null)} aria-label="إغلاق">×</button></header><p className={correction.irreversible ? 'correction-warning' : 'feature-muted'}>{correction.irreversible ? 'لا يمكن التراجع عن هذه العملية. سيتحول الغياب المحدد إلى حضور في السجل.' : 'سيُزال الغياب المحدد ويُسجل الطالب بالحالة والوقت اللذين تختارهما.'}</p><div className="correction-form"><label>الحالة<select value={correctionStatus} onChange={event => setCorrectionStatus(event.target.value as 'present' | 'late')}><option value="present">حاضر</option><option value="late">متأخر</option></select></label><label>وقت الحضور<input type="time" value={correctionTime} onChange={event => setCorrectionTime(event.target.value)} /></label></div><div className="report-modal-actions"><button className="secondary-button" type="button" onClick={() => setCorrection(null)}>إلغاء</button><button className="danger-button" type="button" onClick={() => void saveCorrection()} disabled={mutationBusy}><Trash2 size={16} /> تأكيد التصحيح</button></div></section></div>}
  </section>
}
