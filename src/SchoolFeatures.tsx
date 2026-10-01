import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { CheckCircle2, Download, FileText, Mail, Printer, RefreshCw, Save, Send, ShieldCheck, XCircle } from 'lucide-react'
import { api, type MessageLog } from './api'
import { StudentDetailedReport } from './StudentDetailedReport'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate, formatHijriDateTime } from './dateUtils'

export type FeatureStudent = { id: string; name: string; phone: string; grade: string; classroom: string }
export type FeatureAttendance = { studentId: string; status: 'present' | 'late' }

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character))
const maskPhone = (phone: string) => phone.length > 4 ? `${phone.slice(0, 3)}••••${phone.slice(-3)}` : phone
const formatDateTime = (value: string) => formatHijriDateTime(value)
type MessageKind = 'late' | 'absence' | 'general'
const MESSAGE_CANDIDATE_LIMIT = 50
const MESSAGE_LOG_LIMIT = 40
const messageLogTitle = (type: MessageKind) => type === 'general' ? 'سجل الرسائل العامة' : type === 'late' ? 'سجل رسائل التأخر' : 'سجل رسائل الغياب'
const messageTypeText = (type: MessageLog['type']) => type === 'test' ? 'اختبار المدار' : type === 'late' ? 'تأخر' : type === 'absence' ? 'غياب' : 'عامة'

export function reportBrandHeader(title: string, schoolName: string) {
  const logoUrl = `${window.location.origin}/moe-logo.png`
  return `<header class="report-brand"><img src="${logoUrl}" alt="شعار وزارة التعليم" /><div class="report-school">${escapeHtml(schoolName)}</div><h1>${escapeHtml(title)}</h1></header>`
}

export function openPrintDocument(title: string, contents: string, schoolName: string, orientation: 'portrait' | 'landscape' = 'portrait') {
  const popup = window.open('', '_blank')
  if (!popup) return false
  const brandedContents = contents
    .replace(/<h1>[\s\S]*?<\/h1>/g, '')
    .replace(/<section class="page">/g, `<section class="page">${reportBrandHeader(title, schoolName)}`)
  popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 ${orientation};margin:12mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial,sans-serif;color:#172033;margin:0;background:#fff;direction:rtl}.page{min-height:${orientation === 'landscape' ? '180mm' : '265mm'};padding:0 3mm 8mm;page-break-after:always;break-after:page}.page:last-child{page-break-after:auto;break-after:auto}.report-brand{text-align:center;margin:0 auto 7mm;padding:0 0 4mm;border-bottom:1px solid #d7e2ec}.report-brand img{display:block;width:72px;height:56px;object-fit:contain;margin:0 auto 2mm}.report-school{color:#334155;font-size:13px;font-weight:700;margin:0 0 2mm}.report-brand h1{font-size:18px;line-height:1.4;color:#0c4277;margin:0;text-align:center}.heading{color:#334155;line-height:2;font-size:17px}.notice{padding:18px;border-radius:12px;background:#f8fafc;border-right:7px solid #eab308;margin-top:22px}.notice.orange{border-color:#f97316}.notice.red{border-color:#dc2626}.notice.excuse{border-color:#86efac;background:#f0fdf4}.label{font-weight:700;color:#0f3d67}.meta{margin-top:20px;color:#64748b;font-size:12px}table{width:100%;border-collapse:collapse;font-size:13px;table-layout:auto}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #cbd5e1;padding:8px;text-align:right}th{background:#eaf2fb;color:#123b63}.page>h1{display:none}.green{background:#dcfce7}.yellow{background:#fef9c3}.orange{background:#ffedd5}.red{background:#fee2e2}@media print{body{margin:0}.page{min-height:0}}
  </style></head><body>${brandedContents}<script>window.onload=()=>window.print()<\/script></body></html>`)
  popup.document.close()
  return true
}

export function openOfficialFormDocument(title: string, contents: string) {
  const popup = window.open('', '_blank')
  if (!popup) return false
  popup.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{width:210mm;min-height:297mm;margin:0;background:#fff;color:#111;direction:rtl;font-family:"Traditional Arabic","Times New Roman",serif}.sheet{position:relative;width:202mm;min-height:289mm;margin:4mm;padding:6mm 7mm 7mm;border:1.2mm solid #111;outline:0.45mm solid #111;outline-offset:-2.1mm;display:flex;flex-direction:column}.top{display:grid;grid-template-columns:1fr 44mm 1fr;align-items:start;min-height:31mm;gap:4mm}.meta{font-size:15px;font-weight:700;line-height:1.55}.meta p{margin:0}.ministry{text-align:center;display:grid;justify-items:center;gap:1mm}.ministry img{width:36mm;height:20mm;object-fit:contain}.ministry strong{font-family:Tahoma,Arial,sans-serif;font-size:15px;color:#168f87}.ministry small{font-family:Arial,sans-serif;font-size:9px;color:#999}.state{text-align:right;font-size:15px;font-weight:700;line-height:1.42}.state .country{font-size:17px}.state .school{margin-top:1mm;font-weight:400}.form-code{margin:3mm 0 0;font-weight:700;font-size:15px;line-height:1.55}.form-code .code{color:#c62828}.form-title{text-align:center;font-size:22px;font-weight:800;margin:0 0 4mm;line-height:1.3}.fields{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 2mm;font-size:15px}.fields th,.fields td{border:1px solid #111;height:9mm;padding:1mm 2mm}.fields th{font-weight:800;white-space:nowrap}.school-row th,.civil-row th{width:30%}.civil-boxes{direction:ltr;display:grid;grid-template-columns:repeat(10,1fr);height:8mm}.civil-boxes span{border-left:1px solid #111;display:grid;place-items:center;font-family:Tahoma,Arial,sans-serif;font-size:13px}.civil-boxes span:last-child{border-left:0}.teacher-table th,.teacher-table td{font-size:14px;height:8mm;padding:1mm;text-align:center}.teacher-table th:first-child,.teacher-table td:first-child{width:23%}.greeting{margin-top:1mm;text-align:right;font-size:15px;font-weight:700;line-height:1.45}.greeting p{margin:0}.case-intro{display:flex;justify-content:space-between;gap:4mm;margin-top:3mm;font-size:15px;font-weight:700}.case-intro .date-line{white-space:nowrap}.options{font-size:15px;line-height:1.75;margin-top:1mm}.option{display:flex;align-items:baseline;gap:2mm}.box{font-family:Arial,sans-serif;font-size:16px;white-space:nowrap}.request{font-size:15px;font-weight:700;line-height:1.6;margin:1mm 0 0}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-top:5mm;font-size:14px;font-weight:700}.signatures div{white-space:nowrap}.divider{border:0;border-top:1px solid #111;margin:4mm 0 2mm}.section-title{font-size:18px;font-weight:800;margin:0 0 1mm}.reply{font-size:15px;font-weight:700;margin:0 0 1mm}.writing-lines{display:grid;gap:4mm;margin-top:1mm}.writing-lines div{height:2.5mm;border-bottom:1px dotted #111}.reply-signatures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3mm;margin-top:4mm;font-size:13px;font-weight:700}.reply-signatures div{white-space:nowrap}.manager-title{text-align:right;font-size:18px;font-weight:800;margin:1mm 0}.manager-options{font-size:14px;line-height:1.65}.manager-signature{display:grid;grid-template-columns:1fr 1fr 1fr;gap:3mm;margin-top:2mm;font-size:13px;font-weight:700}.manager-signature div{white-space:nowrap}.footnote{font-size:12px;font-weight:700;line-height:1.55;border-top:1px solid #111;padding-top:2mm;margin-top:3mm}.source{display:flex;justify-content:space-between;gap:4mm;margin-top:auto;padding-top:4mm;font-size:12px;color:#555}.source .right{white-space:nowrap}@media print{html,body{height:297mm}.sheet{break-inside:avoid;page-break-inside:avoid}}
  </style><style>
    .top{direction:ltr;min-height:22mm;gap:2mm}.meta,.state{direction:rtl}.meta{padding-right:5mm}.form-code{text-align:left;direction:rtl;margin:.5mm 0;font-size:12px;line-height:1.25}.form-title{font-size:19px;margin-bottom:1mm}.fields{font-size:12px;margin-bottom:.5mm}.fields th,.fields td{height:6mm}.civil-boxes{height:5mm}.teacher-table th,.teacher-table td{height:6mm}.greeting{font-size:13px;line-height:1.2;margin-top:0}.case-intro{justify-content:flex-start;gap:3mm;font-size:12px;margin-top:.5mm}.options{font-size:12px;line-height:1.3;margin-top:0}.request{font-size:12px;line-height:1.25;margin:0}.signatures{grid-template-columns:1fr 1fr 1fr;gap:2mm;margin-top:1mm;font-size:10px}.divider{margin:1.5mm 0 .5mm}.section-title,.manager-title{font-size:15px;margin:0 0 .5mm}.reply{font-size:12px;line-height:1.2;margin:0}.writing-lines{gap:1.5mm;margin-top:0}.writing-lines div{height:1.4mm}.reply-signatures{margin-top:1mm;font-size:9px}.manager-options{font-size:11px;line-height:1.2}.manager-writing-lines{display:grid;gap:1.5mm;margin:.5mm 0}.manager-writing-lines div{height:1.3mm;border-bottom:1px dotted #111}.manager-signature{gap:2mm;margin-top:.5mm;font-size:9px}.footnote{font-size:8px;line-height:1.2;padding-top:.5mm;margin-top:1mm}.source{font-size:8px;padding-top:1mm}
    @media print{html,body{height:297mm;min-height:297mm;overflow:hidden}.sheet{height:289mm;min-height:0;margin:4mm;padding:3mm 5mm 2mm;overflow:hidden;break-inside:avoid;page-break-inside:avoid}}
  </style><style>
    .meta{padding-right:7mm;font-size:11pt;line-height:1.65}.form-code{font-size:13pt}.form-title{font-size:20pt}.fields{font-size:11pt}.greeting{font-size:12pt;line-height:1.4;margin-top:1.5mm}.case-intro{justify-content:flex-start;gap:2mm;font-size:11.5pt;margin-top:2mm}.options{font-size:11pt;line-height:1.6;margin-top:1mm}.request{font-size:11pt;line-height:1.45;margin:1.5mm 0}.signatures{margin-top:3mm;font-size:10pt}.divider{margin:3mm 0 1.5mm}.section-title,.manager-title{font-size:16pt;font-weight:800;margin:1mm 0 1.5mm}.reply{font-size:11pt;line-height:1.4}.writing-lines{gap:2.2mm}.reply-signatures{margin-top:3mm;font-size:10pt}.manager-options{font-size:11pt;font-weight:700;line-height:1.5}.manager-signature{margin-top:2mm;font-size:10pt;font-weight:700}.footnote{font-size:9pt;line-height:1.4;margin-top:3mm}
  </style><style>
    .preview-actions{position:fixed;z-index:1000;top:8px;left:8px;right:8px;display:flex;justify-content:center;gap:8px;padding:8px;background:rgba(15,23,42,.92);border-radius:10px;font-family:Tahoma,Arial,sans-serif}
    .preview-actions button{min-height:42px;padding:8px 16px;border:0;border-radius:7px;background:#fff;color:#123b63;font:700 14px Tahoma,Arial,sans-serif}
    .preview-actions .close-preview{background:#fee2e2;color:#991b1b}
    @media print{.preview-actions{display:none}}
  </style></head><body><nav class="preview-actions" aria-label="خيارات المعاينة"><button type="button" onclick="window.print()">طباعة</button><button type="button" class="close-preview" onclick="closePreview()">العودة للموقع</button></nav>${contents}<script>
    function closePreview(){
      var openerWindow=window.opener;
      window.close();
      setTimeout(function(){
        if(window.closed)return;
        if(openerWindow&&!openerWindow.closed){window.location.replace(openerWindow.location.href);return}
        if(window.history.length>1){window.history.back();return}
        window.location.replace('/');
      },250);
    }
    window.addEventListener('load',function(){setTimeout(function(){window.print()},300)});
  <\/script></body></html>`)
  popup.document.close()
  return true
}

export function downloadWorkbook(name: string, rows: Array<Array<string | number>>, sheetName = 'تقرير', schoolName = '', reportTitle = name) {
  const workbook = XLSX.utils.book_new()
  const columnCount = Math.max(rows[0]?.length || 1, 1)
  const brandedRows: Array<Array<string | number>> = [[schoolName], [reportTitle], [`تاريخ التصدير: ${formatHijriDate(today())}`], [], ...rows]
  const sheet = XLSX.utils.aoa_to_sheet(brandedRows)
  const widths = Array.from({ length: columnCount }, (_, column) => {
    const width = brandedRows.reduce((max, row) => Math.max(max, String(row[column] ?? '').length), 12)
    return { wch: Math.min(42, Math.max(15, width + 2)) }
  })
  sheet['!cols'] = widths
  sheet['!merges'] = [0, 1, 2].map(row => ({ s: { r: row, c: 0 }, e: { r: row, c: columnCount - 1 } }))
  sheet['!views'] = [{ rightToLeft: true, state: 'frozen', ySplit: 5 }]
  sheet['!autofilter'] = { ref: `A5:${XLSX.utils.encode_col(columnCount - 1)}${brandedRows.length}` }
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  workbook.Props = { Title: reportTitle, Subject: schoolName, Author: schoolName }
  XLSX.writeFile(workbook, `${name}.xlsx`)
}

export function AlmadarSettings({ schoolName }: { schoolName: string }) {
  const [configured, setConfigured] = useState(false)
  const [senderName, setSenderName] = useState('')
  const [savedSenderName, setSavedSenderName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [testPhone, setTestPhone] = useState('')
  const [notice, setNotice] = useState('')
  const [balance, setBalance] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const load = () => {
    void api.almadar().then(({ account }) => {
      setConfigured(account.configured)
      setSenderName(account.senderName || '')
      setSavedSenderName(account.senderName || '')
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
      setSavedSenderName(senderName.trim())
      setNotice('تم حفظ بيانات حساب المدار التقني بشكل مشفر.')
      load()
    } catch { setNotice('تعذر حفظ الحساب. تحقق من البيانات ثم أعد المحاولة.') } finally { setBusy(false) }
  }

  const testSend = async () => {
    if (!configured) { setNotice('احفظ إعداد حساب المدار أولاً، ثم أرسل رسالة الاختبار.'); return }
    if (!senderName.trim() || senderName.trim() !== savedSenderName) { setNotice('احفظ اسم المرسل قبل إرسال رسالة الاختبار.'); return }
    const digits = testPhone.replace(/\D/g, '')
    const normalizedPhone = digits.startsWith('966') ? digits : `966${digits.replace(/^0+/, '')}`
    if (!/^9665\d{8}$/.test(normalizedPhone)) { setNotice('أدخل رقم جوال سعودي صحيحًا بصيغة 05 أو 966.'); return }
    const testMessage = 'مرحبا بك في نظام حصر الطلاب'
    if (!window.confirm(`سيتم إرسال رسالة اختبار مدفوعة واحدة إلى ${normalizedPhone} وقد تخصم من رصيد المدار.\n\nنص الرسالة: ${testMessage}\n\nهل تريد المتابعة؟`)) return
    setTesting(true)
    setNotice('جارٍ إرسال رسالة الاختبار عبر المدار التقني...')
    try {
      const result = await api.testAlmadar(normalizedPhone)
      setNotice(`قبل المدار طلب إرسال رسالة الاختبار إلى الرقم المنتهي بـ ${result.recipientSuffix}. تحقق من وصولها إلى جوال المدير.`)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      const messages: Record<string, string> = {
        invalid_test_phone: 'رقم جوال المدير غير صحيح. أدخل رقمًا يبدأ بـ 05 أو 966.',
        almadar_not_configured: 'احفظ إعداد حساب المدار أولاً.',
        almadar_sender_name_rejected: 'رفض المدار اسم المرسل. تحقق من أنه مفعّل لهذا الحساب واكتبه كما يظهر في لوحة المدار.',
        almadar_insufficient_balance: 'تعذر إرسال الاختبار بسبب رصيد الرسائل. تحقق من الرصيد في حساب المدار.',
        api_key_not_authorized: 'رفض المدار مفتاح API. تحقق من المفتاح المحفوظ في إعدادات الحساب.',
        almadar_test_send_failed: 'لم يقبل المدار رسالة الاختبار. راجع اسم المرسل والرصيد وبيانات الحساب، ثم راجع سجل الرسائل للتفاصيل.',
      }
      setNotice(messages[code] || 'تعذر الاتصال بخدمة إرسال المدار. تحقق من اتصال الخادم ثم أعد المحاولة.')
    } finally { setTesting(false) }
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
    {configured && <div className="almadar-test-controls">
      <label className="school-settings-field">رقم جوال المدير<input type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={testPhone} onChange={event => setTestPhone(event.target.value)} placeholder="05xxxxxxxx أو 9665xxxxxxxx" /></label>
      <div><button className="secondary-button" type="button" onClick={() => void testSend()} disabled={busy || testing || !senderName.trim() || senderName.trim() !== savedSenderName}><Send size={16} /> إرسال رسالة اختبار مدفوعة للمدير</button><small>ترسل رسالة واحدة بالنص: «مرحبا بك في نظام حصر الطلاب»</small></div>
    </div>}
    {notice && <div className="notice-box settings-notice" role="status">{notice}</div>}</>}
  </section>
}

export function MessageCenter({ students, attendance, schoolName }: { students: FeatureStudent[]; attendance: FeatureAttendance[]; schoolName: string }) {
  const [accountReady, setAccountReady] = useState(false)
  const [type, setType] = useState<MessageKind>('general')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [logs, setLogs] = useState<MessageLog[]>([])
  const [confirmedAbsenceIds, setConfirmedAbsenceIds] = useState<Set<string>>(new Set())
  const [absenceCandidatesLoading, setAbsenceCandidatesLoading] = useState(false)
  const [showStudentDetails, setShowStudentDetails] = useState(false)
  const [showLogDetails, setShowLogDetails] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const [sending, setSending] = useState(false)

  const load = () => {
    setLogsLoading(true)
    void Promise.all([api.almadar(), api.messages(type)]).then(([account, history]) => {
      setAccountReady(account.account.configured)
      setLogs(history.messages)
    }).catch(() => setNotice('تعذر تحميل حالة الرسائل.'))
      .finally(() => setLogsLoading(false))
  }
  useEffect(() => { load() }, [type])

  useEffect(() => {
    if (type !== 'absence') return
    let active = true
    setAbsenceCandidatesLoading(true)
    void api.absenceReport(today(), today()).then(result => {
      if (!active) return
      const absenceIds = result.rows
        .map(row => row.studentId || row.id)
        .filter((id): id is string => Boolean(id))
      setConfirmedAbsenceIds(new Set(absenceIds))
    }).catch(() => {
      if (active) setNotice('تعذر تحديث قائمة الغياب المعتمدة. أعد فتح تبويب رسائل الغياب.')
    }).finally(() => {
      if (active) setAbsenceCandidatesLoading(false)
    })
    return () => { active = false }
  }, [type])

  const lateIds = useMemo(() => new Set(attendance.filter(record => record.status === 'late').map(record => record.studentId)), [attendance])
  const attendanceIds = useMemo(() => new Set(attendance.map(record => record.studentId)), [attendance])
  const eligibleCandidates = useMemo(() => students.filter(student => {
    if (type === 'late' && !lateIds.has(student.id)) return false
    if (type === 'absence' && (!confirmedAbsenceIds.has(student.id) || attendanceIds.has(student.id))) return false
    return true
  }), [students, type, lateIds, confirmedAbsenceIds, attendanceIds])
  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase()
    return !query ? eligibleCandidates : eligibleCandidates.filter(student => `${student.name} ${student.id} ${student.grade} ${student.classroom}`.toLowerCase().includes(query))
  }, [eligibleCandidates, search])
  const visibleCandidates = useMemo(() => candidates.slice(0, MESSAGE_CANDIDATE_LIMIT), [candidates])
  const hasMoreCandidates = candidates.length > visibleCandidates.length
  const visibleLogs = useMemo(() => logs.filter(log => log.type === type), [logs, type])
  const visibleLogRows = useMemo(() => visibleLogs.slice(0, MESSAGE_LOG_LIMIT), [visibleLogs])
  const hasMoreLogs = visibleLogs.length > visibleLogRows.length
  const currentLogTitle = messageLogTitle(type)

  const toggle = (studentId: string) => setSelected(current => {
    const next = new Set(current)
    next.has(studentId) ? next.delete(studentId) : next.add(studentId)
    return next
  })
  const chooseType = (nextType: MessageKind) => { setType(nextType); setSelected(new Set()); setMessage(''); setSearch(''); setShowStudentDetails(false); setShowLogDetails(false); setNotice('') }

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
      setShowStudentDetails(false)
      load()
    } catch { setNotice('تعذر إتمام الإرسال. راجع سجل الرسائل أو تحقق من حساب المدار التقني.') } finally { setSending(false) }
  }

  const exportMessageLogExcel = () => downloadWorkbook(
    currentLogTitle.replace(/\s+/g, '_'),
    [
      ['الوقت', 'الطالب / العملية', 'المستلم', 'اسم المرسل', 'النوع', 'الحالة', 'التفاصيل'],
    ...visibleLogs.map(log => [
        formatDateTime(log.createdAt),
        log.studentName || '—',
        maskPhone(log.recipient),
        log.senderName || '—',
        messageTypeText(log.type),
        log.status === 'sent' ? (log.type === 'test' ? 'قُبل طلب الإرسال' : 'تم الإرسال') : 'فشل',
        log.errorDetail || log.body,
      ]),
    ],
    currentLogTitle,
    schoolName,
    currentLogTitle,
  )

  const exportMessageLogPdf = () => {
    const body = visibleLogs.map(log => `<tr>
      <td>${escapeHtml(formatDateTime(log.createdAt))}</td>
      <td>${escapeHtml(log.studentName || '—')}</td>
      <td dir="ltr">${escapeHtml(maskPhone(log.recipient))}</td>
      <td>${escapeHtml(log.senderName || '—')}</td>
      <td>${messageTypeText(log.type)}</td>
      <td>${log.status === 'sent' ? (log.type === 'test' ? 'قُبل طلب الإرسال' : 'تم الإرسال') : 'فشل'}</td>
      <td>${escapeHtml(log.errorDetail || log.body)}</td>
    </tr>`).join('')
    const title = currentLogTitle
    const emptyRow = '<tr><td colspan="7">لا توجد عمليات مسجلة لهذا النوع حتى الآن.</td></tr>'
    openPrintDocument(title, `<section class="page"><table><thead><tr><th>الوقت</th><th>الطالب / العملية</th><th>المستلم</th><th>اسم المرسل</th><th>النوع</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>${body || emptyRow}</tbody></table><p class="meta">عدد العمليات: ${visibleLogs.length} · آخر 200 عملية</p></section>`, schoolName, 'landscape')
  }

  return <section className="feature-page">
    <section className="panel feature-intro"><div><span className="panel-kicker">المدار التقني</span><h2>الرسائل النصية</h2><p>اختر الطلاب، راجع النوع، ثم أرسل. رسائل الغياب والتأخر تنشأ تلقائياً باسم الطالب والمدرسة.</p></div><Mail size={34} /></section>
    <section className="panel message-compose-panel">
      <div className="message-type-tabs">
        <button className={type === 'general' ? 'active' : ''} onClick={() => chooseType('general')} type="button">رسالة عامة</button>
        <button className={type === 'late' ? 'active' : ''} onClick={() => chooseType('late')} type="button">رسائل التأخر اليوم</button>
        <button className={type === 'absence' ? 'active' : ''} onClick={() => chooseType('absence')} type="button">رسائل الغياب اليوم</button>
      </div>
      {type === 'general' ? <label className="message-body-field">نص الرسالة<textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="اكتب الرسالة التي سترسل للطلاب المحددين..." maxLength={1200} /></label> : <div className="automatic-message-note">سيُنشأ النص تلقائياً لكل طالب بحسب {type === 'late' ? 'وقت تأخره' : 'غيابه المعتمد'} اليوم، ويتضمن اسمه واسم المدرسة.</div>}
      <div className="message-recipient-summary">
        <div className="message-recipient-count"><span>عدد الطلاب المناسبين</span><strong>{type === 'absence' && absenceCandidatesLoading ? '…' : eligibleCandidates.length}</strong></div>
        <div className="feature-actions">
          <button type="button" className="secondary-button" onClick={() => setShowStudentDetails(value => !value)} aria-expanded={showStudentDetails} aria-controls="message-student-list" disabled={type === 'absence' && absenceCandidatesLoading}>{showStudentDetails ? 'إخفاء بيانات الطلاب' : `عرض بيانات الطلاب (${eligibleCandidates.length})`}</button>
          {showStudentDetails && <button type="button" className="secondary-button" onClick={() => setSelected(new Set(visibleCandidates.map(student => student.id)))} disabled={!visibleCandidates.length}>تحديد المعروضين ({visibleCandidates.length})</button>}
          <button type="button" className="primary-button" onClick={() => void send()} disabled={sending || !selected.size}><Send size={16} /> إرسال إلى {selected.size}</button>
        </div>
      </div>
      {showStudentDetails && <>
        <div className="feature-toolbar"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث عن طالب بالاسم أو الرقم..." /><span className="message-search-count">المعروض: {candidates.length} من {eligibleCandidates.length}</span></div>
        {hasMoreCandidates && <p className="message-candidate-hint">يعرض أول {MESSAGE_CANDIDATE_LIMIT} طالباً فقط. استخدم البحث للوصول لطالب محدد.</p>}
        <div className="table-wrap" id="message-student-list"><table className="feature-table"><thead><tr><th>اختيار</th><th>الطالب</th><th>الصف والفصل</th><th>الجوال</th></tr></thead><tbody>{visibleCandidates.map(student => <tr key={student.id}><td data-label="اختيار"><input type="checkbox" checked={selected.has(student.id)} onChange={() => toggle(student.id)} /></td><td data-label="الطالب"><strong>{student.name}</strong><small>{student.id}</small></td><td data-label="الصف والفصل">{student.grade || '—'} · {student.classroom || '—'}</td><td data-label="الجوال" dir="ltr">{student.phone || '—'}</td></tr>)}{!candidates.length && <tr><td colSpan={4}>لا يوجد طلاب مناسبون لهذا النوع من الرسائل اليوم.</td></tr>}</tbody></table></div>
      </>}
      {notice && <div className="notice-box" role="status">{notice}</div>}
    </section>
    <section className="panel message-log-panel">
      <div className="panel-header">
        <div>
          <span className="panel-kicker">آخر 200 عملية من هذا النوع</span>
          <h2>{currentLogTitle}</h2>
        </div>
        <div className="feature-actions">
          <button className="secondary-button" type="button" onClick={() => setShowLogDetails(value => !value)} aria-expanded={showLogDetails}>
            {showLogDetails ? 'إخفاء السجل' : `عرض السجل (${visibleLogs.length})`}
          </button>
          <button className="export-btn csv" type="button" onClick={exportMessageLogExcel} disabled={!visibleLogs.length}><Download size={16} /> Excel</button>
          <button className="export-btn pdf" type="button" onClick={exportMessageLogPdf} disabled={!visibleLogs.length}><Printer size={16} /> PDF</button>
        </div>
      </div>
      <div className="message-log-summary">
        <div className="message-log-count"><span>عدد العمليات</span><strong>{logsLoading ? '…' : visibleLogs.length}</strong></div>
        {hasMoreLogs && showLogDetails && <span className="message-candidate-hint">يعرض آخر {MESSAGE_LOG_LIMIT} عملية فقط. التصدير يشمل العمليات المحملة كلها.</span>}
      </div>
      {showLogDetails && <div className="table-wrap"><table className="feature-table"><thead><tr><th>الوقت</th><th>الطالب / العملية</th><th>المستلم</th><th>اسم المرسل</th><th>النوع</th><th>الحالة</th><th>التفاصيل</th></tr></thead><tbody>{visibleLogRows.map(log => <tr key={log.id}><td data-label="الوقت">{formatDateTime(log.createdAt)}</td><td data-label="الطالب / العملية">{log.studentName || '—'}</td><td data-label="المستلم" dir="ltr">{maskPhone(log.recipient)}</td><td data-label="اسم المرسل">{log.senderName || '—'}</td><td data-label="النوع">{messageTypeText(log.type)}</td><td data-label="الحالة"><span className={`status-chip ${log.status === 'sent' ? 'success' : 'failed'}`}>{log.status === 'sent' ? log.type === 'test' ? 'قُبل طلب الإرسال' : 'تم الإرسال' : 'فشل'}</span></td><td data-label="التفاصيل">{log.errorDetail || log.body}</td></tr>)}{!visibleLogs.length && <tr><td colSpan={7}>لا توجد عمليات من هذا النوع حتى الآن.</td></tr>}</tbody></table></div>}
    </section>
  </section>
}

type DailyRow = { studentId: string; name: string; grade: string; classroom: string; phone: string; status: 'unexcused' | 'excused'; date: string; time?: string }
type CountRow = { studentId: string; name: string; grade: string; classroom: string; phone: string; days: number; excusedDays: number; unexcusedDays: number }
type History = { student: { studentId: string; name: string; grade: string; classroom: string; phone: string }; type: 'absence' | 'late'; days: Array<{ date: string; status: 'unexcused' | 'excused'; time?: string }> }
const statusText = (status: 'unexcused' | 'excused') => status === 'excused' ? 'بعذر' : 'بدون عذر'

function exportDaily(title: string, rows: DailyRow[], schoolName: string) {
  const reportTitle = title.startsWith('غياب_') ? 'غياب الطلاب' : 'تأخر الطلاب'
  downloadWorkbook(title, [['اسم الطالب', 'الصف', 'الفصل', 'رقم الجوال', 'الحالة'], ...rows.map(row => [row.name, row.grade, row.classroom, row.phone, statusText(row.status)])], reportTitle, schoolName, reportTitle)
}

function printDaily(title: string, rows: DailyRow[], schoolName: string, date: string) {
  openPrintDocument(title, `<section class="page"><h1>${escapeHtml(title)}</h1><table><thead><tr><th>الطالب</th><th>الصف</th><th>الفصل</th><th>الجوال</th><th>الحالة</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.grade)}</td><td>${escapeHtml(row.classroom)}</td><td dir="ltr">${escapeHtml(row.phone)}</td><td>${statusText(row.status)}</td></tr>`).join('')}</tbody></table><p class="meta">${escapeHtml(formatHijriDate(date))}</p></section>`, schoolName)
  return <section id={id} className="panel daily-report-panel"><div className="panel-header"><div><span className="panel-kicker">سجل يومي</span><h2>{title}</h2><p>العدد: {rows.length} طالبًا</p>{onCancelApproval && <p>اختر تاريخًا سابقًا من التقويم لمراجعة سجله أو إلغاء اعتماده.</p>}</div><HijriDatePicker label="التاريخ الهجري" value={date} max={today()} disabled={busy || cancelBusy} onChange={onDate} /></div><div className="feature-actions daily-actions" aria-busy={busy || cancelBusy}><button className="secondary-button" type="button" onClick={() => onAll('excused')} disabled={!rows.length || busy || cancelBusy}>اعتبار الجميع بعذر</button><button className="secondary-button" type="button" onClick={() => onAll('unexcused')} disabled={!rows.length || busy || cancelBusy}>اعتبار الجميع بدون عذر</button>{onCancelApproval && <button className="danger-button cancel-absence-approval" type="button" onClick={onCancelApproval} disabled={!rows.length || busy || cancelBusy}><XCircle size={16} />{cancelBusy ? 'جارٍ إلغاء الاعتماد...' : 'إلغاء اعتماد هذا اليوم'}</button>}<button className="export-btn csv" type="button" onClick={onExcel} disabled={!rows.length}><Download size={16} /> Excel</button><button className="export-btn pdf" type="button" onClick={onPdf} disabled={!rows.length}><Printer size={16} /> PDF</button></div>{actionNotice && <p className="report-action-notice" role="status" aria-live="polite">{actionNotice}</p>}<div className="daily-list">{rows.map(row => <article key={row.studentId} className="daily-row"><div><strong>{row.name}</strong><small>{row.grade || '—'} · {row.classroom || '—'} · <span dir="ltr">{row.phone || '—'}</span>{late && row.time ? ` · ${row.time}` : ''}</small></div><select value={row.status} disabled={busy || cancelBusy} onChange={event => onStatus([row.studentId], event.target.value as 'unexcused' | 'excused')}><option value="unexcused">بدون عذر</option><option value="excused">بعذر</option></select></article>)}</div></section>
}

function DailyList({ id, title, date, onDate, rows, onStatus, onAll, onExcel, onPdf, onCancelApproval, cancelBusy = false, busy = false, actionNotice = '', late = false }: { id?: string; title: string; date: string; onDate: (value: string) => void; rows: DailyRow[]; onStatus: (ids: string[], status: 'unexcused' | 'excused') => void; onAll: (status: 'unexcused' | 'excused') => void; onExcel: () => void; onPdf: () => void; onCancelApproval?: () => void; cancelBusy?: boolean; busy?: boolean; actionNotice?: string; late?: boolean }) {
  return <section id={id} className="panel daily-report-panel">
    <div className="panel-header">
      <div><span className="panel-kicker">سجل يومي</span><h2>{title}</h2><p>العدد: {rows.length} طالبًا</p>{onCancelApproval && <p>اختر تاريخًا سابقًا من التقويم لمراجعة سجله أو إلغاء اعتماده.</p>}</div>
      <HijriDatePicker label="التاريخ الهجري" value={date} max={today()} disabled={busy || cancelBusy} onChange={onDate} />
    </div>
    <div className="feature-actions daily-actions" aria-busy={busy || cancelBusy}>
      <button className="secondary-button" type="button" onClick={() => onAll('excused')} disabled={!rows.length || busy || cancelBusy}>اعتبار الجميع بعذر</button>
      <button className="secondary-button" type="button" onClick={() => onAll('unexcused')} disabled={!rows.length || busy || cancelBusy}>اعتبار الجميع بدون عذر</button>
      {onCancelApproval && <button className="danger-button cancel-absence-approval" type="button" onClick={onCancelApproval} disabled={!rows.length || busy || cancelBusy}><XCircle size={16} />{cancelBusy ? 'جارٍ إلغاء الاعتماد...' : 'إلغاء اعتماد هذا اليوم'}</button>}
      <button className="export-btn csv" type="button" onClick={onExcel} disabled={!rows.length}><Download size={16} /> Excel</button>
      <button className="export-btn pdf" type="button" onClick={onPdf} disabled={!rows.length}><Printer size={16} /> PDF</button>
    </div>
    {actionNotice && <p className="report-action-notice" role="status" aria-live="polite">{actionNotice}</p>}
    <div className="daily-list">{rows.map(row => <article key={row.studentId} className="daily-row"><div><strong>{row.name}</strong><small>{row.grade || '—'} · {row.classroom || '—'} · <span dir="ltr">{row.phone || '—'}</span>{late && row.time ? ` · ${row.time}` : ''}</small></div><select value={row.status} disabled={busy || cancelBusy} onChange={event => onStatus([row.studentId], event.target.value as 'unexcused' | 'excused')}><option value="unexcused">بدون عذر</option><option value="excused">بعذر</option></select></article>)}{!rows.length && <p className="report-empty-state">لا توجد سجلات لهذا التاريخ.</p>}</div>
  </section>
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
  const open = async (row: CountRow) => {
    const result = await api.studentHistory(type, row.studentId)
    setHistory({ ...result, days: result.days.map(day => ({ ...day, date: formatHijriDate(day.date) })) } as History)
  }
  const printHistories = async (rows: CountRow[]) => {
    const histories = await Promise.all(rows.map(row => api.studentHistory(type, row.studentId)))
    openPrintDocument(reportTitle, histories.map(item => `<section class="page"><h1>${reportTitle}</h1><div class="heading"><p><span class="label">اسم الطالب:</span> ${escapeHtml(item.student.name)}</p><p><span class="label">الصف:</span> ${escapeHtml(item.student.grade)} · <span class="label">الفصل:</span> ${escapeHtml(item.student.classroom)}</p><table><thead><tr><th>التاريخ</th><th>الحالة</th>${type === 'late' ? '<th>الوقت</th>' : ''}</tr></thead><tbody>${item.days.map(day => `<tr><td>${escapeHtml(formatHijriDate(day.date))}</td><td>${statusText(day.status)}</td>${type === 'late' ? `<td>${escapeHtml(day.time || '—')}</td>` : ''}</tr>`).join('')}</tbody></table><p class="meta">عدد الأيام: ${item.days.length} · الجوال: <span dir="ltr">${escapeHtml(item.student.phone)}</span><br/>${formatHijriDate(today())}</p></div></section>`).join(''), schoolName)
  }
  return <section className="panel history-count-panel"><div className="panel-header"><div><span className="panel-kicker">ملخص تراكمي</span><h2>{title}</h2><p>ابحث وحدد الطلاب، أو افتح بطاقة لعرض فئتها.</p></div></div><div className="count-card-grid">{buckets.map(bucket => <button className={`count-card ${bucket.tone}`} type="button" key={bucket.tone} onClick={() => setShownRows(bucket.rows)}><span>{bucket.label.replace('غياب', type === 'late' ? 'تأخر' : 'غياب')}</span><strong>{bucket.rows.length} طالب</strong></button>)}</div><div className="student-picker"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الطالب..." />{matches.map(student => <label key={student.id}><input type="checkbox" checked={selected.has(student.id)} onChange={() => setSelected(current => { const next = new Set(current); next.has(student.id) ? next.delete(student.id) : next.add(student.id); return next })} /> {student.name} · {student.grade} · {student.classroom}</label>)}<button type="button" className="primary-button" onClick={() => void load([...selected])} disabled={!selected.size}><CheckCircle2 size={16} /> تأكيد الطلاب المحددين</button><button type="button" className="secondary-button" onClick={() => { setSelected(new Set()); void load() }}>عرض الجميع</button></div><div className="feature-actions"><button type="button" className="export-btn csv" onClick={() => downloadWorkbook(title, [['الطالب','الصف','الفصل','الجوال','عدد الأيام','بعذر','بدون عذر'], ...shownRows.map(row => [row.name,row.grade,row.classroom,row.phone,row.days,row.excusedDays,row.unexcusedDays])], title, schoolName, title)} disabled={!shownRows.length}><Download size={16} /> Excel</button><button type="button" className="export-btn pdf" onClick={() => void printHistories(shownRows)} disabled={!shownRows.length}><Printer size={16} /> PDF لجميع الظاهرين</button></div><div className="daily-list">{shownRows.map(row => <button type="button" className="history-row" key={row.studentId} onClick={() => void open(row)}><span><strong>{row.name}</strong><small>{row.grade} · {row.classroom} · <bdi>{row.phone}</bdi></small></span><strong>{row.days} يومًا</strong></button>)}{!shownRows.length && <p className="report-empty-state">لا توجد بيانات ضمن هذا الاختيار.</p>}</div>{history && <div className="report-modal-overlay"><section className="report-modal"><header className="report-modal-header"><div><span className="panel-kicker">تفاصيل الطالب</span><h2>{history.student.name}</h2><p>{history.student.grade} · {history.student.classroom} · <bdi>{history.student.phone}</bdi></p></div><button type="button" className="modal-close-button" onClick={() => setHistory(null)}>×</button></header><div className="report-modal-actions"><button type="button" className="export-btn csv" onClick={() => downloadWorkbook(`${reportTitle}_${history.student.name}`, [['التاريخ','الحالة', ...(type === 'late' ? ['الوقت'] : [])], ...history.days.map(day => [day.date,statusText(day.status), ...(type === 'late' ? [day.time || '—'] : [])])], reportTitle, schoolName, `${reportTitle} - ${history.student.name}`)}>Excel</button><button type="button" className="export-btn pdf" onClick={() => void printHistories([{ studentId: history.student.studentId, name: history.student.name, grade: history.student.grade, classroom: history.student.classroom, phone: history.student.phone, days: history.days.length, excusedDays: 0, unexcusedDays: 0 }])}>PDF</button></div><div className="absence-detail-list">{history.days.map(day => <article className="absence-day-card" key={day.date}><strong>{day.date}</strong><span>{statusText(day.status)}{type === 'late' && day.time ? ` · ${day.time}` : ''}</span></article>)}</div></section></div>}</section>
}

type ReportSection = 'pending' | 'phones' | 'absences' | 'absence-history' | 'lates' | 'late-history' | 'student-detail'

export function ReportsCenter({ students, schoolName }: { students: FeatureStudent[]; schoolName: string }) {
  const [activeReport, setActiveReport] = useState<ReportSection>('pending')
  const [todayMissingCount, setTodayMissingCount] = useState<number | null>(null)
  const [todayConfirmedCount, setTodayConfirmedCount] = useState<number | null>(null)
  const [absenceDate, setAbsenceDate] = useState(today())
  const [lateDate, setLateDate] = useState(today())
  const [absences, setAbsences] = useState<DailyRow[]>([])
  const [lates, setLates] = useState<DailyRow[]>([])
  const [notice, setNotice] = useState('')
  const [dailyStatusNotice, setDailyStatusNotice] = useState('')
  const [updatingDailyStatus, setUpdatingDailyStatus] = useState(false)
  const [calculatingAbsences, setCalculatingAbsences] = useState(false)
  const [cancelingAbsences, setCancelingAbsences] = useState(false)
  const [cancelingSelectedAbsenceDate, setCancelingSelectedAbsenceDate] = useState(false)
  const [focusDailyAbsenceLog, setFocusDailyAbsenceLog] = useState(false)

  const loadToday = async () => {
    const date = today()
    const [pending, confirmed] = await Promise.all([api.missingAttendance(date), api.dailyAbsences(date)])
    setTodayMissingCount(pending.count)
    setTodayConfirmedCount(confirmed.rows.length)
  }
  const loadAbsences = async (date = absenceDate) => setAbsences((await api.dailyAbsences(date)).rows as DailyRow[])
  const loadLates = async (date = lateDate) => setLates((await api.dailyLates(date)).rows as DailyRow[])

  useEffect(() => {
    void Promise.all([loadToday(), loadAbsences(), loadLates()]).catch(() => setNotice('تعذر تحميل بعض بيانات التقارير.'))
  }, [])

  useEffect(() => {
    if (!focusDailyAbsenceLog || activeReport !== 'absences') return
    document.getElementById('daily-absence-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setFocusDailyAbsenceLog(false)
  }, [focusDailyAbsenceLog, activeReport, absences])

  const calculate = async () => {
    if (calculatingAbsences || !todayMissingCount) return
    if (!window.confirm(`سيُعتمد غياب ${todayMissingCount} طالبًا لهذا اليوم. هل تريد المتابعة؟`)) return
    setCalculatingAbsences(true)
    try {
      const date = today()
      await api.calculateAbsences(date)
      const [pending, daily] = await Promise.all([api.missingAttendance(date), api.dailyAbsences(date)])
      setTodayMissingCount(pending.count)
      setTodayConfirmedCount(daily.rows.length)
      setAbsenceDate(date)
      setAbsences(daily.rows as DailyRow[])
      setActiveReport('absences')
      setNotice('تم اعتماد الغياب، وظهرت الأسماء في سجل غياب الطلاب.')
      setFocusDailyAbsenceLog(true)
    } catch {
      setNotice('تعذر اعتماد الغياب أو تحديث السجل. أعد المحاولة.')
    } finally {
      setCalculatingAbsences(false)
    }
  }
  const cancelTodayAbsences = async () => {
    if (cancelingAbsences || !todayConfirmedCount) return
    if (!window.confirm(`سيؤدي هذا إلى إلغاء اعتماد غياب ${todayConfirmedCount} طالبًا لهذا اليوم وحذف سجلات غيابهم المعتمدة. سيعود من لم يسجل حضورًا إلى قائمة غياب اليوم، ولن يُحتسب له يوم غياب. لا يمكن التراجع عن هذا الإجراء. هل تريد المتابعة؟`)) return
    setCancelingAbsences(true)
    setNotice('جارٍ إلغاء اعتماد غياب اليوم...')
    try {
      const date = today()
      const result = await api.cancelAbsences(date)
      const [pending, remaining] = await Promise.all([api.missingAttendance(date), api.dailyAbsences(date)])
      setTodayMissingCount(pending.count)
      setTodayConfirmedCount(remaining.rows.length)
      setAbsenceDate(date)
      setAbsences(remaining.rows as DailyRow[])
      setNotice(`تم إلغاء اعتماد الغياب وحذف ${result.deleted} سجلًا لهذا اليوم. لم تُسجل هذه الأيام ضمن عدد الغياب.`)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setNotice(code === 'forbidden' ? 'يلزم استخدام حساب مدير المدرسة لإلغاء اعتماد الغياب.' : 'تعذر إلغاء اعتماد الغياب. تحقق من الاتصال ثم أعد المحاولة.')
    } finally {
      setCancelingAbsences(false)
    }
  }

  const cancelSelectedAbsenceDate = async () => {
    const date = absenceDate
    const count = absences.length
    if (cancelingSelectedAbsenceDate || !count) return
    if (!window.confirm(`سيؤدي هذا إلى إلغاء اعتماد غياب ${count} طالبًا بتاريخ ${formatHijriDate(date)} وحذف سجلات الغياب لهذا التاريخ فقط. لن تُحتسب هذه الأيام ضمن الغياب، ولن تتأثر الأيام الأخرى أو سجلات الحضور. لا يمكن التراجع عن الحذف. هل تريد المتابعة؟`)) return
    setCancelingSelectedAbsenceDate(true)
    setDailyStatusNotice(`جارٍ إلغاء اعتماد غياب ${formatHijriDate(date)}...`)
    try {
      const result = await api.cancelAbsences(date)
      const remaining = await api.dailyAbsences(date)
      setAbsences(remaining.rows as DailyRow[])
      if (date === today()) await loadToday()
      setDailyStatusNotice(`تم إلغاء اعتماد غياب ${formatHijriDate(date)} وحذف ${result.deleted} سجلًا. لم تُحتسب هذه الأيام ضمن عدد الغياب.`)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setDailyStatusNotice(code === 'forbidden' ? 'يلزم استخدام حساب مدير المدرسة لإلغاء اعتماد الغياب.' : 'تعذر إلغاء اعتماد الغياب. تحقق من الاتصال ثم أعد المحاولة.')
    } finally {
      setCancelingSelectedAbsenceDate(false)
    }
  }

  const updateAbsence = async (ids: string[], status: 'unexcused' | 'excused') => {
    if (updatingDailyStatus) return
    setUpdatingDailyStatus(true)
    setDailyStatusNotice('جارٍ تحديث حالات الغياب...')
    try {
      const result = await api.setAbsenceStatus({ studentIds: ids, from: absenceDate, to: absenceDate, status })
      await loadAbsences()
      setDailyStatusNotice(`تم تحديث حالة الغياب لـ ${result.affectedStudents} طالبًا.`)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setDailyStatusNotice(code === 'forbidden' ? 'يلزم استخدام حساب مدير المدرسة لتعديل سجل الغياب.' : 'تعذر تحديث حالة الغياب. تحقق من السجل وحاول مرة أخرى.')
    } finally {
      setUpdatingDailyStatus(false)
    }
  }
  const updateLate = async (ids: string[], status: 'unexcused' | 'excused') => {
    if (updatingDailyStatus) return
    setUpdatingDailyStatus(true)
    setDailyStatusNotice('جارٍ تحديث حالات التأخر...')
    try {
      const result = await api.setDailyLateStatus({ date: lateDate, studentIds: ids, status })
      await loadLates()
      setDailyStatusNotice(`تم تحديث حالة التأخر لـ ${result.updated} سجلًا.`)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setDailyStatusNotice(code === 'forbidden' ? 'يلزم استخدام حساب مدير المدرسة لتعديل سجل التأخر.' : 'تعذر تحديث حالة التأخر. تحقق من السجل وحاول مرة أخرى.')
    } finally {
      setUpdatingDailyStatus(false)
    }
  }
  const exportPendingExcel = () => downloadWorkbook(
    `ملخص_غياب_اليوم_${formatHijriDate(today())}`,
    [['التاريخ الهجري', 'عدد الطلاب بانتظار الاعتماد'], [formatHijriDate(today()), todayMissingCount ?? 0]],
    'غياب اليوم', schoolName, 'ملخص غياب اليوم',
  )
  const exportPendingPdf = () => openPrintDocument(
    'ملخص غياب اليوم',
    `<section class="page"><h1>ملخص غياب اليوم</h1><table><thead><tr><th>التاريخ الهجري</th><th>عدد الطلاب بانتظار الاعتماد</th></tr></thead><tbody><tr><td>${escapeHtml(formatHijriDate(today()))}</td><td>${todayMissingCount ?? 0}</td></tr></tbody></table></section>`,
    schoolName,
  )

  const tabs: Array<{ id: ReportSection; label: string; count?: number | null }> = [
    { id: 'pending', label: 'غياب اليوم', count: todayMissingCount },
    { id: 'absences', label: 'سجل الغياب', count: absenceDate === today() ? todayConfirmedCount : absences.length },
    { id: 'absence-history', label: 'أيام الغياب' },
    { id: 'lates', label: 'سجل التأخر', count: lates.length },
    { id: 'late-history', label: 'أيام التأخر' },
    { id: 'student-detail', label: 'التقرير المفصل للطالب' },
    { id: 'phones', label: 'هواتف الطلاب', count: students.length },
  ]

  return <section className="feature-page reports-center">
    <section className="panel feature-intro">
      <div><span className="panel-kicker">إدارة المدرسة</span><h2>التقارير</h2><p>اختر التقرير المطلوب. يظهر قسم واحد في كل مرة، ويمكن تصدير تقاريره إلى Excel أو PDF.</p></div>
      <FileText size={34} />
    </section>

    <nav className="report-section-tabs" role="tablist" aria-label="أقسام التقارير">
      {tabs.map(tab => <button
        key={tab.id}
        id={`report-tab-${tab.id}`}
        className={`report-section-tab${activeReport === tab.id ? ' active' : ''}`}
        type="button"
        role="tab"
        aria-selected={activeReport === tab.id}
        aria-controls="report-section-content"
        onClick={() => setActiveReport(tab.id)}
      ><span>{tab.label}</span>{tab.count !== undefined && <strong>{tab.count ?? '—'}</strong>}</button>)}
    </nav>

    <div id="report-section-content" className="report-section-content" role="tabpanel" aria-labelledby={`report-tab-${activeReport}`}>
      {activeReport === 'pending' && <section className="panel daily-report-panel pending-absence-panel">
        <div className="panel-header">
          <div><span className="panel-kicker">متابعة مباشرة</span><h2>غياب اليوم</h2><p>عدد الطلاب الذين لم يسجلوا حضورًا أو تأخرًا حتى الآن. لا تُسجل أسماؤهم في الغياب قبل الاعتماد.</p></div>
          <div className="pending-absence-count" role="status" aria-live="polite" aria-atomic="true"><span>بانتظار الاعتماد</span><strong>{todayMissingCount ?? '—'}</strong></div>
          <button type="button" className="primary-button" onClick={() => void calculate()} disabled={todayMissingCount === null || todayMissingCount === 0 || calculatingAbsences}><CheckCircle2 size={16} /> {calculatingAbsences ? 'جارٍ اعتماد الغياب...' : 'اعتماد غياب الطلاب'}</button>
          {Boolean(todayConfirmedCount) && <button type="button" className="danger-button cancel-absence-approval" onClick={() => void cancelTodayAbsences()} disabled={cancelingAbsences || calculatingAbsences}><XCircle size={16} /> {cancelingAbsences ? 'جارٍ إلغاء الاعتماد...' : 'إلغاء اعتماد الغياب'}</button>}
        </div>
        <p className="pending-absence-hint">بعد الاعتماد تظهر الأسماء في قسم «سجل الغياب».</p>
        <div className="feature-actions daily-actions">
          <button className="export-btn csv" type="button" onClick={exportPendingExcel} disabled={todayMissingCount === null}><Download size={16} /> Excel</button>
          <button className="export-btn pdf" type="button" onClick={exportPendingPdf} disabled={todayMissingCount === null}><Printer size={16} /> PDF</button>
        </div>
        {todayMissingCount === 0 && <p className="report-empty-state">لا يوجد طالب بانتظار تسجيل الحضور الآن.</p>}
      </section>}

      {activeReport === 'phones' && <section className="panel">
        <div className="panel-header"><div><span className="panel-kicker">بيانات الاتصال</span><h2>تقرير هواتف الطلاب</h2></div><div className="feature-actions">
          <button type="button" className="export-btn csv" onClick={() => downloadWorkbook('تقرير_هواتف_الطلاب', [['اسم الطالب','الصف','الفصل','رقم الجوال'], ...students.map(student => [student.name,student.grade,student.classroom,student.phone])], 'هواتف الطلاب', schoolName, 'تقرير هواتف الطلاب')}><Download size={16} /> Excel</button>
          <button type="button" className="export-btn pdf" onClick={() => openPrintDocument('تقرير هواتف الطلاب', `<section class="page"><h1>تقرير هواتف الطلاب</h1><table><thead><tr><th>الطالب</th><th>الصف</th><th>الفصل</th><th>الجوال</th></tr></thead><tbody>${students.map(student => `<tr><td>${escapeHtml(student.name)}</td><td>${escapeHtml(student.grade)}</td><td>${escapeHtml(student.classroom)}</td><td dir="ltr">${escapeHtml(student.phone)}</td></tr>`).join('')}</tbody></table><p class="meta">${escapeHtml(schoolName)} · ${escapeHtml(formatHijriDate(today()))}</p></section>`, schoolName)}><Printer size={16} /> PDF</button>
        </div></div>
      </section>}

      {activeReport === 'absences' && <DailyList id="daily-absence-log" title="غياب الطلاب" date={absenceDate} onDate={value => { if (!value) return; setAbsenceDate(value); setDailyStatusNotice(''); void loadAbsences(value) }} rows={absences} onStatus={(ids, status) => void updateAbsence(ids, status)} onAll={status => void updateAbsence(absences.map(row => row.studentId), status)} onExcel={() => exportDaily(`غياب_${absenceDate}`, absences, schoolName)} onPdf={() => printDaily('غياب الطلاب', absences, schoolName, absenceDate)} onCancelApproval={() => void cancelSelectedAbsenceDate()} cancelBusy={cancelingSelectedAbsenceDate} busy={updatingDailyStatus} actionNotice={dailyStatusNotice} />}
      {activeReport === 'absence-history' && <HistoryCounts type="absence" students={students} schoolName={schoolName} />}
      {activeReport === 'lates' && <DailyList title="تأخر الطلاب" date={lateDate} onDate={value => { setLateDate(value); void loadLates(value) }} rows={lates} onStatus={(ids, status) => void updateLate(ids, status)} onAll={status => void updateLate(lates.map(row => row.studentId), status)} onExcel={() => exportDaily(`تأخر_${lateDate}`, lates, schoolName)} onPdf={() => printDaily('تأخر الطلاب', lates, schoolName, lateDate)} busy={updatingDailyStatus} actionNotice={dailyStatusNotice} late />}
      {activeReport === 'late-history' && <HistoryCounts type="late" students={students} schoolName={schoolName} />}
      {activeReport === 'student-detail' && <StudentDetailedReport students={students} schoolName={schoolName} printDocument={openPrintDocument} />}
    </div>

    {notice && <div className="notice-box" role="status">{notice}</div>}
  </section>
}
