import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import {
  ArrowRight, Award, Check, CheckCircle2, ChevronLeft, CircleAlert, ClipboardCheck, ClipboardList,
  FileBarChart2, FileSpreadsheet, Loader2, LockKeyhole, PlusCircle, Printer, RefreshCcw, RotateCcw,
  Save, Search, ShieldAlert, UserRoundSearch, Users, XCircle,
} from 'lucide-react'
import {
  api,
  type BehaviorActionStep,
  type BehaviorCategory,
  type BehaviorOverview,
  type BehaviorPreviewStudent,
  type BehaviorRecord,
  type BehaviorRule,
  type BehaviorStatus,
  type BehaviorStudent,
  type BehaviorStudentProfile,
} from './api'

type BehaviorView = 'home' | 'record' | 'records' | 'approvals' | 'distinguished' | 'compensation' | 'reports' | 'permissions'
type SchoolDetails = { schoolName: string; principalName: string; academicYear: string; semester: string }
type EducationStage = 'primary' | 'middle' | 'secondary'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const statusLabel: Record<BehaviorStatus, string> = { pending: 'بانتظار الاعتماد', approved: 'معتمد', cancelled: 'ملغى' }
const categoryLabel: Record<BehaviorCategory, string> = { violation: 'مخالفة سلوكية', distinguished: 'سلوك متميز' }
const stageLabel: Record<EducationStage | 'unspecified', string> = { primary: 'ابتدائي', middle: 'متوسط', secondary: 'ثانوي', unspecified: 'غير محددة' }

const errorMessage = (error: unknown) => {
  const code = (error as Error & { code?: string })?.code || ''
  const messages: Record<string, string> = {
    invalid_behavior_preview: 'اختر المرحلة ونوع التعليم والمخالفة والطلاب قبل المعاينة.',
    invalid_behavior_incident: 'تعذر حفظ الواقعة لأن بعض البيانات غير مكتملة.',
    rule_not_applicable: 'المخالفة المختارة لا تنطبق على مرحلة أحد الطلاب المحددين.',
    procedure_sequence_exhausted: 'اكتمل تسلسل الإجراءات الرسمي لهذه المشكلة. يلزم مراجعة الإدارة قبل أي إجراء جديد.',
    record_not_pending: 'تمت معالجة هذا السجل مسبقاً.',
    cancellation_reason_required: 'اكتب سبباً واضحاً للإلغاء أو التصحيح.',
    invalid_compensation: 'حدد مقدار التعويض وأرفق وصف الشاهد.',
    deduction_fully_compensated: 'تم تعويض هذا الحسم بالكامل.',
    compensation_already_recorded: 'تم تسجيل فرصة التعويض نفسها سابقاً.',
    forbidden: 'هذه العملية متاحة لمدير المدرسة فقط.',
  }
  return messages[code] || 'تعذر إكمال العملية. أعد المحاولة.'
}

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))

function openPrintReport(records: BehaviorRecord[], school: SchoolDetails) {
  const rows = records.map(record => `<tr><td>${escapeHtml(record.date)}</td><td>${escapeHtml(record.name)}</td><td>${escapeHtml(stageLabel[record.stage] || 'غير محددة')}</td><td>${escapeHtml(`${record.grade} / ${record.classroom}`)}</td><td>${escapeHtml(record.ruleTitle)}</td><td>${record.degree || '—'}</td><td>${escapeHtml(record.procedureName)}</td><td>${escapeHtml(statusLabel[record.status])}</td></tr>`).join('')
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير سجل السلوك</title><style>@page{size:A4 landscape;margin:12mm}body{font-family:Tahoma,Arial;color:#102f4d}header{text-align:center;border-bottom:2px solid #1982c4;padding-bottom:12px;margin-bottom:18px}h1{font-size:22px;margin:5px}.meta{display:flex;justify-content:center;gap:28px;font-size:12px}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #afc4d7;padding:7px;text-align:right}th{background:#eaf4fb}.signature{margin-top:35px;display:flex;justify-content:space-between}</style></head><body><header><h1>${escapeHtml(school.schoolName)}</h1><h2>تقرير سجل السلوك</h2><div class="meta"><span>${escapeHtml(school.semester)}</span><span>${escapeHtml(school.academicYear)}</span><span>تاريخ الطباعة: ${escapeHtml(today())}</span></div></header><table><thead><tr><th>التاريخ</th><th>الطالب</th><th>المرحلة</th><th>الصف والفصل</th><th>السلوك</th><th>الدرجة</th><th>الإجراء</th><th>الحالة</th></tr></thead><tbody>${rows || '<tr><td colspan="8">لا توجد بيانات</td></tr>'}</tbody></table><div class="signature"><span>مسؤول السلوك: ........................</span><span>مدير المدرسة: ${escapeHtml(school.principalName)} &nbsp; التوقيع: ........................</span></div><script>window.onload=()=>window.print()</script></body></html>`
  const popup = window.open('', '_blank')
  if (!popup) return false
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  popup.location.href = url
  setTimeout(() => URL.revokeObjectURL(url), 600000)
  return true
}

export function BehaviorCenter({ school, role }: { school: SchoolDetails; role: 'admin' | 'staff' }) {
  const [view, setView] = useState<BehaviorView>('home')
  const [overview, setOverview] = useState<BehaviorOverview | null>(null)
  const [catalog, setCatalog] = useState<BehaviorRule[]>([])
  const [catalogVersion, setCatalogVersion] = useState('')
  const [students, setStudents] = useState<BehaviorStudent[]>([])
  const [records, setRecords] = useState<BehaviorRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [expandedRecord, setExpandedRecord] = useState('')
  const [profile, setProfile] = useState<BehaviorStudentProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)

  const [category, setCategory] = useState<BehaviorCategory>('violation')
  const [educationStage, setEducationStage] = useState<EducationStage | ''>('')
  const [mode, setMode] = useState<'in_person' | 'remote'>('in_person')
  const [incidentDate, setIncidentDate] = useState(today())
  const [ruleCode, setRuleCode] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [studentSearch, setStudentSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const [selectedStudents, setSelectedStudents] = useState<string[]>([])
  const [preview, setPreview] = useState<{ rule: BehaviorRule; students: BehaviorPreviewStudent[] } | null>(null)

  const [recordStatus, setRecordStatus] = useState<BehaviorStatus | ''>('')
  const [reportFrom, setReportFrom] = useState('')
  const [reportTo, setReportTo] = useState(today())
  const [compensationMovement, setCompensationMovement] = useState('')
  const [compensationAmount, setCompensationAmount] = useState('')
  const [compensationEvidence, setCompensationEvidence] = useState('')
  const [compensationReason, setCompensationReason] = useState('')

  const loadBase = async () => {
    setLoading(true)
    setError('')
    try {
      const [summary, rules, roster] = await Promise.all([api.behaviorOverview(), api.behaviorCatalog(), api.behaviorStudents()])
      setOverview(summary)
      setCatalog(rules.rules)
      setCatalogVersion(rules.version)
      setStudents(roster.students)
    } catch (err) { setError(errorMessage(err)) } finally { setLoading(false) }
  }

  const loadRecords = async (filters: { status?: BehaviorStatus; category?: BehaviorCategory; from?: string; to?: string } = {}) => {
    setLoading(true)
    setError('')
    try { setRecords((await api.behaviorRecords(filters)).records) } catch (err) { setError(errorMessage(err)) } finally { setLoading(false) }
  }

  useEffect(() => { void loadBase() }, [])

  useEffect(() => {
    if (view === 'records') void loadRecords(recordStatus ? { status: recordStatus } : {})
    if (view === 'approvals') void loadRecords({ status: 'pending' })
    if (view === 'reports') void loadRecords({ from: reportFrom || undefined, to: reportTo || undefined })
  }, [view, recordStatus])

  const openView = (next: BehaviorView) => {
    setNotice(''); setError(''); setExpandedRecord(''); setProfile(null); setView(next)
    if (next === 'distinguished') { setCategory('distinguished'); setMode('in_person'); setEducationStage(''); setClassFilter(''); setRuleCode(''); setSelectedStudents([]); setPreview(null) }
    if (next === 'record') { setCategory('violation'); setEducationStage(''); setClassFilter(''); setRuleCode(''); setSelectedStudents([]); setPreview(null) }
  }

  const stageScope = educationStage === 'primary' ? 'primary' : educationStage ? 'middle_secondary' : ''
  const availableRules = useMemo(() => catalog.filter(rule => rule.category === category && rule.mode === mode && (!stageScope || rule.stageScope.includes(stageScope))), [catalog, category, mode, stageScope])
  const recordingView = view === 'record' || view === 'distinguished'
  const stageStudents = useMemo(() => students.filter(student => !recordingView || !educationStage || student.stage === educationStage || student.stage === 'unknown'), [students, recordingView, educationStage])
  const classes = useMemo(() => [...new Set(stageStudents.map(student => `${student.grade}||${student.classroom}`))].sort((a, b) => a.localeCompare(b, 'ar')), [stageStudents])
  const visibleStudents = useMemo(() => stageStudents.filter(student => {
    const query = studentSearch.trim().toLowerCase()
    const matchesSearch = !query || student.name.toLowerCase().includes(query) || student.id.toLowerCase().includes(query)
    return matchesSearch && (!classFilter || `${student.grade}||${student.classroom}` === classFilter)
  }), [stageStudents, studentSearch, classFilter])

  const toggleVisible = () => {
    const ids = visibleStudents.map(student => student.id)
    const allSelected = ids.length > 0 && ids.every(id => selectedStudents.includes(id))
    setSelectedStudents(current => allSelected ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])])
    setPreview(null)
  }

  const requestPreview = async () => {
    if (!educationStage) { setError('اختر المرحلة الدراسية أولاً.'); return }
    setBusy(true); setError(''); setNotice('')
    try { setPreview(await api.behaviorPreview({ ruleCode, studentIds: selectedStudents, mode, stage: educationStage })) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const saveIncident = async () => {
    if (!preview || !educationStage || preview.students.some(student => student.exhausted || !student.applicable)) return
    setBusy(true); setError('')
    try {
      await api.createBehaviorIncident({ date: incidentDate, mode, stage: educationStage, ruleCode, studentIds: selectedStudents, location, description })
      setNotice(`تم حفظ ${selectedStudents.length} سجل مستقل وإرساله للاعتماد.`)
      setSelectedStudents([]); setPreview(null); setDescription(''); setLocation('')
      await loadBase()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const approveRecord = async (id: string) => {
    setBusy(true); setError('')
    try { await api.approveBehaviorRecord(id); setNotice('تم اعتماد السجل وتنفيذ الأثر النظامي مرة واحدة.'); await loadRecords({ status: view === 'approvals' ? 'pending' : recordStatus || undefined }); await loadBase() }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const cancelRecord = async (id: string) => {
    const reason = window.prompt('اكتب سبب الإلغاء أو التصحيح. سيبقى التغيير موثقاً في سجل المراجعة:')?.trim() || ''
    if (!reason) return
    setBusy(true); setError('')
    try { await api.cancelBehaviorRecord(id, reason); setNotice('تم إلغاء السجل وعكس أثر الدرجة إن وجد.'); await loadRecords(recordStatus ? { status: recordStatus } : {}); await loadBase() }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const updateAction = async (recordId: string, action: BehaviorActionStep, state: BehaviorActionStep['state']) => {
    const reason = state === 'not_executed' ? window.prompt('اكتب سبب عدم تنفيذ الإجراء:')?.trim() || '' : ''
    if (state === 'not_executed' && !reason) return
    const evidence = state === 'executed' ? window.prompt('مرجع الشاهد أو الملاحظة (اختياري):')?.trim() || '' : ''
    setBusy(true); setError('')
    try { await api.updateBehaviorAction(recordId, action.id, { state, reason, evidence }); await loadRecords(recordStatus ? { status: recordStatus } : {}) }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const openProfile = async (studentId: string) => {
    setProfileLoading(true); setError('')
    try { setProfile(await api.behaviorStudentProfile(studentId)); setView('compensation') } catch (err) { setError(errorMessage(err)) } finally { setProfileLoading(false) }
  }

  const submitCompensation = async () => {
    if (!compensationMovement) return
    setBusy(true); setError('')
    try {
      await api.createBehaviorCompensation({ sourceMovementId: compensationMovement, amount: Number(compensationAmount), evidence: compensationEvidence, reason: compensationReason })
      setNotice('تم اعتماد التعويض وربطه بالحسم الأصلي دون تغيير سجل المخالفة.')
      if (profile) setProfile(await api.behaviorStudentProfile(profile.student.id))
      setCompensationMovement(''); setCompensationAmount(''); setCompensationEvidence(''); setCompensationReason('')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const exportExcel = () => {
    const data = records.map(record => ({ التاريخ: record.date, الطالب: record.name, الهوية: record.studentId, المرحلة: stageLabel[record.stage] || 'غير محددة', الصف: record.grade, الفصل: record.classroom, النوع: categoryLabel[record.category], السلوك: record.ruleTitle, الدرجة: record.degree || '', التكرار: record.recurrence, الإجراء: record.procedureName, الحالة: statusLabel[record.status], الأثر: record.descriptiveOnly ? 'وصفي' : Number(record.amount || 0) }))
    const sheet = XLSX.utils.json_to_sheet(data)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'سجل السلوك')
    XLSX.writeFile(workbook, `سجل-السلوك-${reportFrom || 'البداية'}-${reportTo || today()}.xlsx`)
  }

  if (loading && !overview) return <section className="behavior-loading"><Loader2 className="spin" /><span>جاري تجهيز سجل السلوك...</span></section>

  return (
    <div className="behavior-center" dir="rtl">
      <section className="page-intro behavior-intro">
        <div><span className="panel-kicker">قواعد السلوك والمواظبة 1447</span><h2>سجل السلوك</h2><p>رصد موحد، تدرج آلي للإجراءات، واعتماد يحفظ تاريخ كل طالب دون تكرار أو ضياع.</p></div>
        {view !== 'home' && <button className="secondary-button behavior-back" type="button" onClick={() => openView('home')}><ArrowRight size={17} />العودة للبطاقات</button>}
      </section>

      {error && <div className="behavior-alert error" role="alert"><CircleAlert size={18} /><span>{error}</span></div>}
      {notice && <div className="behavior-alert success" role="status"><CheckCircle2 size={18} /><span>{notice}</span></div>}

      {view === 'home' && <>
        <section className="behavior-stats">
          <article><span>بانتظار الاعتماد</span><strong>{overview?.counts.pending || 0}</strong><small>لا حسم قبل الاعتماد</small></article>
          <article><span>المخالفات المعتمدة</span><strong>{overview?.counts.violations || 0}</strong><small>بسجل مستقل لكل طالب</small></article>
          <article><span>السلوك المتميز</span><strong>{overview?.counts.distinguished || 0}</strong><small>من 20 درجة</small></article>
          <article><span>طلاب لهم سجلات</span><strong>{overview?.counts.students || 0}</strong><small>داخل هذه المدرسة فقط</small></article>
        </section>
        <section className="behavior-menu-grid">
          <button onClick={() => openView('record')}><span className="behavior-menu-icon blue"><PlusCircle /></span><strong>رصد جديد</strong><small>اختيار السلوك والطلاب ومعاينة الإجراء قبل الحفظ</small><ChevronLeft /></button>
          <button onClick={() => openView('records')}><span className="behavior-menu-icon navy"><ClipboardList /></span><strong>السجلات والمتابعة</strong><small>ملف زمني لكل طالب وحالة كل إجراء</small><ChevronLeft /></button>
          <button onClick={() => openView('approvals')}><span className="behavior-menu-icon orange"><ClipboardCheck /></span><strong>الاعتمادات المعلقة</strong><small>{overview?.counts.pending || 0} سجل يحتاج قرار المدير</small><ChevronLeft /></button>
          <button onClick={() => openView('distinguished')}><span className="behavior-menu-icon green"><Award /></span><strong>السلوك المتميز</strong><small>توثيق الشواهد ومنح الدرجات بحد أقصى 20</small><ChevronLeft /></button>
          <button onClick={() => openView('compensation')}><span className="behavior-menu-icon teal"><RefreshCcw /></span><strong>تعويض الدرجات</strong><small>ربط التعويض بالحسم الأصلي مع بقاء المخالفة</small><ChevronLeft /></button>
          <button onClick={() => openView('reports')}><span className="behavior-menu-icon purple"><FileBarChart2 /></span><strong>التقارير والنماذج</strong><small>تصفية وطباعة وتصدير Excel</small><ChevronLeft /></button>
          <button onClick={() => openView('permissions')}><span className="behavior-menu-icon gray"><LockKeyhole /></span><strong>الصلاحيات والضوابط</strong><small>من يرصد ومن يعتمد وكيف تحفظ البيانات</small><ChevronLeft /></button>
        </section>
        {!!overview?.recent.length && <section className="panel behavior-recent"><div className="behavior-section-head"><div><span className="panel-kicker">آخر العمليات</span><h3>أحدث السجلات</h3></div><button className="secondary-button" onClick={() => openView('records')}>عرض الكل</button></div><div className="behavior-compact-list">{overview.recent.slice(0, 5).map(record => <article key={record.id}><span className={`behavior-status ${record.status}`}>{statusLabel[record.status]}</span><div><strong>{record.name}</strong><small>{record.ruleTitle} · {record.date}</small></div><b>{record.descriptiveOnly ? 'وصفي' : record.amount ? `${record.amount} درجة` : 'دون حسم'}</b></article>)}</div></section>}
      </>}

      {(view === 'record' || view === 'distinguished') && <section className="panel behavior-form-panel">
        <div className="behavior-section-head"><div><span className="panel-kicker">{view === 'distinguished' ? 'توثيق ممارسة' : 'واقعة جديدة'}</span><h3>{view === 'distinguished' ? 'منح سلوك متميز' : 'رصد مخالفة سلوكية'}</h3></div><span className="behavior-version">إصدار القواعد {catalogVersion}</span></div>
        <div className="behavior-form-grid">
          <label><span>التاريخ</span><input type="date" value={incidentDate} max={today()} onChange={event => { setIncidentDate(event.target.value); setPreview(null) }} /></label>
          <label><span>المرحلة الدراسية</span><select value={educationStage} onChange={event => { setEducationStage(event.target.value as EducationStage | ''); setClassFilter(''); setRuleCode(''); setSelectedStudents([]); setPreview(null) }}><option value="">اختر المرحلة</option><option value="primary">ابتدائي</option><option value="middle">متوسط</option><option value="secondary">ثانوي</option></select></label>
          {category === 'violation' && <label><span>نوع التعليم</span><select value={mode} onChange={event => { setMode(event.target.value as 'in_person' | 'remote'); setRuleCode(''); setPreview(null) }}><option value="in_person">حضوري</option><option value="remote">إلكتروني / عن بعد</option></select></label>}
          <label className="wide"><span>{category === 'violation' ? 'المشكلة السلوكية الرسمية' : 'الممارسة المتميزة'}</span><select value={ruleCode} disabled={!educationStage} onChange={event => { setRuleCode(event.target.value); setPreview(null) }}><option value="">{educationStage ? 'اختر من الكتالوج المعتمد' : 'اختر المرحلة أولاً'}</option>{availableRules.map(rule => <option key={rule.code} value={rule.code}>{rule.degree ? `الدرجة ${rule.degree} — ` : ''}{rule.title}</option>)}</select></label>
          <label><span>المكان (اختياري)</span><input value={location} onChange={event => setLocation(event.target.value)} placeholder="الفصل، الساحة..." /></label>
          <label className="wide"><span>وصف الواقعة أو الشاهد</span><textarea value={description} onChange={event => setDescription(event.target.value)} placeholder="اكتب وصفاً موجزاً يساعد على المراجعة..." /></label>
        </div>
        <div className="behavior-student-picker">
          <div className="behavior-picker-head"><div><strong>اختيار الطلاب</strong><small>ينشئ النظام سجلاً مستقلاً وإجراءً مستقلاً لكل طالب.</small></div><span>{selectedStudents.length} محدد</span></div>
          <div className="behavior-picker-filters"><label><Search size={17} /><input value={studentSearch} disabled={!educationStage} onChange={event => setStudentSearch(event.target.value)} placeholder="ابحث بالاسم أو الهوية" /></label><select value={classFilter} disabled={!educationStage} onChange={event => setClassFilter(event.target.value)}><option value="">جميع الصفوف والفصول</option>{classes.map(item => { const [grade, classroom] = item.split('||'); return <option key={item} value={item}>{grade} / {classroom}</option> })}</select><button type="button" className="secondary-button" disabled={!educationStage} onClick={toggleVisible}>{visibleStudents.length && visibleStudents.every(student => selectedStudents.includes(student.id)) ? 'إلغاء الظاهر' : 'تحديد الظاهر'}</button></div>
          {!educationStage ? <div className="behavior-empty">اختر المرحلة الدراسية لعرض طلابها.</div> : <div className="behavior-student-list">{visibleStudents.map(student => <label key={student.id} className={selectedStudents.includes(student.id) ? 'selected' : ''}><input type="checkbox" checked={selectedStudents.includes(student.id)} onChange={() => { setSelectedStudents(current => current.includes(student.id) ? current.filter(id => id !== student.id) : [...current, student.id]); setPreview(null) }} /><span><strong>{student.name}</strong><small>{student.grade} · {student.classroom} · {student.id}</small></span>{student.descriptiveOnly && <b>تقييم وصفي</b>}</label>)}</div>}
        </div>
        {!preview && <div className="behavior-form-actions"><button className="primary-button" type="button" disabled={busy || !educationStage || !ruleCode || !selectedStudents.length} onClick={requestPreview}>{busy ? <Loader2 className="spin" size={18} /> : <ClipboardCheck size={18} />}معاينة الإجراء قبل الحفظ</button></div>}
        {preview && <div className="behavior-preview"><div className="behavior-preview-title"><div><strong>المعاينة النظامية</strong><small>{preview.rule.title} · المادة {preview.rule.article} · صفحة {preview.rule.page}</small></div><button className="secondary-button" type="button" onClick={() => setPreview(null)}>تعديل الاختيار</button></div><div className="behavior-preview-list">{preview.students.map(student => <article key={student.id} className={student.exhausted || !student.applicable ? 'blocked' : ''}><div><strong>{student.name}</strong><small>{student.grade} / {student.classroom}</small></div><span>التكرار {student.recurrence}</span><span>{student.procedureName || 'يتطلب مراجعة'}</span><b>{student.descriptiveOnly ? 'توثيق وصفي بلا حسم' : category === 'distinguished' ? `+${student.distinguishedScore} درجات` : student.deduction ? `حسم ${student.deduction}` : 'دون حسم في هذا الإجراء'}</b>{student.exhausted && <em>اكتمل تسلسل الإجراءات؛ لا يمكن تكرار إجراء سابق.</em>}{!student.applicable && <em>السلوك لا يطابق مرحلة الطالب.</em>}</article>)}</div><button className="primary-button" type="button" disabled={busy || preview.students.some(student => student.exhausted || !student.applicable)} onClick={saveIncident}>{busy ? <Loader2 className="spin" size={18} /> : <Save size={18} />}حفظ وإرسال للاعتماد</button></div>}
      </section>}

      {(view === 'records' || view === 'approvals') && <section className="panel behavior-records-panel">
        <div className="behavior-section-head"><div><span className="panel-kicker">{view === 'approvals' ? 'قرار المدير' : 'السجل الزمني'}</span><h3>{view === 'approvals' ? 'الاعتمادات المعلقة' : 'السجلات والمتابعة'}</h3></div>{view === 'records' && <select value={recordStatus} onChange={event => setRecordStatus(event.target.value as BehaviorStatus | '')}><option value="">جميع الحالات</option><option value="pending">بانتظار الاعتماد</option><option value="approved">معتمد</option><option value="cancelled">ملغى</option></select>}</div>
        {loading ? <div className="behavior-inline-loading"><Loader2 className="spin" />جاري التحميل...</div> : <div className="behavior-record-list">{!records.length && <div className="behavior-empty">لا توجد سجلات ضمن هذا الاختيار.</div>}{records.map(record => <article key={record.id} className={expandedRecord === record.id ? 'open' : ''}><button className="behavior-record-summary" type="button" onClick={() => setExpandedRecord(current => current === record.id ? '' : record.id)}><span className={`behavior-degree degree-${record.degree || 0}`}>{record.degree ? `د${record.degree}` : <Award size={17} />}</span><span><strong>{record.name}</strong><small>{record.ruleTitle} · {record.date}</small></span><span className={`behavior-status ${record.status}`}>{statusLabel[record.status]}</span><b>{record.descriptiveOnly ? 'وصفي' : record.amount ? `${record.amount} درجة` : 'دون حسم'}</b><ChevronLeft /></button>{expandedRecord === record.id && <div className="behavior-record-details"><dl><div><dt>المرحلة</dt><dd>{stageLabel[record.stage] || 'غير محددة'}</dd></div><div><dt>الصف والفصل</dt><dd>{record.grade} / {record.classroom}</dd></div><div><dt>التكرار</dt><dd>{record.recurrence}</dd></div><div><dt>الإجراء</dt><dd>{record.procedureName}</dd></div><div><dt>نوع التعليم</dt><dd>{record.mode === 'in_person' ? 'حضوري' : 'إلكتروني'}</dd></div></dl>{record.description && <p>{record.description}</p>} {!!record.actionSteps?.length && <div className="behavior-actions-list"><strong>خطوات الإجراء</strong>{record.actionSteps.map(action => <div key={action.id}><span className={`action-state ${action.state}`}>{action.state === 'required' ? 'مطلوب' : action.state === 'executed' ? 'نُفذ' : 'لم ينفذ'}</span><p>{action.label}{action.reason && <small>السبب: {action.reason}</small>}{action.evidence && <small>الشاهد: {action.evidence}</small>}</p>{record.status === 'approved' && action.state === 'required' && <span className="action-buttons"><button onClick={() => updateAction(record.id, action, 'executed')}><Check size={15} />تم التنفيذ</button><button onClick={() => updateAction(record.id, action, 'not_executed')}><XCircle size={15} />تعذر التنفيذ</button></span>}</div>)}</div>}<div className="behavior-record-buttons"><button className="secondary-button" onClick={() => openProfile(record.studentId)}><UserRoundSearch size={16} />ملف الطالب</button>{record.status === 'pending' && role === 'admin' && <button className="primary-button" disabled={busy} onClick={() => approveRecord(record.id)}><CheckCircle2 size={16} />اعتماد</button>}{record.status !== 'cancelled' && role === 'admin' && <button className="danger-button" disabled={busy} onClick={() => cancelRecord(record.id)}><RotateCcw size={16} />إلغاء وتصحيح</button>}</div></div>}</article>)}</div>}
      </section>}

      {view === 'compensation' && <section className="panel behavior-profile-panel">
        {!profile && <><div className="behavior-section-head"><div><span className="panel-kicker">ملف الطالب</span><h3>التعويض والملف السلوكي</h3><p>ابحث عن الطالب لعرض كل مخالفاته وتكراراتها وحركات درجاته.</p></div></div><div className="behavior-profile-search"><Search size={18} /><input value={studentSearch} onChange={event => setStudentSearch(event.target.value)} placeholder="ابحث بالاسم أو رقم الهوية" /></div><div className="behavior-profile-results">{visibleStudents.slice(0, 30).map(student => <button key={student.id} onClick={() => openProfile(student.id)}><span><strong>{student.name}</strong><small>{student.grade} / {student.classroom}</small></span><b>{student.violationCount || 0} مخالفة</b><ChevronLeft /></button>)}</div></>}
        {profileLoading && <div className="behavior-inline-loading"><Loader2 className="spin" />جاري فتح ملف الطالب...</div>}
        {profile && <><div className="behavior-section-head"><div><button className="behavior-text-button" onClick={() => setProfile(null)}><ArrowRight size={15} />اختيار طالب آخر</button><h3>{profile.student.name}</h3><p>{profile.student.grade} / {profile.student.classroom} · {profile.student.id}</p></div></div>{profile.scores ? <div className="behavior-score-grid"><article><span>السلوك الإيجابي</span><strong>{profile.scores.positiveScore} / 80</strong></article><article><span>السلوك المتميز</span><strong>{profile.scores.distinguishedScore} / 20</strong></article><article><span>المجموع</span><strong>{profile.scores.totalScore} / 100</strong></article></div> : <div className="behavior-alert info"><ShieldAlert size={18} />تقييم هذا الصف وصفي، لذلك لا توجد حركات درجات رقمية.</div>}<div className="behavior-profile-columns"><div><h4>السجل السلوكي</h4><div className="behavior-mini-list">{profile.records.map(item => <article key={item.id}><span className={`behavior-status ${item.status}`}>{statusLabel[item.status]}</span><div><strong>{item.ruleTitle}</strong><small>{item.date} · التكرار {item.recurrence} · {item.procedureName}</small></div></article>)}</div></div><div><h4>الحسم وفرص التعويض</h4><div className="behavior-mini-list">{profile.movements.filter(item => item.type === 'deduction').map(movement => { const reversed = profile.movements.some(item => item.type === 'reversal' && item.sourceMovementId === movement.id); const compensated = profile.movements.filter(item => item.type === 'compensation' && item.sourceMovementId === movement.id).reduce((total, item) => total + Number(item.amount), 0); const remaining = Math.max(0, Math.abs(Number(movement.amount)) - compensated); return <article key={movement.id}><div><strong>حسم {Math.abs(Number(movement.amount))} درجة</strong><small>{movement.reason} · المتبقي للتعويض {reversed ? 0 : remaining}</small></div>{!reversed && remaining > 0 && role === 'admin' && <button className="secondary-button" onClick={() => { setCompensationMovement(movement.id); setCompensationAmount(String(remaining)) }}>تعويض</button>}</article> })}{!profile.movements.some(item => item.type === 'deduction') && <div className="behavior-empty">لا توجد درجات محسومة قابلة للتعويض.</div>}</div></div></div>{compensationMovement && <div className="behavior-compensation-form"><h4>توثيق فرصة التعويض</h4><div className="behavior-form-grid"><label><span>عدد الدرجات</span><input type="number" min="0.5" step="0.5" value={compensationAmount} onChange={event => setCompensationAmount(event.target.value)} /></label><label className="wide"><span>الشاهد أو مرجعه</span><input value={compensationEvidence} onChange={event => setCompensationEvidence(event.target.value)} placeholder="وصف المشاركة أو رقم المرفق" /></label><label className="wide"><span>ملاحظة</span><input value={compensationReason} onChange={event => setCompensationReason(event.target.value)} placeholder="اختياري" /></label></div><div className="behavior-form-actions"><button className="secondary-button" onClick={() => setCompensationMovement('')}>إلغاء</button><button className="primary-button" disabled={busy || !compensationEvidence || !Number(compensationAmount)} onClick={submitCompensation}><Save size={16} />اعتماد التعويض</button></div></div>}</>}
      </section>}

      {view === 'reports' && <section className="panel behavior-reports-panel"><div className="behavior-section-head"><div><span className="panel-kicker">مخرجات رسمية</span><h3>التقارير والنماذج</h3></div></div><div className="behavior-report-filters"><label><span>من</span><input type="date" value={reportFrom} onChange={event => setReportFrom(event.target.value)} /></label><label><span>إلى</span><input type="date" value={reportTo} onChange={event => setReportTo(event.target.value)} /></label><button className="primary-button" onClick={() => loadRecords({ from: reportFrom || undefined, to: reportTo || undefined })}><Search size={17} />عرض التقرير</button></div><div className="behavior-report-cards"><article><FileSpreadsheet /><div><strong>تصدير Excel</strong><small>{records.length} سجل ضمن الفترة</small></div><button onClick={exportExcel} disabled={!records.length}>تصدير</button></article><article><Printer /><div><strong>تقرير PDF</strong><small>بيانات المدرسة وتوقيع المدير</small></div><button onClick={() => openPrintReport(records, school)} disabled={!records.length}>طباعة / PDF</button></article></div><div className="behavior-report-summary"><strong>معاينة مختصرة</strong><span>{records.filter(item => item.status === 'approved').length} معتمد</span><span>{records.filter(item => item.status === 'pending').length} معلق</span><span>{records.filter(item => item.status === 'cancelled').length} ملغى</span></div></section>}

      {view === 'permissions' && <section className="panel behavior-permissions-panel"><div className="behavior-section-head"><div><span className="panel-kicker">الحماية والمسؤوليات</span><h3>الصلاحيات والضوابط</h3></div><span className="behavior-role">صلاحيتك الحالية: {role === 'admin' ? 'مدير المدرسة' : 'موظف'}</span></div><div className="behavior-policy-grid"><article><Users /><div><strong>الرصد</strong><p>المدير والموظف يستطيعان إنشاء واقعة ومراجعة المعاينة قبل حفظها.</p></div></article><article><ClipboardCheck /><div><strong>الاعتماد</strong><p>مدير المدرسة وحده يعتمد السجل؛ ولا تنفذ أي درجة قبل الاعتماد.</p></div></article><article><RotateCcw /><div><strong>الإلغاء والتصحيح</strong><p>لا يحذف السجل بصمت. يسجل السبب وتعكس حركة الدرجة مع بقاء الأثر الرقابي.</p></div></article><article><LockKeyhole /><div><strong>عزل المدارس</strong><p>كل استعلام وكتابة مرتبطان بمعرف المدرسة وتطبّق عليهما سياسات عزل داخل قاعدة البيانات.</p></div></article></div></section>}
    </div>
  )
}
