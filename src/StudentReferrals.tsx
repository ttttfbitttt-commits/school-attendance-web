import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CheckCircle2, Clock3, Eye, FileSpreadsheet, FileText, Printer, RefreshCw, Search, Send, X } from 'lucide-react'
import { api, type StudentReferral, type StudentReferralReason, type StudentReferralStatus, type TeacherLessonStudent, type TeacherPortalScheduleItem } from './api'
import { downloadWorkbook } from './SchoolFeatures'
import { formatHijriDate, formatHijriDateTime, numericHijriParts } from './dateUtils'

const reasonLabels: Record<StudentReferralReason, string> = {
  homework: 'عدم أداء الواجب',
  disruption: 'مشاغبة',
  late: 'تأخر عن الحصة',
  academic_weakness: 'ضعف دراسي',
  other: 'أخرى (تذكر)',
}
const statusLabels: Record<StudentReferralStatus, string> = {
  submitted: 'جديدة', viewed: 'تمت المشاهدة', under_review: 'قيد الإجراء', referred_to_counselor: 'محالة للمرشد', completed: 'مكتملة', cancelled: 'ملغاة من المعلم',
}
const statusClass: Record<StudentReferralStatus, string> = {
  submitted: 'new', viewed: 'viewed', under_review: 'progress', referred_to_counselor: 'counselor', completed: 'done', cancelled: 'cancelled',
}
type SchoolActionStatus = Exclude<StudentReferralStatus, 'submitted' | 'viewed' | 'cancelled'>
const periodLabel = (period: number) => `الحصة ${['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة', 'الحادية عشرة', 'الثانية عشرة'][period] || period}`
const hijriFormDate = (value: string | Date) => { const parts = numericHijriParts(value); return `${parts.day} / ${parts.month} / ${parts.year}` }
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))

function openHtmlReport(html: string) {
  const popup = window.open('', '_blank')
  if (!popup) return false
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  popup.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 600000)
  return true
}

function exportReferralExcel(referrals: StudentReferral[], schoolName: string) {
  const rows = referrals.map(item => [item.referenceNumber, formatHijriDate(item.date), item.teacherName, item.studentName, item.studentId, `${item.grade} ${item.classroom}`.trim(), item.subject, periodLabel(item.periodNumber), item.reason === 'other' ? item.otherReason : reasonLabels[item.reason], statusLabels[item.status], item.viceAction, item.counselorAction])
  downloadWorkbook(`سجل_إحالات_الطلاب_${new Date().toISOString().slice(0, 10)}`, [['رقم الإحالة', 'التاريخ', 'المعلم', 'الطالب', 'رقم الطالب', 'الصف والفصل', 'المادة', 'الحصة', 'سبب الإحالة', 'الحالة', 'إجراء الوكيل', 'إجراء المرشد'], ...rows], 'الإحالات', schoolName, 'سجل إحالات الطلاب')
}

function exportReferralPdf(referrals: StudentReferral[], schoolName: string) {
  const rows = referrals.map(item => `<tr><td>${esc(item.referenceNumber)}</td><td>${esc(formatHijriDate(item.date))}</td><td>${esc(item.teacherName)}</td><td>${esc(item.studentName)}</td><td>${esc(`${item.grade} ${item.classroom}`.trim())}</td><td>${esc(item.reason === 'other' ? item.otherReason : reasonLabels[item.reason])}</td><td>${esc(statusLabels[item.status])}</td></tr>`).join('')
  return openHtmlReport(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>سجل إحالات الطلاب</title><style>@page{size:A4 landscape;margin:10mm}*{box-sizing:border-box}body{font-family:Tahoma,Arial;color:#102a43;margin:0}.head{text-align:center;border-bottom:3px solid #1778c8;padding-bottom:10px}.head h1{margin:4px}.meta{display:flex;justify-content:space-between;margin:12px 0;font-size:12px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #aac1d4;padding:6px;text-align:right}th{background:#1176bb;color:#fff}tr{break-inside:avoid}.actions{position:sticky;top:0;background:#102a43;padding:8px;display:flex;gap:8px}.actions button{border:0;border-radius:7px;padding:9px 14px;cursor:pointer}@media print{.actions{display:none}}</style></head><body><div class="actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button onclick="window.close()">إغلاق</button></div><div class="head"><h1>سجل إحالات الطلاب</h1><strong>${esc(schoolName)}</strong></div><div class="meta"><span>عدد الإحالات: ${referrals.length}</span><span>تاريخ الاستخراج: ${esc(formatHijriDate(new Date()))}</span></div><table><thead><tr><th>الرقم</th><th>التاريخ</th><th>المعلم</th><th>الطالب</th><th>الصف والفصل</th><th>السبب</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table></body></html>`)
}

export function ReferralOfficialPreview({ referral, onClose }: { referral: StudentReferral; onClose: () => void }) {
  useEffect(() => { document.body.classList.add('referral-print-mode'); return () => document.body.classList.remove('referral-print-mode') }, [])
  const checked = (reason: StudentReferralReason) => referral.reason === reason ? '✓' : ''
  return <div className="referral-preview-overlay" role="dialog" aria-modal="true" aria-label="معاينة نموذج الإحالة الرسمي">
    <div className="referral-preview-actions">
      <button type="button" className="outline-button" onClick={onClose}><ArrowRight size={16} /> الرجوع إلى الإحالة</button>
      <button type="button" className="primary-button" onClick={() => window.print()}><Printer size={16} /> طباعة / حفظ PDF</button>
    </div>
    <div className="referral-official-sheet">
      <img src="/student-referral-template.png" alt="النموذج الرسمي لتحويل طالب لوكيل شؤون الطلاب" />
      <span className="official-field official-number">{referral.referenceNumber}</span>
      <span className="official-field official-header-date">{hijriFormDate(referral.date)}</span>
      <span className="official-field official-student">{referral.studentName}</span>
      <span className="official-field official-class">{`${referral.grade} ${referral.classroom}`.trim()}</span>
      <span className="official-field official-subject">{referral.subject}</span>
      <span className="official-field official-period">{periodLabel(referral.periodNumber)}</span>
      <span className="official-check official-reason-homework">{checked('homework')}</span>
      <span className="official-check official-reason-disruption">{checked('disruption')}</span>
      <span className="official-check official-reason-late">{checked('late')}</span>
      <span className="official-check official-reason-weakness">{checked('academic_weakness')}</span>
      <span className="official-check official-reason-other">{checked('other')}</span>
      {referral.reason === 'other' && <span className="official-field official-other-reason">{referral.otherReason}</span>}
      <span className="official-field official-problem">{referral.problemDescription}</span>
      <span className="official-field official-teacher">{referral.teacherName}</span>
      <span className="official-field official-teacher-date">{hijriFormDate(referral.date)}</span>
      <span className="official-field official-vice-action">{referral.viceAction}</span>
      <span className="official-check official-counselor-check">{referral.referredToCounselor ? '✓' : ''}</span>
      <span className="official-field official-vice-name">{referral.vicePrincipalName}</span>
      {referral.viceActionAt && <span className="official-field official-vice-date">{hijriFormDate(referral.viceActionAt)}</span>}
      <span className="official-field official-counselor-action">{referral.counselorAction}</span>
      <span className="official-field official-counselor-name">{referral.counselorName}</span>
      {referral.counselorActionAt && <span className="official-field official-counselor-date">{hijriFormDate(referral.counselorActionAt)}</span>}
    </div>
  </div>
}

function ReferralList({ referrals, onOpen, emptyText }: { referrals: StudentReferral[]; onOpen: (item: StudentReferral) => void; emptyText: string }) {
  if (!referrals.length) return <div className="referral-empty"><FileText size={30} /><strong>{emptyText}</strong></div>
  return <div className="referral-list">{referrals.map(item => <button type="button" className="referral-list-item" key={item.id} onClick={() => onOpen(item)}>
    <div className="referral-list-main"><strong>{item.studentName}</strong><span>{item.teacherName} · {`${item.grade} ${item.classroom}`.trim()} · {periodLabel(item.periodNumber)}</span></div>
    <div className="referral-list-meta"><span className={`referral-status ${statusClass[item.status]}`}>{statusLabels[item.status]}</span><small>{formatHijriDate(item.date)}</small></div>
  </button>)}</div>
}

function ReferralDetail({ referral, schoolMode, onClose, onSaved, onPrint, onCancel }: { referral: StudentReferral; schoolMode: boolean; onClose: () => void; onSaved: () => void; onPrint: (item: StudentReferral) => void; onCancel?: (item: StudentReferral) => void }) {
  const initialStatus: SchoolActionStatus = ['under_review', 'referred_to_counselor', 'completed'].includes(referral.status) ? referral.status as SchoolActionStatus : 'under_review'
  const [status, setStatus] = useState<SchoolActionStatus>(initialStatus)
  const [viceAction, setViceAction] = useState(referral.viceAction)
  const [viceName, setViceName] = useState(referral.vicePrincipalName)
  const [referred, setReferred] = useState(referral.referredToCounselor)
  const [counselorAction, setCounselorAction] = useState(referral.counselorAction)
  const [counselorName, setCounselorName] = useState(referral.counselorName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try {
      const nextStatus = status === 'referred_to_counselor' || referred && status !== 'completed' ? 'referred_to_counselor' : status
      await api.updateStudentReferral(referral.id, { status: nextStatus, referredToCounselor: referred, viceAction, vicePrincipalName: viceName, counselorAction, counselorName })
      onSaved()
    } catch { setError('تعذر حفظ الإجراء. أكمل اسم الوكيل والإجراء، وتأكد من بيانات المرشد عند إكمال إحالة محالة إليه.') } finally { setBusy(false) }
  }
  return <div className="referral-detail-card">
    <div className="referral-detail-head"><div><span>إحالة رقم {referral.referenceNumber}</span><h3>{referral.studentName}</h3><p>{referral.teacherName} · {referral.subject} · {periodLabel(referral.periodNumber)} · {formatHijriDate(referral.date)}</p></div><button type="button" className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <div className="referral-detail-grid"><div><small>الصف والفصل</small><strong>{`${referral.grade} ${referral.classroom}`.trim()}</strong></div><div><small>سبب الإحالة</small><strong>{referral.reason === 'other' ? referral.otherReason : reasonLabels[referral.reason]}</strong></div></div>
    <div className="referral-description"><small>إيضاح المشكلة</small><p>{referral.problemDescription}</p></div>
    {referral.status === 'cancelled' && <div className="referral-cancelled-notice"><X size={18} /><div><strong>هذه الإحالة ملغاة من المعلم</strong><span>{referral.cancelledAt ? `تم الإلغاء في ${formatHijriDateTime(referral.cancelledAt)}.` : 'تم إلغاؤها ولم تعد ضمن الإحالات النشطة.'}</span></div></div>}
    {schoolMode && referral.status !== 'cancelled' && <div className="referral-action-form">
      <label>اسم وكيل المدرسة<input value={viceName} onChange={event => setViceName(event.target.value)} placeholder="اكتب الاسم كما سيظهر في النموذج" /></label>
      <label className="wide">الإجراء المتخذ<textarea value={viceAction} onChange={event => setViceAction(event.target.value)} placeholder="دوّن الإجراء الذي تم اتخاذه مع الطالب" rows={4} /></label>
      <label className="referral-checkbox wide"><input type="checkbox" checked={referred} onChange={event => { setReferred(event.target.checked); if (event.target.checked) setStatus('referred_to_counselor') }} /> تمت إحالته إلى المرشد الطلابي</label>
      {referred && <><label>اسم المرشد الطلابي<input value={counselorName} onChange={event => setCounselorName(event.target.value)} /></label><label className="wide">ما تم حيال الطالب لدى المرشد<textarea value={counselorAction} onChange={event => setCounselorAction(event.target.value)} rows={4} /></label></>}
      <label>حالة الإحالة<select value={status} onChange={event => setStatus(event.target.value as SchoolActionStatus)}><option value="under_review">قيد الإجراء</option>{referred && <option value="referred_to_counselor">محالة للمرشد</option>}<option value="completed">مكتملة</option></select></label>
      {error && <p className="teacher-notice error wide">{error}</p>}
      <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}><CheckCircle2 size={17} /> {busy ? 'جارٍ الحفظ…' : 'حفظ الإجراء والحالة'}</button>
    </div>}
    <div className="referral-detail-actions">{referral.status !== 'cancelled' && <button type="button" className="outline-button" onClick={() => onPrint(referral)}><Printer size={16} /> عرض وطباعة النموذج الرسمي</button>}{!schoolMode && onCancel && !['completed', 'cancelled'].includes(referral.status) && <button type="button" className="outline-button danger-referral-button" onClick={() => onCancel(referral)}><X size={16} /> إلغاء الإحالة</button>}</div>
    {!!referral.events.length && <div className="referral-timeline"><h4>سجل المتابعة</h4>{referral.events.map(event => <div key={event.id}><Clock3 size={15} /><span><strong>{statusLabels[event.type as StudentReferralStatus] || event.type}</strong><small>{event.note} · {formatHijriDateTime(event.createdAt)}</small></span></div>)}</div>}
  </div>
}

export function TeacherReferralCenter({ date, schedule, schoolName, teacherName }: { date: string; schedule: TeacherPortalScheduleItem[]; schoolName: string; teacherName: string }) {
  const [mode, setMode] = useState<'new' | 'records'>('new')
  const [lessonId, setLessonId] = useState('')
  const [students, setStudents] = useState<TeacherLessonStudent[]>([])
  const [studentId, setStudentId] = useState('')
  const [reason, setReason] = useState<StudentReferralReason>('homework')
  const [otherReason, setOtherReason] = useState('')
  const [description, setDescription] = useState('')
  const [referrals, setReferrals] = useState<StudentReferral[]>([])
  const [selected, setSelected] = useState<StudentReferral | null>(null)
  const [preview, setPreview] = useState<StudentReferral | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const lesson = schedule.find(item => item.assignmentId === lessonId)
  const loadRecords = async () => { try { setReferrals((await api.studentReferrals()).referrals) } catch { setError('تعذر تحميل سجل الإحالات.') } }
  useEffect(() => { void loadRecords() }, [])
  useEffect(() => { setLessonId(''); setStudents([]); setStudentId('') }, [date])
  const chooseLesson = async (assignmentId: string) => {
    setLessonId(assignmentId); setStudentId(''); setStudents([]); setError('')
    const item = schedule.find(row => row.assignmentId === assignmentId)
    if (!item) return
    setBusy('students')
    try { setStudents((await api.teacherLesson(item.classroomId, date, item.periodNumber, 'followup')).students) } catch { setError('تعذر تحميل طلاب هذا الفصل. اطلب من الإدارة مراجعة ربط طلاب الفصل.') } finally { setBusy('') }
  }
  const submit = async () => {
    if (!lesson || !studentId || !description.trim() || (reason === 'other' && !otherReason.trim())) { setError('اختر الحصة والطالب والسبب، ثم اكتب إيضاح المشكلة.'); return }
    const student = students.find(item => item.id === studentId)
    if (!student || !window.confirm(`سيتم إرسال إحالة الطالب ${student.name} إلى حساب المدرسة. هل تريد التأكيد؟`)) return
    setBusy('submit'); setError(''); setNotice('')
    try {
      await api.createStudentReferral({ assignmentId: lesson.assignmentId, classroomId: lesson.classroomId, studentId, date, periodNumber: lesson.periodNumber, reason, otherReason, problemDescription: description })
      setNotice('تم إرسال الإحالة إلى حساب المدرسة وحفظها في سجلك.')
      setStudentId(''); setDescription(''); setOtherReason(''); await loadRecords(); setMode('records')
    } catch (err) { setError(err instanceof Error && err.message.includes('duplicate_referral') ? 'سبق إرسال إحالة لهذا الطالب في الحصة نفسها.' : 'تعذر إرسال الإحالة. تحقق من البيانات والاتصال ثم أعد المحاولة.') } finally { setBusy('') }
  }
  const previewOfficialForm = () => {
    const student = students.find(item => item.id === studentId)
    setPreview({
      id: '', referenceNumber: '', teacherId: '', teacherName, studentId: student?.id || '', studentName: student?.name || '',
      grade: student?.grade || '', classroom: student?.classroom || '', classroomId: lesson?.classroomId || '', classroomName: lesson?.classroom || '',
      assignmentId: lesson?.assignmentId || '', subject: lesson?.subject || '', date, weekday: lesson?.weekday || 1,
      periodNumber: lesson?.periodNumber || 1, reason, otherReason, problemDescription: description, status: 'submitted',
      referredToCounselor: false, viceAction: '', vicePrincipalName: '', counselorAction: '', counselorName: '',
      createdAt: new Date().toISOString(), viewedAt: null, viceActionAt: null, counselorActionAt: null, completedAt: null, cancelledAt: null, events: [],
    })
  }
  const cancelReferral = async (item: StudentReferral) => {
    if (!window.confirm(`هل تريد إلغاء إحالة الطالب ${item.studentName}؟ ستُحذف نهائيًا من سجل إحالاتك ومن سجل المدرسة.`)) return
    setBusy('cancel'); setError(''); setNotice('')
    try {
      await api.cancelStudentReferral(item.id)
      setSelected(null)
      setReferrals(current => current.filter(referral => referral.id !== item.id))
      setNotice('تم إلغاء الإحالة وحذفها من سجل إحالاتك ومن سجل المدرسة.')
      await loadRecords()
    } catch { setError('تعذر إلغاء الإحالة. قد تكون الإحالة مكتملة أو تم تحديثها بالفعل.') } finally { setBusy('') }
  }
  return <section className="teacher-card referral-center">
    <div className="teacher-section-head"><div><span>نموذج رسمي محفوظ</span><h2>إحالة طالب لوكيل شؤون الطلاب</h2><p>اختر الحصة والطالب، ثم أرسل الإحالة مباشرة إلى حساب المدرسة.</p></div><Send size={30} /></div>
    <div className="referral-mode-cards"><button className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}><Send size={23} /><strong>إحالة جديدة</strong><small>تعبئة وإرسال النموذج</small></button><button className={mode === 'records' ? 'active' : ''} onClick={() => setMode('records')}><FileText size={23} /><strong>سجل إحالاتي</strong><small>{referrals.length} إحالة محفوظة</small></button></div>
    {notice && <p className="teacher-notice success">{notice}</p>}{error && <p className="teacher-notice error">{error}</p>}
    {mode === 'new' && <div className="referral-form">
      <label>الحصة<select value={lessonId} onChange={event => void chooseLesson(event.target.value)}><option value="">اختر حصة من جدول هذا اليوم</option>{schedule.map(item => <option key={item.assignmentId} value={item.assignmentId}>{periodLabel(item.periodNumber)} — {item.classroom} — {item.subject}</option>)}</select></label>
      <label>الطالب<select value={studentId} onChange={event => setStudentId(event.target.value)} disabled={!lesson || busy === 'students'}><option value="">{busy === 'students' ? 'جارٍ تحميل الطلاب…' : 'اختر الطالب'}</option>{students.map(student => <option key={student.id} value={student.id}>{student.name} — {student.id}</option>)}</select></label>
      <fieldset className="referral-reasons"><legend>سبب التحويل</legend>{(Object.entries(reasonLabels) as Array<[StudentReferralReason, string]>).map(([value, label]) => <label key={value} className={reason === value ? 'selected' : ''}><input type="radio" name="referral-reason" value={value} checked={reason === value} onChange={() => setReason(value)} />{label}</label>)}</fieldset>
      {reason === 'other' && <label>اذكر السبب الآخر<input value={otherReason} onChange={event => setOtherReason(event.target.value)} maxLength={240} /></label>}
      <label className="wide">إيضاح المشكلة<textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={3000} rows={5} placeholder="اكتب وصفًا واضحًا ومختصرًا للحالة" /></label>
      <div className="referral-form-actions"><button type="button" className="outline-button" onClick={previewOfficialForm} disabled={!lesson || !studentId}><Eye size={16} /> معاينة النموذج الرسمي</button><button className="primary-button" onClick={() => void submit()} disabled={busy === 'submit'}><Send size={16} /> {busy === 'submit' ? 'جارٍ الإرسال…' : 'تأكيد وإرسال الإحالة'}</button></div>
    </div>}
    {mode === 'records' && <><div className="referral-export-row"><button className="outline-button" disabled={!referrals.length} onClick={() => exportReferralExcel(referrals, schoolName)}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" disabled={!referrals.length} onClick={() => exportReferralPdf(referrals, schoolName)}><Printer size={16} /> PDF</button><button className="icon-button" onClick={() => void loadRecords()} title="تحديث"><RefreshCw size={16} /></button></div><ReferralList referrals={referrals} emptyText="لم ترسل أي إحالة حتى الآن." onOpen={setSelected} /></>}
    {selected && <ReferralDetail referral={selected} schoolMode={false} onClose={() => setSelected(null)} onSaved={() => {}} onPrint={setPreview} onCancel={item => void cancelReferral(item)} />}
    {preview && <ReferralOfficialPreview referral={preview} onClose={() => setPreview(null)} />}
  </section>
}

export function SchoolReferralCenter({ schoolName }: { schoolName: string }) {
  const [referrals, setReferrals] = useState<StudentReferral[]>([])
  const [selected, setSelected] = useState<StudentReferral | null>(null)
  const [preview, setPreview] = useState<StudentReferral | null>(null)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StudentReferralStatus | ''>('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const load = async (silent = false) => {
    if (!silent) { setBusy(true); setError('') }
    try {
      const next = (await api.studentReferrals()).referrals
      setReferrals(next)
      setSelected(current => current ? next.find(item => item.id === current.id) || null : null)
    } catch { if (!silent) setError('تعذر تحميل إحالات المدرسة.') } finally { if (!silent) setBusy(false) }
  }
  useEffect(() => {
    void load()
    const refresh = window.setInterval(() => void load(true), 5000)
    return () => window.clearInterval(refresh)
  }, [])
  const filtered = useMemo(() => referrals.filter(item => (!status || item.status === status) && (!query.trim() || `${item.studentName} ${item.studentId} ${item.teacherName} ${item.classroomName}`.includes(query.trim()))), [referrals, query, status])
  const open = (item: StudentReferral) => { setSelected(item); if (item.status === 'submitted' && !item.viewedAt) void api.markStudentReferralViewed(item.id).then(() => setReferrals(current => current.map(row => row.id === item.id ? { ...row, viewedAt: new Date().toISOString(), status: row.status === 'submitted' ? 'viewed' : row.status } : row))).catch(() => {}) }
  const saved = async () => { setSelected(null); await load() }
  const counts = { new: referrals.filter(item => item.status === 'submitted').length, active: referrals.filter(item => !['submitted', 'completed', 'cancelled'].includes(item.status)).length, completed: referrals.filter(item => item.status === 'completed').length }
  return <section className="referral-school-page" dir="rtl">
    <div className="referral-school-head"><div><span>المتابعة الرسمية</span><h2>إحالات الطلاب</h2><p>استقبال إحالات المعلمين، توثيق إجراء الوكيل والمرشد، ومتابعة الحالة حتى الإكمال.</p></div><Send size={32} /></div>
    <div className="referral-stat-cards"><div><strong>{counts.new}</strong><span>إحالات جديدة</span></div><div><strong>{counts.active}</strong><span>قيد المتابعة</span></div><div><strong>{counts.completed}</strong><span>مكتملة ومؤرشفة</span></div><div><strong>{referrals.length}</strong><span>إجمالي السجل</span></div></div>
    <div className="referral-school-panel">
      <div className="referral-toolbar"><label className="referral-search"><Search size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث بالطالب أو المعلم أو الفصل" /></label><select value={status} onChange={event => setStatus(event.target.value as StudentReferralStatus | '')}><option value="">جميع الحالات</option>{(Object.entries(statusLabels) as Array<[StudentReferralStatus, string]>).filter(([value]) => value !== 'cancelled').map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className="outline-button" onClick={() => exportReferralExcel(filtered, schoolName)} disabled={!filtered.length}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={() => exportReferralPdf(filtered, schoolName)} disabled={!filtered.length}><Printer size={16} /> PDF</button><button className="icon-button" onClick={() => void load()} title="تحديث"><RefreshCw size={17} /></button></div>
      {error && <p className="teacher-notice error">{error}</p>}{busy ? <div className="referral-empty">جارٍ تحميل الإحالات…</div> : <ReferralList referrals={filtered} emptyText="لا توجد إحالات مطابقة." onOpen={open} />}
    </div>
    {selected && <ReferralDetail referral={selected} schoolMode onClose={() => setSelected(null)} onSaved={() => void saved()} onPrint={setPreview} />}
    {preview && <ReferralOfficialPreview referral={preview} onClose={() => setPreview(null)} />}
  </section>
}
