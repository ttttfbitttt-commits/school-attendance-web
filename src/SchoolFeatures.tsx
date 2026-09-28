import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { CheckCircle2, Download, FileText, Mail, Plus, Printer, RefreshCw, Save, Send, ShieldCheck, Trash2 } from 'lucide-react'
import { api, type AbsenceReport, type AbsenceRow, type Excuse, type MessageLog } from './api'

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
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)

  const load = () => {
    void Promise.all([api.almadar(), api.messages()]).then(([account, history]) => {
      setAccountReady(account.account.configured)
      setLogs(history.messages)
    }).catch(() => setNotice('تعذر تحميل حالة الرسائل.'))
  }
  useEffect(load, [])

  const presentIds = useMemo(() => new Set(attendance.map(record => record.studentId)), [attendance])
  const lateIds = useMemo(() => new Set(attendance.filter(record => record.status === 'late').map(record => record.studentId)), [attendance])
  const candidates = useMemo(() => students.filter(student => {
    if (type === 'late' && !lateIds.has(student.id)) return false
    if (type === 'absence' && presentIds.has(student.id)) return false
    const query = search.trim().toLowerCase()
    return !query || `${student.name} ${student.id} ${student.grade} ${student.classroom}`.toLowerCase().includes(query)
  }), [students, type, lateIds, presentIds, search])

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

export function ReportsCenter({ students, schoolName }: { students: FeatureStudent[]; schoolName: string }) {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [studentId, setStudentId] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [report, setReport] = useState<AbsenceReport | null>(null)
  const [excuses, setExcuses] = useState<Excuse[]>([])
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [excuseForm, setExcuseForm] = useState({ studentId: '', category: '', note: '', startDate: today(), endDate: '' })

  const studentMatches = useMemo(() => {
    const query = studentSearch.trim().toLocaleLowerCase('ar')
    if (!query || studentId) return []
    return students.filter(student => `${student.name} ${student.id} ${student.grade} ${student.classroom}`.toLocaleLowerCase('ar').includes(query)).slice(0, 8)
  }, [students, studentId, studentSearch])

  const loadExcuses = () => void api.excuses().then(result => setExcuses(result.excuses)).catch(() => setNotice('تعذر تحميل الأعذار.'))
  useEffect(loadExcuses, [])
  const loadReport = async () => {
    if (!from || !to || from > to) { setNotice('اختر فترة زمنية صحيحة للتقرير.'); return }
    setBusy(true)
    try { setReport(await api.absenceReport(from, to, studentId)); setNotice('') } catch { setNotice('تعذر إعداد تقرير الغياب. اختر فترة لا تزيد عن سنة.') } finally { setBusy(false) }
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

  const selectedRow = report?.rows[0]
  const yellow = useMemo(() => (report?.rows || []).filter(row => row.absenceDays >= 6 && row.absenceDays <= 10), [report])
  const orange = useMemo(() => (report?.rows || []).filter(row => row.absenceDays >= 11 && row.absenceDays <= 15), [report])
  const red = useMemo(() => (report?.rows || []).filter(row => row.absenceDays >= 16), [report])
  const categories: Array<{ label: string; rows: AbsenceRow[]; tone: 'yellow' | 'orange' | 'red' }> = [
    { label: 'أصفر · 6 إلى 10 أيام', rows: yellow, tone: 'yellow' },
    { label: 'برتقالي · 11 إلى 15 يوماً', rows: orange, tone: 'orange' },
    { label: 'أحمر · 16 يوماً فأكثر', rows: red, tone: 'red' },
  ]

  const exportPhones = () => downloadWorkbook('تقرير_هواتف_الطلاب', [['اسم الطالب', 'رقم الجوال'], ...students.map(student => [student.name, student.phone])], 'هواتف الطلاب')
  const printPhones = () => openPrintDocument('تقرير هواتف الطلاب', `<section class="page"><h1>تقرير هواتف الطلاب</h1><table><thead><tr><th>اسم الطالب</th><th>رقم الجوال</th></tr></thead><tbody>${students.map(student => `<tr><td>${escapeHtml(student.name)}</td><td dir="ltr">${escapeHtml(student.phone)}</td></tr>`).join('')}</tbody></table><p class="meta">${escapeHtml(schoolName)} · ${today()}</p></section>`)
  const exportSingle = () => selectedRow && downloadWorkbook(`تقرير_غياب_${selectedRow.name}`, [['اسم الطالب', 'الصف', 'الفصل', 'أيام الغياب', 'لديه عذر'], [selectedRow.name, selectedRow.grade, selectedRow.classroom, selectedRow.absenceDays, selectedRow.hasExcuse ? 'نعم' : 'لا']], 'غياب طالب')
  const printSingle = () => selectedRow && printRepeated([selectedRow], 'تقرير غياب طالب')
  const exportExcuses = () => downloadWorkbook('تقرير_الأعذار_والظروف', [['اسم الطالب', 'الصف', 'الفصل', 'النوع', 'من', 'إلى', 'الملاحظات'], ...excuses.map(item => [item.name, item.grade, item.classroom, item.category, item.startDate, item.endDate || 'مستمر', item.note])], 'الأعذار')
  const printExcuses = () => openPrintDocument('تقرير الأعذار والظروف الخاصة', `<section class="page"><h1>تقرير الأعذار والظروف الخاصة</h1><table><thead><tr><th>الطالب</th><th>الصف والفصل</th><th>الحالة</th><th>الفترة</th><th>الملاحظات</th></tr></thead><tbody>${excuses.map(item => `<tr class="green"><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.grade)} · ${escapeHtml(item.classroom)}</td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.startDate)} إلى ${escapeHtml(item.endDate || 'مستمر')}</td><td>${escapeHtml(item.note)}</td></tr>`).join('')}</tbody></table></section>`)

  function exportRepeated(rows: AbsenceRow[], name: string) {
    downloadWorkbook(name, [['اسم الطالب', 'الصف', 'الفصل', 'أيام الغياب', 'لديه عذر'], ...rows.map(row => [row.name, row.grade, row.classroom, row.absenceDays, row.hasExcuse ? 'نعم' : 'لا'])], 'الغياب المتكرر')
  }
  function printRepeated(rows: AbsenceRow[], title: string) {
    if (!rows.length) { setNotice('لا يوجد طلاب في هذه الفئة.'); return }
    openPrintDocument(title, rows.map(row => {
      const color = row.hasExcuse ? 'excuse' : row.absenceDays >= 16 ? 'red' : row.absenceDays >= 11 ? 'orange' : ''
      const excuse = row.hasExcuse ? `<p><span class="label">تنبيه:</span> لدى الطالب عذر أو ظرف خاص مسجل.</p>` : ''
      return `<section class="page"><h1>تنبيه غياب متكرر</h1><div class="heading"><p>نفيدكم بأن الطالب <span class="label">${escapeHtml(row.name)}</span> من الصف <span class="label">${escapeHtml(row.grade || '—')}</span> والفصل <span class="label">${escapeHtml(row.classroom || '—')}</span> بلغ عدد أيام غيابه <span class="label">${row.absenceDays} يوماً</span> خلال الفترة من ${escapeHtml(report?.from)} إلى ${escapeHtml(report?.to)}.</p><div class="notice ${color}">${excuse}<p>نأمل متابعة انتظام الطالب في الدراسة والتواصل مع المدرسة عند الحاجة.</p></div><p class="meta">${escapeHtml(schoolName)} · تاريخ الطباعة: ${today()}</p></div></section>`
    }).join(''))
  }

  const addExcuse = async () => {
    if (!excuseForm.studentId || !excuseForm.category || !excuseForm.startDate) { setNotice('اختر الطالب والحالة وتاريخ بداية العذر أو الظرف.'); return }
    try {
      await api.addExcuse(excuseForm)
      setExcuseForm({ studentId: '', category: '', note: '', startDate: today(), endDate: '' })
      setNotice('تم حفظ العذر أو الحالة الخاصة.')
      loadExcuses(); void loadReport()
    } catch (error) { setNotice(error instanceof Error && error.message === 'excuse_period_exists' ? 'للطالب عذر أو ظرف مسجل ضمن هذه الفترة بالفعل.' : 'تعذر حفظ العذر. تحقق من التواريخ والطالب.') }
  }
  const removeExcuse = async (id: string) => {
    if (!window.confirm('هل تريد حذف هذا العذر؟')) return
    try { await api.deleteExcuse(id); loadExcuses(); void loadReport() } catch { setNotice('تعذر حذف العذر.') }
  }

  return <section className="feature-page">
    <section className="panel feature-intro"><div><span className="panel-kicker">إدارة المدرسة</span><h2>التقارير</h2><p>تحسب أيام الغياب من الأحد إلى الخميس ضمن الفترة التي تختارها. الطالب ذو العذر يبقى في التقرير بلون أخضر فاتح.</p></div><FileText size={34} /></section>
    <section className="panel"><div className="panel-header"><div><span className="panel-kicker">بيانات الاتصال</span><h2>تقرير هواتف الطلاب</h2></div><div className="feature-actions"><button type="button" className="export-btn csv" onClick={exportPhones}><Download size={16} /> Excel</button><button type="button" className="export-btn pdf" onClick={printPhones}><Printer size={16} /> PDF</button></div></div><p className="feature-muted">يتضمن اسم الطالب ورقم الجوال فقط.</p></section>
    <section className="panel report-filter-panel"><div className="panel-header"><div><span className="panel-kicker">فترة الدراسة</span><h2>تقارير الغياب</h2></div></div><div className="feature-toolbar report-filters"><label>من<input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>إلى<input type="date" value={to} onChange={event => setTo(event.target.value)} /></label><label className="report-student-search">طالب محدد<div className="student-search-box"><input value={studentSearch} onChange={event => { setStudentSearch(event.target.value); setStudentId(''); setReport(null) }} placeholder="اكتب اسم الطالب للبحث..." autoComplete="off" />{studentId && <button type="button" onClick={clearReportStudent} aria-label="إلغاء اختيار الطالب">×</button>}</div>{!studentId && studentSearch.trim() && <div className="student-search-results">{studentMatches.map(student => <button type="button" key={student.id} onClick={() => chooseReportStudent(student)}><strong>{student.name}</strong><small>{student.grade || '—'} · {student.classroom || '—'}</small></button>)}{!studentMatches.length && <span>لا يوجد طالب مطابق.</span>}</div>}</label><button className="primary-button" type="button" onClick={() => void loadReport()} disabled={busy}><RefreshCw size={16} /> إعداد التقرير</button></div>{report && <p className="feature-muted">أيام الدراسة في الفترة: {report.workingDays} أيام.</p>}{notice && <div className="notice-box" role="status">{notice}</div>}</section>
    {studentId && selectedRow && <section className="panel"><div className="panel-header"><div><span className="panel-kicker">طالب محدد</span><h2>عدد أيام غياب {selectedRow.name}</h2><p>{selectedRow.grade} · {selectedRow.classroom} · {selectedRow.absenceDays} أيام غياب{selectedRow.hasExcuse ? ' · لديه عذر أو ظرف خاص' : ''}</p></div><div className="feature-actions"><button className="export-btn csv" type="button" onClick={exportSingle}><Download size={16} /> Excel</button><button className="export-btn pdf" type="button" onClick={printSingle}><Printer size={16} /> PDF</button></div></div></section>}
    {report && !studentId && <section className="panel"><div className="panel-header"><div><span className="panel-kicker">تحذيرات الغياب</span><h2>الطلاب الغائبون أكثر من 5 أيام</h2><p>اختر فئة لتصديرها إلى Excel أو إنشاء PDF مستقل، صفحة لكل طالب.</p></div></div><div className="absence-category-grid">{categories.map(({ label, rows, tone }) => <article className={`absence-category ${tone}`} key={label}><h3>{label}</h3><strong>{rows.length} طالب</strong><div><button type="button" className="export-btn csv" onClick={() => exportRepeated(rows, `غياب_${label.split(' ')[0]}`)} disabled={!rows.length}>Excel</button><button type="button" className="export-btn pdf" onClick={() => printRepeated(rows, label)} disabled={!rows.length}>PDF</button></div></article>)}</div><div className="table-wrap"><table className="feature-table"><thead><tr><th>الطالب</th><th>الصف</th><th>الفصل</th><th>أيام الغياب</th><th>الحالة</th></tr></thead><tbody>{[...yellow, ...orange, ...red].map(row => <tr className={row.hasExcuse ? 'green' : row.absenceDays >= 16 ? 'red' : row.absenceDays >= 11 ? 'orange' : 'yellow'} key={row.id}><td>{row.name}</td><td>{row.grade || '—'}</td><td>{row.classroom || '—'}</td><td>{row.absenceDays}</td><td>{row.hasExcuse ? 'لديه عذر أو ظرف خاص' : 'بدون عذر مسجل'}</td></tr>)}</tbody></table></div></section>}
    <section className="panel"><div className="panel-header"><div><span className="panel-kicker">إدارة الحالات</span><h2>الأعذار والظروف الخاصة</h2><p>كل الطلاب حالتهم الافتراضية بدون عذر. أضف حالة فقط للطالب الذي لديه عذر أو ظرف خاص.</p></div><div className="feature-actions"><button type="button" className="export-btn csv" onClick={exportExcuses}><Download size={16} /> Excel</button><button type="button" className="export-btn pdf" onClick={printExcuses}><Printer size={16} /> PDF</button></div></div><div className="excuse-form"><select value={excuseForm.studentId} onChange={event => setExcuseForm(current => ({ ...current, studentId: event.target.value }))}><option value="">اختر الطالب</option>{students.map(student => <option key={student.id} value={student.id}>{student.name} · {student.grade} · {student.classroom}</option>)}</select><select value={excuseForm.category} onChange={event => setExcuseForm(current => ({ ...current, category: event.target.value }))}><option value="">بدون عذر — اختر حالة لإضافتها</option><option value="عذر">عذر</option><option value="ظرف خاص">ظرف خاص</option></select><input type="date" value={excuseForm.startDate} onChange={event => setExcuseForm(current => ({ ...current, startDate: event.target.value }))} /><input type="date" value={excuseForm.endDate} onChange={event => setExcuseForm(current => ({ ...current, endDate: event.target.value }))} /><input value={excuseForm.note} onChange={event => setExcuseForm(current => ({ ...current, note: event.target.value }))} placeholder="ملاحظات الإدارة" /><button type="button" className="primary-button" onClick={() => void addExcuse()}><Plus size={16} /> حفظ الحالة</button></div><div className="table-wrap"><table className="feature-table"><thead><tr><th>الطالب</th><th>الحالة</th><th>الفترة</th><th>ملاحظات</th><th></th></tr></thead><tbody>{excuses.map(item => <tr className="green" key={item.id}><td>{item.name}<small>{item.grade} · {item.classroom}</small></td><td>{item.category}</td><td>{item.startDate} إلى {item.endDate || 'مستمر'}</td><td>{item.note || '—'}</td><td><button type="button" className="icon-danger" onClick={() => void removeExcuse(item.id)} aria-label={`حذف عذر ${item.name}`}><Trash2 size={16} /></button></td></tr>)}{!excuses.length && <tr><td colSpan={5}>لا توجد أعذار أو ظروف خاصة مسجلة.</td></tr>}</tbody></table></div></section>
  </section>
}
