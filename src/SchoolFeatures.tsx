import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { CheckCircle2, Download, FileText, Mail, Printer, RefreshCw, Save, Send, ShieldCheck } from 'lucide-react'
import { api, type MessageLog } from './api'

export type FeatureStudent = { id: string; name: string; phone: string; grade: string; classroom: string }
export type FeatureAttendance = { studentId: string; status: 'present' | 'late' }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
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
  const [senderName, setSenderName] = useState('')
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
      setSenderName(account.senderName || '')
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
      <label className="school-settings-field">اسم المرسل المعتمد في المدار<input name="almadar-sender-name" autoComplete="off" value={senderName} onChange={event => setSenderName(event.target.value)} placeholder="أدخِل الاسم المفعّل لهذا الحساب في المدار" /></label>
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

type DailyRow = { studentId: string; name: string; grade: string; classroom: string; phone: string; status: 'unexcused' | 'excused'; date: string; time?: string }
type CountRow = { studentId: string; name: string; grade: string; classroom: string; phone: string; days: number; excusedDays: number; unexcusedDays: number }
type History = { student: { studentId: string; name: string; grade: string; classroom: string; phone: string }; type: 'absence' | 'late'; days: Array<{ date: string; status: 'unexcused' | 'excused'; time?: string }> }
const statusText = (status: 'unexcused' | 'excused') => status === 'excused' ? 'بعذر' : 'بدون عذر'

function exportDaily(title: string, rows: DailyRow[]) {
  downloadWorkbook(title, [['اسم الطالب', 'الصف', 'الفصل', 'رقم الجوال', 'الحالة'], ...rows.map(row => [row.name, row.grade, row.classroom, row.phone, statusText(row.status)])])
}

function printDaily(title: string, rows: DailyRow[], schoolName: string, date: string) {
  openPrintDocument(title, `<section class="page"><h1>${escapeHtml(title)}</h1><table><thead><tr><th>الطالب</th><th>الصف</th><th>الفصل</th><th>الجوال</th><th>الحالة</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.grade)}</td><td>${escapeHtml(row.classroom)}</td><td dir="ltr">${escapeHtml(row.phone)}</td><td>${statusText(row.status)}</td></tr>`).join('')}</tbody></table><p class="meta">${escapeHtml(schoolName)} · ${date}</p></section>`)
}

function DailyList({ title, date, onDate, rows, onStatus, onAll, onExcel, onPdf, late = false }: { title: string; date: string; onDate: (value: string) => void; rows: DailyRow[]; onStatus: (ids: string[], status: 'unexcused' | 'excused') => void; onAll: (status: 'unexcused' | 'excused') => void; onExcel: () => void; onPdf: () => void; late?: boolean }) {
  return <section className="panel daily-report-panel"><div className="panel-header"><div><span className="panel-kicker">سجل يومي</span><h2>{title}</h2><p>العدد: {rows.length} طالبًا</p></div><label className="report-date">التاريخ<input type="date" value={date} max={today()} onChange={event => onDate(event.target.value)} /></label></div><div className="feature-actions daily-actions"><button className="secondary-button" type="button" onClick={() => onAll('excused')} disabled={!rows.length}>اعتبار الجميع بعذر</button><button className="secondary-button" type="button" onClick={() => onAll('unexcused')} disabled={!rows.length}>اعتبار الجميع بدون عذر</button><button className="export-btn csv" type="button" onClick={onExcel} disabled={!rows.length}><Download size={16} /> Excel</button><button className="export-btn pdf" type="button" onClick={onPdf} disabled={!rows.length}><Printer size={16} /> PDF</button></div><div className="daily-list">{rows.map(row => <article key={row.studentId} className="daily-row"><div><strong>{row.name}</strong><small>{row.grade || '—'} · {row.classroom || '—'} · <span dir="ltr">{row.phone || '—'}</span>{late && row.time ? ` · ${row.time}` : ''}</small></div><select value={row.status} onChange={event => onStatus([row.studentId], event.target.value as 'unexcused' | 'excused')}><option value="unexcused">بدون عذر</option><option value="excused">بعذر</option></select></article>)}{!rows.length && <p className="report-empty-state">لا توجد سجلات لهذا التاريخ.</p>}</div></section>
}

function HistoryCounts({ type, students, schoolName }: { type: 'absence' | 'late'; students: FeatureStudent[]; schoolName: string }) {
  const title = type === 'absence' ? 'عدد أيام الغياب' : 'عدد أيام التأخر'
  const reportTitle = type === 'absence' ? 'أيام غياب الطالب' : 'أيام تأخر الطالب'
  const [allRows, setAllRows] = useState<CountRow[]>([])
  const [shownRows, setShownRows] = useState<CountRow[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<History | null>(null)
  const load = async (ids: string[] = []) => {
    const result = type === 'absence' ? await api.absenceSummary(ids) : await api.lateSummary(ids)
    const rows = result.rows as CountRow[]
    if (!ids.length) setAllRows(rows)
    setShownRows(rows)
  }
  useEffect(() => { void load() }, [type])
  const matches = useMemo(() => search.trim() ? students.filter(student => student.name.includes(search.trim())).slice(0, 8) : [], [students, search])
  const buckets = [{ label: 'طلاب غيابهم من 1 إلى 5 أيام', tone: 'yellow', rows: allRows.filter(row => row.days >= 1 && row.days <= 5) }, { label: 'طلاب غيابهم من 6 إلى 10 أيام', tone: 'orange', rows: allRows.filter(row => row.days >= 6 && row.days <= 10) }, { label: 'طلاب غيابهم 11 يومًا فأكثر', tone: 'red', rows: allRows.filter(row => row.days >= 11) }]
  const open = async (row: CountRow) => setHistory(await api.studentHistory(type, row.studentId) as History)
  const printHistories = async (rows: CountRow[]) => {
    const histories = await Promise.all(rows.map(row => api.studentHistory(type, row.studentId)))
    openPrintDocument(reportTitle, histories.map(item => `<section class="page"><h1>${reportTitle}</h1><div class="heading"><p><span class="label">اسم الطالب:</span> ${escapeHtml(item.student.name)}</p><p><span class="label">الصف والفصل:</span> ${escapeHtml(item.student.grade)} · ${escapeHtml(item.student.classroom)}</p><table><thead><tr><th>التاريخ</th><th>الحالة</th>${type === 'late' ? '<th>الوقت</th>' : ''}</tr></thead><tbody>${item.days.map(day => `<tr><td>${day.date}</td><td>${statusText(day.status)}</td>${type === 'late' ? `<td>${day.time || '—'}</td>` : ''}</tr>`).join('')}</tbody></table><p class="meta">عدد الأيام: ${item.days.length} · الجوال: <span dir="ltr">${escapeHtml(item.student.phone)}</span><br/>${escapeHtml(schoolName)} · ${today()}</p></div></section>`).join(''))
  }
  return <section className="panel history-count-panel"><div className="panel-header"><div><span className="panel-kicker">ملخص تراكمي</span><h2>{title}</h2><p>ابحث وحدد الطلاب، أو افتح بطاقة لعرض فئتها.</p></div></div><div className="count-card-grid">{buckets.map(bucket => <button className={`count-card ${bucket.tone}`} type="button" key={bucket.tone} onClick={() => setShownRows(bucket.rows)}><span>{bucket.label.replace('غياب', type === 'late' ? 'تأخر' : 'غياب')}</span><strong>{bucket.rows.length} طالب</strong></button>)}</div><div className="student-picker"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الطالب..." />{matches.map(student => <label key={student.id}><input type="checkbox" checked={selected.has(student.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(student.id) ? next.delete(student.id) : next.add(student.id); return next })} /> {student.name} · {student.grade} · {student.classroom}</label>)}<button type="button" className="primary-button" onClick={() => void load([...selected])} disabled={!selected.size}><CheckCircle2 size={16} /> تأكيد الطلاب المحددين</button><button type="button" className="secondary-button" onClick={() => { setSelected(new Set()); void load() }}>عرض الجميع</button></div><div className="feature-actions"><button type="button" className="export-btn csv" onClick={() => downloadWorkbook(title, [['الطالب','الصف','الفصل','الجوال','عدد الأيام','بعذر','بدون عذر'], ...shownRows.map(row => [row.name,row.grade,row.classroom,row.phone,row.days,row.excusedDays,row.unexcusedDays])])} disabled={!shownRows.length}><Download size={16} /> Excel</button><button type="button" className="export-btn pdf" onClick={() => void printHistories(shownRows)} disabled={!shownRows.length}><Printer size={16} /> PDF لجميع الظاهرين</button></div><div className="daily-list">{shownRows.map(row => <button type="button" className="history-row" key={row.studentId} onClick={() => void open(row)}><span><strong>{row.name}</strong><small>{row.grade} · {row.classroom} · <bdi>{row.phone}</bdi></small></span><strong>{row.days} يومًا</strong></button>)}{!shownRows.length && <p className="report-empty-state">لا توجد بيانات ضمن هذا الاختيار.</p>}</div>{history && <div className="report-modal-overlay"><section className="report-modal"><header className="report-modal-header"><div><span className="panel-kicker">تفاصيل الطالب</span><h2>{history.student.name}</h2><p>{history.student.grade} · {history.student.classroom} · <bdi>{history.student.phone}</bdi></p></div><button type="button" className="modal-close-button" onClick={() => setHistory(null)}>×</button></header><div className="report-modal-actions"><button type="button" className="export-btn csv" onClick={() => downloadWorkbook(`${reportTitle}_${history.student.name}`, [['التاريخ','الحالة', ...(type === 'late' ? ['الوقت'] : [])], ...history.days.map(day => [day.date,statusText(day.status), ...(type === 'late' ? [day.time || '—'] : [])])])}>Excel</button><button type="button" className="export-btn pdf" onClick={() => void printHistories([{ studentId: history.student.studentId, name: history.student.name, grade: history.student.grade, classroom: history.student.classroom, phone: history.student.phone, days: history.days.length, excusedDays: 0, unexcusedDays: 0 }])}>PDF</button></div><div className="absence-detail-list">{history.days.map(day => <article className="absence-day-card" key={day.date}><strong>{day.date}</strong><span>{statusText(day.status)}{type === 'late' && day.time ? ` · ${day.time}` : ''}</span></article>)}</div></section></div>}</section>
}

export function ReportsCenter({ students, schoolName }: { students: FeatureStudent[]; schoolName: string }) {
  const [todayRows, setTodayRows] = useState<Array<Omit<DailyRow, 'date' | 'status'>>>([])
  const [absenceDate, setAbsenceDate] = useState(today())
  const [lateDate, setLateDate] = useState(today())
  const [absences, setAbsences] = useState<DailyRow[]>([])
  const [lates, setLates] = useState<DailyRow[]>([])
  const [notice, setNotice] = useState('')
  const loadToday = async () => setTodayRows((await api.missingAttendance(today())).rows)
  const loadAbsences = async (date = absenceDate) => setAbsences((await api.dailyAbsences(date)).rows as DailyRow[])
  const loadLates = async (date = lateDate) => setLates((await api.dailyLates(date)).rows as DailyRow[])
  useEffect(() => { void Promise.all([loadToday(), loadAbsences(), loadLates()]).catch(() => setNotice('تعذر تحميل بعض بيانات التقارير.')) }, [])
  const calculate = async () => { if (!window.confirm('سيُعتمد غياب الطلاب الظاهرين في غياب اليوم. هل تريد المتابعة؟')) return; await api.calculateAbsences(today()); await Promise.all([loadToday(), loadAbsences()]); setNotice('تم اعتماد غياب اليوم.') }
  const updateAbsence = async (ids: string[], status: 'unexcused' | 'excused') => { await api.setAbsenceStatus({ studentIds: ids, from: absenceDate, to: absenceDate, status }); await loadAbsences() }
  const updateLate = async (ids: string[], status: 'unexcused' | 'excused') => { await api.setDailyLateStatus({ date: lateDate, studentIds: ids, status }); await loadLates() }
  return <section className="feature-page reports-center"><section className="panel feature-intro"><div><span className="panel-kicker">إدارة المدرسة</span><h2>التقارير</h2><p>تابع الغياب والتأخر يوميًا، ثم اعرض الإجماليات والتفاصيل عند الحاجة.</p></div><FileText size={34} /></section><section className="panel"><div className="panel-header"><div><span className="panel-kicker">بيانات الاتصال</span><h2>تقرير هواتف الطلاب</h2></div><div className="feature-actions"><button type="button" className="export-btn csv" onClick={() => downloadWorkbook('تقرير_هواتف_الطلاب', [['اسم الطالب','الصف','الفصل','رقم الجوال'], ...students.map(student => [student.name,student.grade,student.classroom,student.phone])])}><Download size={16} /> Excel</button><button type="button" className="export-btn pdf" onClick={() => openPrintDocument('تقرير هواتف الطلاب', `<section class="page"><h1>تقرير هواتف الطلاب</h1><table><thead><tr><th>الطالب</th><th>الصف</th><th>الفصل</th><th>الجوال</th></tr></thead><tbody>${students.map(student => `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.grade)}</td><td>${escapeHtml(student.classroom)}</td><td dir="ltr">${escapeHtml(student.phone)}</td></tr>`).join('')}</tbody></table><p class="meta">${escapeHtml(schoolName)} · ${today()}</p></section>`)}><Printer size={16} /> PDF</button></div></div></section><section className="panel daily-report-panel"><div className="panel-header"><div><span className="panel-kicker">متابعة مباشرة</span><h2>غياب اليوم</h2><p>طلاب لم يسجلوا حضورًا أو تأخرًا حتى الآن: {todayRows.length}</p></div><button type="button" className="primary-button" onClick={() => void calculate()} disabled={!todayRows.length}><CheckCircle2 size={16} /> اعتماد غياب اليوم</button></div><div className="daily-list">{todayRows.map(row => <article key={row.studentId} className="daily-row"><div><strong>{row.name}</strong><small>{row.grade || '—'} · {row.classroom || '—'} · <bdi>{row.phone || '—'}</bdi></small></div></article>)}{!todayRows.length && <p className="report-empty-state">لا يوجد طالب بانتظار تسجيل الحضور الآن.</p>}</div></section><DailyList title="غياب الطلاب" date={absenceDate} onDate={value => { setAbsenceDate(value); void loadAbsences(value) }} rows={absences} onStatus={(ids, status) => void updateAbsence(ids, status)} onAll={status => void updateAbsence(absences.map(row => row.studentId), status)} onExcel={() => exportDaily(`غياب_${absenceDate}`, absences)} onPdf={() => printDaily('غياب الطلاب', absences, schoolName, absenceDate)} /><HistoryCounts type="absence" students={students} schoolName={schoolName} /><DailyList title="تأخر الطلاب" date={lateDate} onDate={value => { setLateDate(value); void loadLates(value) }} rows={lates} onStatus={(ids, status) => void updateLate(ids, status)} onAll={status => void updateLate(lates.map(row => row.studentId), status)} onExcel={() => exportDaily(`تأخر_${lateDate}`, lates)} onPdf={() => printDaily('تأخر الطلاب', lates, schoolName, lateDate)} late /><HistoryCounts type="late" students={students} schoolName={schoolName} />{notice && <div className="notice-box">{notice}</div>}</section>
}
