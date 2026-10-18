import { useEffect, useState } from 'react'
import { BarChart3, BookOpenCheck, CalendarDays, Check, Copy, FileSpreadsheet, FolderOpen, Handshake, KeyRound, LayoutDashboard, LogOut, Menu, Plus, Printer, Save, Send, Trash2, UserRound, X } from 'lucide-react'
import { api, type Account, type NoorSheetMapping, type NoorSheetMappingSource, type TeacherAssessmentPeriod, type TeacherCooperationStatus, type TeacherComprehensiveReport, type TeacherComprehensiveReportOption, type TeacherComprehensiveReportType, type TeacherLesson, type TeacherLessonReport, type TeacherNote, type TeacherPortalDashboard, type TeacherPortalScheduleItem, type TeacherSheetColumn, type TeacherSheetConfig, type TeacherSheetOpenType, type TeacherSheetSubject, type TeacherSheetType } from './api'
import { HijriDatePicker } from './HijriDatePicker'
import { formatHijriDate } from './dateUtils'
import * as XLSX from 'xlsx'
import { TeacherReferralCenter } from './StudentReferrals'
import { TeacherCooperationPanel } from './TeacherCooperation'
import { StudentPortfolioBoard } from './StudentPortfolio'

const notes: TeacherNote[] = ['هروب من الحصة', 'نائم أثناء الدرس', 'لم يحل الواجب', 'عدم التفاعل والمشاركة', 'مشارك فعال', 'لم يحضر الكتاب أو أوراق العمل', 'استخدام الجوال أثناء الحصة', 'الحديث مع زملائه أثناء الدرس']
const dayNames = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const periodLabel = (period: number) => `الحصة ${['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'][period] || period}`
const weekdayForDate = (value: string) => { const day = new Date(`${value}T12:00:00Z`).getUTCDay(); return day === 0 ? 1 : day + 1 }
const dateForWeekday = (value: string, weekday: number) => { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + weekday - weekdayForDate(value)); return date.toISOString().slice(0, 10) }
const teacherSchoolDays = [1, 2, 3, 4, 5]
const teacherSchedulePeriods = (schedule: TeacherPortalScheduleItem[], configured: number[]) => {
  const lastScheduledPeriod = Math.max(0, ...schedule.map(item => item.periodNumber))
  return configured.length ? configured : Array.from({ length: lastScheduledPeriod }, (_, index) => index + 1)
}
const westernDigits = (value: unknown) => String(value ?? '').replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
const scoreText = (value: unknown) => {
  const normalized = westernDigits(value).replace(/[^0-9.]/g, '')
  const dot = normalized.indexOf('.')
  return dot < 0 ? normalized : `${normalized.slice(0, dot + 1)}${normalized.slice(dot + 1).replaceAll('.', '')}`
}
function EnglishDigits({ value }: { value: unknown }) {
  return <>{westernDigits(value).split(/([0-9.]+)/).map((part, index) => /^[0-9.]+$/.test(part) ? <span key={index} className="teacher-sheet-number" lang="en" dir="ltr">{part}</span> : part)}</>
}
const displaySheetValue = (value: string | number | boolean | undefined, type?: TeacherSheetColumn['type']) => type === 'boolean' && value === undefined ? '✓' : value === true ? '✓' : value === false ? '✗' : westernDigits(value)

type TeacherAttendanceStatus = 'present' | 'absent' | 'late'
type StudentState = { status: TeacherAttendanceStatus; note: TeacherNote | ''; sheetValues: Record<string, string | number | boolean> }
type TeacherTab = 'home' | 'schedule' | 'cooperation' | 'referrals' | 'sheets' | 'portfolio' | 'reports' | 'password'
type RenderSheetColumn = TeacherSheetColumn & { key: string; sheetType: TeacherSheetType }
const getSheetColumns = (lesson: TeacherLesson): RenderSheetColumn[] => lesson.sheetConfigs.flatMap(config => config.columns.map(column => ({ ...column, key: `${config.sheetType}:${column.id}`, sheetType: config.sheetType })))
const attendanceStatusLabel = (status: TeacherAttendanceStatus) => status === 'present' ? 'حاضر' : status === 'late' ? 'تأخر عن الحصة' : 'غائب'
const formatHijriDayAndDate = (value: string) => new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'Asia/Riyadh' }).format(new Date(`${value}T12:00:00+03:00`))

const blankColumns = (count: number, prefix = 'خانة'): TeacherSheetColumn[] => Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}-${Date.now()}`, label: `${prefix} ${index + 1}`, type: 'text', maxScore: null, choices: [] }))
const sheetTemplates: Array<{ label: string; columns: TeacherSheetColumn[] }> = [
  { label: 'كشف مفرغ 5 خانات', columns: blankColumns(5) },
  { label: 'كشف واجبات 4', columns: [1, 2, 3, 4].map(number => ({ id: `homework-${number}`, label: `الواجب ${number}`, type: 'choice' as const, maxScore: null, choices: ['حل الواجب', 'لم يحل الواجب'] })) },
  { label: 'كشف اختبارات 4', columns: [1, 2, 3, 4].map(number => ({ id: `test-${number}`, label: `اختبار ${number}`, type: 'score' as const, maxScore: 10, choices: [] })) },
]

const sheetTypeLabels: Record<TeacherSheetOpenType, string> = { followup: 'المتابعة', homework: 'الواجبات', tests: 'الاختبارات', noor: 'كشف مطابق لنور', combined: 'الكشف المدمج' }
const assessmentPeriods: Array<{ value: TeacherAssessmentPeriod; label: string }> = [
  { value: 'period1', label: 'الفترة الأولى' },
  { value: 'period2', label: 'الفترة الثانية' },
  { value: 'period3', label: 'الفترة الثالثة' },
  { value: 'period4', label: 'الفترة الرابعة' },
  { value: 'final', label: 'نهاية الفصل' },
]
const assessmentPeriodLabel = (value: TeacherAssessmentPeriod) => assessmentPeriods.find(item => item.value === value)?.label || 'الفترة الأولى'

function TeacherSheetsSetup({ sheets, onSaved, onDeleted }: { sheets: TeacherSheetSubject[]; onSaved: (config: TeacherSheetConfig) => void; onDeleted: (subject: string, sheetType: TeacherSheetType, assessmentPeriod: TeacherAssessmentPeriod) => void }) {
  const [subjectIndex, setSubjectIndex] = useState(0)
  const [assessmentPeriod, setAssessmentPeriod] = useState<TeacherAssessmentPeriod>('period1')
  const [sheetType, setSheetType] = useState<TeacherSheetType>('followup')
  const subject = sheets[subjectIndex]
  const config = subject?.configs.find(item => item.sheetType === sheetType && item.assessmentPeriod === assessmentPeriod)
  const [columns, setColumns] = useState<TeacherSheetColumn[]>(config?.columns || blankColumns(5))
  const [copySubject, setCopySubject] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { const configs = sheets[subjectIndex]?.configs || []; const next = configs.find(item => item.sheetType === sheetType && item.assessmentPeriod === assessmentPeriod) || (assessmentPeriod === 'final' ? undefined : configs.find(item => item.sheetType === sheetType && item.assessmentPeriod === 'period1')); setColumns(next?.columns?.length ? next.columns : blankColumns(5)); setCopySubject(''); setError('') }, [subjectIndex, assessmentPeriod, sheetType, sheets])
  const updateColumn = (index: number, update: Partial<TeacherSheetColumn>) => setColumns(current => current.map((column, columnIndex) => columnIndex === index ? { ...column, ...update } : column))
  const updateColumnType = (index: number, type: TeacherSheetColumn['type']) => {
    const current = columns[index]
    updateColumn(index, {
      type,
      maxScore: type === 'score' ? (current?.maxScore ?? 10) : null,
      choices: type === 'choice' ? (current?.choices.length ? current.choices : ['', '']) : [],
    })
  }
  const updateChoice = (columnIndex: number, choiceIndex: number, value: string) => setColumns(current => current.map((column, index) => {
    if (index !== columnIndex) return column
    return { ...column, choices: column.choices.map((choice, currentIndex) => currentIndex === choiceIndex ? value : choice) }
  }))
  const addChoice = (columnIndex: number) => setColumns(current => current.map((column, index) => {
    if (index !== columnIndex || column.choices.length >= 10) return column
    return { ...column, choices: [...column.choices, ''] }
  }))
  const removeChoice = (columnIndex: number, choiceIndex: number) => setColumns(current => current.map((column, index) => {
    if (index !== columnIndex || column.choices.length <= 1) return column
    return { ...column, choices: column.choices.filter((_, currentIndex) => currentIndex !== choiceIndex) }
  }))
  const save = async () => {
    if (!subject || !columns.length) { setError('أضف خانة واحدة على الأقل قبل الحفظ.'); return }
    setBusy(true); setError('')
    try { const result = await api.saveTeacherSheetConfig(subject.subject, sheetType, columns, assessmentPeriod); onSaved(result.config); if (subjectIndex < sheets.length - 1) setSubjectIndex(current => current + 1) } catch { setError('تعذر حفظ تصميم الكشف. تحقق من الاتصال ثم أعد المحاولة.') } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!subject || !config || !window.confirm(`هل تريد حذف كشف ${sheetTypeLabels[sheetType]} لمادة ${subject.subject}؟ ستبقى بياناته القديمة محفوظة.`)) return
    setBusy(true); setError('')
    try { await api.deleteTeacherSheetConfig(subject.subject, sheetType, assessmentPeriod); onDeleted(subject.subject, sheetType, assessmentPeriod); setColumns(blankColumns(5)) } catch { setError('تعذر حذف الكشف. تحقق من الاتصال ثم أعد المحاولة.') } finally { setBusy(false) }
  }
  if (!subject) return <p className="teacher-empty">لا توجد مواد مسندة إلى حسابك.</p>
  return <div className="teacher-sheet-setup">
    <div className="teacher-sheet-subjects">{sheets.map((item, index) => <button type="button" key={item.subject} className={index === subjectIndex ? 'active' : ''} onClick={() => setSubjectIndex(index)}>{item.subject}<small>{item.configs.length} من 4 كشوف جاهزة</small></button>)}</div>
    <div className="teacher-sheet-setup-head"><div><span>إعداد كشوف المادة {subjectIndex + 1} من {sheets.length}</span><h3>{subject.subject}</h3></div><span className="teacher-sheet-count">{columns.length} من 30 خانة</span></div>
    <div className="teacher-sheet-type-block"><strong className="teacher-sheet-step-title">1. اختر الفترة ثم نوع الكشف الذي ستعده الآن</strong><label className="teacher-sheet-period-select">الفترة<select value={assessmentPeriod} onChange={event => setAssessmentPeriod(event.target.value as TeacherAssessmentPeriod)}>{assessmentPeriods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{assessmentPeriod === 'final' && <p className="teacher-sheet-period-note">نهاية الفصل لها تصميم ودرجات مستقلة عن كشوف الفترات.</p>}<div className="teacher-sheet-type-tabs">{(['followup', 'homework', 'tests', 'noor'] as TeacherSheetType[]).map(type => <button type="button" key={type} className={sheetType === type ? 'active' : ''} onClick={() => setSheetType(type)}>{sheetTypeLabels[type]}<small>{subject.configs.some(item => item.sheetType === type && item.assessmentPeriod === assessmentPeriod) ? 'جاهز' : assessmentPeriod !== 'final' && subject.configs.some(item => item.sheetType === type && item.assessmentPeriod === 'period1') ? 'سيبدأ بتصميم الفترة الأولى' : 'غير مُعد'}</small></button>)}</div>{config && <div className="teacher-sheet-delete-row"><span>الكشف الحالي: {sheetTypeLabels[sheetType]} · {assessmentPeriodLabel(assessmentPeriod)}</span><button type="button" className="outline-button danger-sheet-button" onClick={() => void remove()} disabled={busy}><Trash2 size={15} /> حذف هذا الكشف</button></div>}</div>
    <div className="teacher-sheet-actions"><strong>2. اختر قالباً أو عدّل الأعمدة</strong>{sheetTemplates.map(template => <button type="button" className="outline-button" key={template.label} onClick={() => setColumns(template.columns.map(column => ({ ...column, id: `${column.id}-${Date.now()}-${Math.random()}` })))}>{template.label}</button>)}<label className="teacher-sheet-copy"><Copy size={15} /> نسخ تصميم من مادة<select value={copySubject} onChange={event => { const sourceConfigs = sheets.find(item => item.subject === event.target.value)?.configs || []; const source = sourceConfigs.find(item => item.sheetType === sheetType && item.assessmentPeriod === assessmentPeriod) || (assessmentPeriod === 'final' ? undefined : sourceConfigs.find(item => item.sheetType === sheetType && item.assessmentPeriod === 'period1')); setCopySubject(event.target.value); if (source?.columns.length) setColumns(source.columns.map(column => ({ ...column, id: `${column.id}-${Date.now()}-${Math.random()}` }))) }}><option value="">اختر مادة</option>{sheets.filter(item => item.subject !== subject.subject && item.configs.some(config => config.sheetType === sheetType && (config.assessmentPeriod === assessmentPeriod || (assessmentPeriod !== 'final' && config.assessmentPeriod === 'period1')))).map(item => <option key={item.subject} value={item.subject}>{item.subject}</option>)}</select></label></div>
    <div className="teacher-sheet-columns-head"><strong>أعمدة كشف {subject.subject}</strong><button type="button" className="outline-button" onClick={() => columns.length < 30 && setColumns(current => [...current, ...blankColumns(1, 'خانة')])} disabled={columns.length >= 30}><Plus size={16} /> إضافة عمود</button></div>
    <div className="teacher-sheet-columns">{columns.map((column, index) => <div className="teacher-sheet-column-row" key={column.id}>
      <input value={column.label} onChange={event => updateColumn(index, { label: event.target.value })} aria-label={`اسم العمود ${index + 1}`} />
      <select value={column.type} onChange={event => updateColumnType(index, event.target.value as TeacherSheetColumn['type'])} aria-label={`نوع العمود ${index + 1}`}><option value="score">درجة</option><option value="text">نص</option><option value="choice">اختيار</option><option value="boolean">صح أو خطأ</option></select>
      {column.type === 'score' && <input className="teacher-sheet-score-input teacher-sheet-number" type="text" inputMode="decimal" value={scoreText(column.maxScore ?? 10)} onChange={event => updateColumn(index, { maxScore: Number(scoreText(event.target.value)) })} aria-label="الدرجة العظمى" />}
      {column.type === 'choice' && <div className="teacher-sheet-choice-editor"><div className="teacher-sheet-choice-head"><strong>خيارات القائمة</strong><button type="button" className="outline-button teacher-sheet-add-choice" onClick={() => addChoice(index)} disabled={column.choices.length >= 10}><Plus size={15} /> إضافة خيار</button></div><div className="teacher-sheet-choice-list">{column.choices.map((choice, choiceIndex) => <div className="teacher-sheet-choice-row" key={`${column.id}-choice-${choiceIndex}`}><input value={choice} onChange={event => updateChoice(index, choiceIndex, event.target.value)} placeholder={`الخيار ${choiceIndex + 1}`} aria-label={`الخيار ${choiceIndex + 1} للعمود ${column.label || index + 1}`} /><button type="button" className="icon-button danger" onClick={() => removeChoice(index, choiceIndex)} disabled={column.choices.length <= 1} title="حذف الخيار" aria-label={`حذف الخيار ${choiceIndex + 1}`}><Trash2 size={15} /></button></div>)}</div></div>}
      <button type="button" className="icon-button danger teacher-sheet-delete-column" onClick={() => setColumns(current => current.filter((_, columnIndex) => columnIndex !== index))} title="حذف العمود" aria-label={`حذف العمود ${column.label || index + 1}`}><Trash2 size={16} /></button>
    </div>)}</div>
    {error && <p className="teacher-notice error" role="alert">{error}</p>}<button type="button" className="primary-button" onClick={() => void save()} disabled={busy}><Check size={17} /> {busy ? 'جارٍ الحفظ…' : subjectIndex < sheets.length - 1 ? 'تأكيد والانتقال للمادة التالية' : 'حفظ تصميم الكشوف'}</button>
  </div>
}

function TeacherSheetStart({ sheets, schedule, onOpen }: { sheets: TeacherSheetSubject[]; schedule: TeacherPortalScheduleItem[]; onOpen: (item: TeacherPortalScheduleItem, type: TeacherSheetOpenType, assessmentPeriod: TeacherAssessmentPeriod) => void }) {
  const [subject, setSubject] = useState(sheets[0]?.subject || '')
  const [assessmentPeriod, setAssessmentPeriod] = useState<TeacherAssessmentPeriod>('period1')
  const [sheetType, setSheetType] = useState<TeacherSheetOpenType>('followup')
  const [classroomId, setClassroomId] = useState('')
  const classrooms = [...new Map(schedule.filter(item => item.subject === subject).map(item => [item.classroom, item])).values()]
  const subjectConfigs = sheets.find(sheet => sheet.subject === subject)?.configs || []
  const currentConfigs = subjectConfigs.filter(item => item.assessmentPeriod === assessmentPeriod)
  const fallbackConfigs = assessmentPeriod === 'final' ? [] : subjectConfigs.filter(item => item.assessmentPeriod === 'period1')
  const availableConfigs = currentConfigs.length ? currentConfigs : fallbackConfigs
  const config = sheetType === 'combined' ? availableConfigs.find(item => item.sheetType === 'followup') || availableConfigs[0] : availableConfigs.find(item => item.sheetType === sheetType)
  useEffect(() => { setClassroomId(classrooms[0]?.classroomId || '') }, [subject, schedule.length])
  const selected = classrooms.find(item => item.classroomId === classroomId)
  return <div className="teacher-sheet-start">
    <div className="teacher-sheet-selectors"><label>الفترة<select value={assessmentPeriod} onChange={event => setAssessmentPeriod(event.target.value as TeacherAssessmentPeriod)}>{assessmentPeriods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>المادة<select value={subject} onChange={event => setSubject(event.target.value)}><option value="">اختر المادة</option>{sheets.map(sheet => <option key={sheet.subject} value={sheet.subject}>{sheet.subject}</option>)}</select></label><label>الفصل<select value={classroomId} onChange={event => setClassroomId(event.target.value)} disabled={!classrooms.length}><option value="">اختر الفصل</option>{classrooms.map(item => <option key={item.classroomId} value={item.classroomId}>{item.classroom}</option>)}</select></label><label>نوع العرض<select value={sheetType} onChange={event => setSheetType(event.target.value as TeacherSheetOpenType)}><option value="combined">الكشف المدمج</option><option value="followup">المتابعة فقط</option><option value="homework">الواجبات فقط</option><option value="tests">الاختبارات فقط</option><option value="noor">كشف مطابق لنور</option></select></label></div>
    {!classrooms.length && subject && <p className="teacher-empty">لا توجد فصول مرتبطة بهذه المادة في جدولك.</p>}
    {assessmentPeriod === 'final' && <p className="teacher-sheet-period-note">نهاية الفصل مستقلة: أنشئ كشف نور الخاص بها أو أعد أعمدتها قبل فتحها.</p>}
    {subject && !config?.version && <p className="teacher-empty">أعد إعداد قسم هذا العرض لهذه الفترة أولاً.</p>}
    {selected && config?.version ? <button type="button" className="primary-button" onClick={() => onOpen(selected, sheetType, assessmentPeriod)}><BookOpenCheck size={17} /> فتح كشف {sheetTypeLabels[sheetType]} · {assessmentPeriodLabel(assessmentPeriod)} · {selected.classroom}</button> : null}
  </div>
}

function TeacherNoorSheetGuide({ sheets, onBack, onSaved }: { sheets: TeacherSheetSubject[]; onBack: () => void; onSaved: (config: TeacherSheetConfig) => void }) {
  const [subject, setSubject] = useState(sheets[0]?.subject || '')
  const [assessmentPeriod, setAssessmentPeriod] = useState<TeacherAssessmentPeriod>('period1')
  const [imageName, setImageName] = useState('')
  const [imagePreview, setImagePreview] = useState('')
  const [imageError, setImageError] = useState('')
  const [columns, setColumns] = useState<TeacherSheetColumn[]>([])
  const [scanInfo, setScanInfo] = useState<{ subject: string; period: string } | null>(null)
  const [busy, setBusy] = useState<'scan' | 'save' | ''>('')
  const [saved, setSaved] = useState(false)
  const newColumn = (): TeacherSheetColumn => ({ id: `noor-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: '', type: 'score', maxScore: 10, choices: [] })
  const resetScan = () => { setColumns([]); setScanInfo(null); setSaved(false) }
  const chooseImage = (file?: File) => {
    setImageError('')
    if (!file) return
    if (!file.type.startsWith('image/')) { setImageError('اختر صورة بصيغة PNG أو JPG أو WEBP.'); return }
    if (file.size > 8 * 1024 * 1024) { setImageError('حجم الصورة أكبر من 8 ميجابايت. اختر صورة أصغر وواضحة.'); return }
    const reader = new FileReader()
    reader.onload = () => { setImageName(file.name); setImagePreview(String(reader.result || '')); resetScan() }
    reader.onerror = () => setImageError('تعذر قراءة الصورة. اخترها مرة أخرى.')
    reader.readAsDataURL(file)
  }
  const scan = async () => {
    if (!subject) { setImageError('اختر المادة أولًا.'); return }
    if (!imagePreview) { setImageError('ارفع صورة من نظام نور أولًا.'); return }
    setBusy('scan'); setImageError(''); setSaved(false)
    try {
      const result = await api.scanNoorSheet(subject, imagePreview)
      setColumns(result.columns.map((column, index) => ({ id: `noor-${Date.now()}-${index + 1}`, label: column.label, type: 'score', maxScore: column.maxScore, choices: [] })))
      setScanInfo(result.metadata)
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      setColumns([]); setScanInfo(null)
      setImageError(code.includes('noor_columns_not_detected') ? 'لم نتمكن من قراءة عناوين الدرجات. أعد رفع لقطة واضحة تشمل رأس الجدول وأرقام الدرجات القصوى، أو أضف الأعمدة يدويًا.' : 'تعذر قراءة الصورة. تحقق من وضوحها ثم حاول مرة أخرى.')
    } finally { setBusy('') }
  }
  const updateColumn = (index: number, update: Partial<TeacherSheetColumn>) => setColumns(current => current.map((column, currentIndex) => currentIndex === index ? { ...column, ...update } : column))
  const removeColumn = (index: number) => setColumns(current => current.filter((_, currentIndex) => currentIndex !== index))
  const save = async () => {
    const prepared = columns.map((column, index) => ({ ...column, id: column.id || `noor-${Date.now()}-${index + 1}`, label: column.label.trim(), maxScore: Number(column.maxScore) }))
    if (!subject) { setImageError('اختر المادة أولًا.'); return }
    if (!prepared.length || prepared.some(column => !column.label || !Number.isFinite(column.maxScore) || (column.maxScore || 0) < 1 || (column.maxScore || 0) > 1000)) {
      setImageError('راجع اسم كل عمود ودرجته القصوى قبل الاعتماد.'); return
    }
    setBusy('save'); setImageError('')
    try {
      const result = await api.saveTeacherSheetConfig(subject, 'noor', prepared, assessmentPeriod)
      onSaved(result.config); setSaved(true)
    } catch { setImageError('تعذر حفظ كشف نور. تحقق من الاتصال ثم أعد المحاولة.') } finally { setBusy('') }
  }
  return <section className="teacher-noor-guide" aria-labelledby="teacher-noor-guide-title">
    <div className="teacher-section-head">
      <div>
        <button type="button" className="outline-button" onClick={onBack}>العودة إلى الكشوف</button>
        <span className="teacher-experimental-badge">تجريبي</span>
        <h2 id="teacher-noor-guide-title">نسخ نموذج كشف من نور</h2>
        <p>ارفع لقطة كاملة من صفحة درجات نور لتُنشأ أعمدة الدرجات وحدودها، ثم راجعها قبل الاعتماد.</p>
      </div>
      <Copy size={30} />
    </div>
    <div className="teacher-noor-guide-body">
      <div className="teacher-noor-warning"><strong>قبل البدء</strong><span>اختر المادة أولًا، ثم ارفع لقطة واضحة من صفحة الرصد في نور. لا تكتب كلمة مرور نور أو أي بيانات دخول هنا.</span></div>
      <div className="teacher-noor-period-selectors"><label className="teacher-noor-subject-select">الفترة<select value={assessmentPeriod} onChange={event => { setAssessmentPeriod(event.target.value as TeacherAssessmentPeriod); resetScan() }}>{assessmentPeriods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="teacher-noor-subject-select">المادة المطلوب إنشاء كشفها<select value={subject} onChange={event => { setSubject(event.target.value); resetScan() }}><option value="">اختر المادة</option>{sheets.map(sheet => <option key={sheet.subject} value={sheet.subject}>{sheet.subject}</option>)}</select></label></div>
      {assessmentPeriod === 'final' && <p className="teacher-sheet-period-note">ارفع نموذج نور لنهاية الفصل تحديدًا؛ يحفظ هذا التصميم مستقلاً عن جميع الفترات.</p>}
      <div className="teacher-noor-upload-block">
        <strong>صورة نموذج نور</strong>
        <span>ارفع لقطة كاملة مثل صفحة إدخال الدرجات؛ تتعرف الأداة على أسماء مجموعات الدرجات ودرجاتها القصوى حتى لو اختلفت بين المواد.</span>
        <label className="primary-button teacher-noor-upload-button">رفع الصورة<input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={event => chooseImage(event.target.files?.[0])} /></label>
        {imageError && <p className="teacher-notice error" role="alert">{imageError}</p>}
        {imagePreview && <><div className="teacher-noor-image-preview"><div><strong>تم اختيار الصورة</strong><span>{imageName}</span><small>تُعالج الصورة مؤقتًا لاستخراج عناوين الأعمدة، ثم تُحذف من الخادم ولا تُحفظ ضمن بيانات المدرسة.</small></div><img src={imagePreview} alt="معاينة صورة نموذج نور" /></div><div className="teacher-noor-upload-actions"><button type="button" className="primary-button" onClick={() => void scan()} disabled={!subject || busy !== ''}>{busy === 'scan' ? 'جارٍ قراءة الأعمدة…' : 'قراءة الأعمدة من الصورة'}</button><button type="button" className="outline-button" onClick={() => { setImageName(''); setImagePreview(''); resetScan(); setImageError('') }} disabled={busy !== ''}>إزالة الصورة</button></div></>}
      </div>
      {columns.length > 0 && <section className="teacher-noor-detected" aria-live="polite">
        <div className="teacher-noor-detected-head"><div><strong>الأعمدة المقروءة من الصورة</strong><span>المجموع ورقم الهوية واسم الطالب والملاحظات لا تدخل في الكشف لأنها ليست حقول درجات.</span></div><span>{columns.length} أعمدة</span></div>
        {scanInfo && (scanInfo.subject || scanInfo.period) && <p className="teacher-noor-scan-info">تمت قراءة: {scanInfo.subject ? `المادة الظاهرة «${scanInfo.subject}»` : ''}{scanInfo.subject && scanInfo.period ? ' · ' : ''}{scanInfo.period ? `الفترة «${scanInfo.period}»` : ''}. المادة المختارة أعلاه هي المعتمدة للحفظ.</p>}
        <div className="teacher-noor-columns">{columns.map((column, index) => <div className="teacher-noor-column" key={column.id}><label>اسم العمود<input value={column.label} onChange={event => updateColumn(index, { label: event.target.value })} aria-label={`اسم العمود ${index + 1}`} /></label><label>الدرجة القصوى<input className="teacher-sheet-number" lang="en" dir="ltr" type="text" inputMode="decimal" value={scoreText(column.maxScore ?? '')} onChange={event => { const value = scoreText(event.target.value); updateColumn(index, { maxScore: value === '' ? null : Number(value) }) }} aria-label={`الدرجة القصوى للعمود ${column.label || index + 1}`} /></label><button type="button" className="icon-button danger" onClick={() => removeColumn(index)} aria-label={`حذف العمود ${column.label || index + 1}`} title="حذف العمود"><Trash2 size={16} /></button></div>)}</div>
        <div className="teacher-noor-upload-actions"><button type="button" className="outline-button" onClick={() => setColumns(current => [...current, newColumn()])} disabled={columns.length >= 30 || busy !== ''}><Plus size={16} /> إضافة عمود</button><button type="button" className="primary-button" onClick={() => void save()} disabled={busy !== ''}>{busy === 'save' ? 'جارٍ إنشاء الكشف…' : 'اعتماد النموذج وإنشاء كشف نور'}</button></div>
      </section>}
      {saved && <div className="teacher-notice success" role="status"><strong>تم إنشاء كشف مطابق لنور لهذه المادة.</strong> من «بدء المتابعة» اختر المادة والفصل ثم «كشف مطابق لنور» لفتح أسماء الطلاب وإدخال الدرجات.</div>}
      <ol className="teacher-noor-guide-steps">
        <li>افتح نظام نور بالطريقة المعتادة واختر المادة والفترة المطلوبتين.</li>
        <li>التقط لقطة تشمل رأس جدول الدرجات وعناوينه والأرقام القصوى مثل 40 أو 60.</li>
        <li>ارفع الصورة ثم اضغط «قراءة الأعمدة من الصورة».</li>
        <li>صحح أي اسم أو درجة لم تُقرأ بدقة، وأضف أو احذف الأعمدة عند الحاجة.</li>
        <li>اعتمد النموذج ليظهر ضمن «بدء المتابعة» في حسابك.</li>
      </ol>
    </div>
  </section>
}

function TeacherNoorSheetMapping({ sheets, onBack, onSaved }: { sheets: TeacherSheetSubject[]; onBack: () => void; onSaved: (config: TeacherSheetConfig) => void }) {
  const subjects = sheets.filter(sheet => sheet.configs.some(config => config.sheetType === 'noor'))
  const [subject, setSubject] = useState(subjects[0]?.subject || '')
  const [assessmentPeriod, setAssessmentPeriod] = useState<TeacherAssessmentPeriod>('period1')
  const [mappings, setMappings] = useState<NoorSheetMapping[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const selected = subjects.find(sheet => sheet.subject === subject)
  const currentConfigs = (selected?.configs || []).filter(config => config.assessmentPeriod === assessmentPeriod)
  const fallbackConfigs = assessmentPeriod === 'final' ? [] : (selected?.configs || []).filter(config => config.assessmentPeriod === 'period1')
  const visibleConfigs = currentConfigs.length ? currentConfigs : fallbackConfigs
  const noorConfig = visibleConfigs.find(config => config.sheetType === 'noor')
  const noorColumns = (noorConfig?.columns || []).filter(column => column.type === 'score' && (column.maxScore || 0) > 0)
  const sourceConfigs = visibleConfigs.filter(config => config.sheetType !== 'noor')
  const sourceColumns = sourceConfigs.flatMap(config => config.columns.filter(column => ['score', 'choice', 'boolean'].includes(column.type)).map(column => ({ ...column, sheetType: config.sheetType as Exclude<TeacherSheetType, 'noor'> })))
  useEffect(() => { setMappings(noorConfig?.noorMappings || noorColumns.map(column => ({ targetColumnId: column.id, sources: [] }))); setError(''); setSaved('') }, [subject, assessmentPeriod, noorConfig?.id])
  const sourceKey = (source: { sheetType: string; columnId?: string; id?: string }) => `${source.sheetType}:${source.columnId || source.id || ''}`
  const mappingFor = (targetColumnId: string) => mappings.find(mapping => mapping.targetColumnId === targetColumnId) || { targetColumnId, sources: [] }
  const isUsedElsewhere = (targetColumnId: string, source: NoorSheetMappingSource) => mappings.some(mapping => mapping.targetColumnId !== targetColumnId && mapping.sources.some(item => sourceKey(item) === sourceKey(source)))
  const sourceOptions = (source: typeof sourceColumns[number]) => source.type === 'choice' ? source.choices.filter(Boolean) : source.type === 'boolean' ? ['true', 'false'] : []
  const sourceMaximum = (source: typeof sourceColumns[number], link: NoorSheetMappingSource) => {
    if (source.type === 'score') return Number(source.maxScore)
    const options = sourceOptions(source)
    if (!options.length || options.some(option => !Object.prototype.hasOwnProperty.call(link.scores || {}, option) || !Number.isFinite(Number(link.scores?.[option])))) return null
    return Math.max(...options.map(option => Number(link.scores?.[option])))
  }
  const summary = (targetColumnId: string) => {
    const mapping = mappingFor(targetColumnId)
    const selectedSources = mapping.sources.map(link => ({ link, source: sourceColumns.find(column => sourceKey(column) === sourceKey(link)) })).filter((item): item is { link: NoorSheetMappingSource; source: typeof sourceColumns[number] } => Boolean(item.source))
    const maximums = selectedSources.map(item => sourceMaximum(item.source, item.link))
    if (maximums.some(value => value === null || !Number.isFinite(value))) return { count: selectedSources.length, total: null }
    return { count: selectedSources.length, total: maximums.reduce<number>((total, value) => total + Number(value ?? 0), 0) }
  }
  const updateSources = (targetColumnId: string, update: (sources: NoorSheetMappingSource[]) => NoorSheetMappingSource[]) => setMappings(current => {
    const exists = current.some(mapping => mapping.targetColumnId === targetColumnId)
    return exists ? current.map(mapping => mapping.targetColumnId === targetColumnId ? { ...mapping, sources: update(mapping.sources) } : mapping) : [...current, { targetColumnId, sources: update([]) }]
  })
  const toggleSource = (targetColumnId: string, source: typeof sourceColumns[number]) => {
    const sourceLink: NoorSheetMappingSource = { sheetType: source.sheetType, columnId: source.id }
    updateSources(targetColumnId, current => current.some(item => sourceKey(item) === sourceKey(sourceLink)) ? current.filter(item => sourceKey(item) !== sourceKey(sourceLink)) : [...current, sourceLink])
    setSaved('')
  }
  const updateChoiceScore = (targetColumnId: string, source: typeof sourceColumns[number], option: string, value: string) => {
    updateSources(targetColumnId, current => current.map(item => {
      if (sourceKey(item) !== sourceKey(source)) return item
      const scores = { ...(item.scores || {}) }
      if (value === '') delete scores[option]
      else scores[option] = Number(value)
      return { ...item, scores }
    }))
    setSaved('')
  }
  const ready = noorColumns.length > 0 && noorColumns.every(target => {
    const result = summary(target.id)
    return result.count > 0 && result.total !== null && Math.abs(result.total - Number(target.maxScore)) < 0.000001
  })
  const save = async () => {
    if (!subject || !ready) { setError('لا يمكن الحفظ قبل مطابقة مجموع كل عمود مع درجة نور المطلوبة تمامًا.'); return }
    setBusy(true); setError(''); setSaved('')
    try { const result = await api.saveNoorSheetMappings(subject, mappings, assessmentPeriod); onSaved(result.config); setMappings(result.config.noorMappings || []); setSaved('تم حفظ الربط. كشف نور يجمع الدرجات تلقائيًا من الآن فصاعدًا.') } catch { setError('تعذر حفظ الربط. راجع الدرجات المختارة واتصالك ثم أعد المحاولة.') } finally { setBusy(false) }
  }
  if (!subjects.length) return <section className="teacher-noor-mapping"><button type="button" className="outline-button" onClick={onBack}>العودة إلى الكشوف</button><p className="teacher-empty">أنشئ كشفًا مطابقًا لنور للمادة أولًا، ثم ارجع لربط أعمدته بالكشوف الأخرى.</p></section>
  return <section className="teacher-noor-mapping" aria-labelledby="teacher-noor-mapping-title">
    <div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={onBack}>العودة إلى الكشوف</button><h2 id="teacher-noor-mapping-title">ربط كشوف المتابعة بكشف نور</h2><p>اختر أعمدة المصدر لكل عمود في نور. لا يمكن الحفظ إلا إذا تطابق المجموع تمامًا.</p></div><Copy size={30} /></div>
    <div className="teacher-noor-period-selectors"><label className="teacher-noor-subject-select">الفترة<select value={assessmentPeriod} onChange={event => setAssessmentPeriod(event.target.value as TeacherAssessmentPeriod)}>{assessmentPeriods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="teacher-noor-subject-select">المادة<select value={subject} onChange={event => setSubject(event.target.value)}>{subjects.map(sheet => <option key={sheet.subject} value={sheet.subject}>{sheet.subject}</option>)}</select></label></div>
    {assessmentPeriod === 'final' && !noorColumns.length && <p className="teacher-sheet-period-note">أنشئ نموذج نور الخاص بنهاية الفصل أولاً؛ لا يُستخدم نموذج أي فترة مكانه.</p>}
    {!sourceColumns.length && <p className="teacher-notice error">أعد كشف المتابعة أو الواجبات أو الاختبارات لهذه المادة أولًا، ثم اختر أعمدته هنا.</p>}
    <div className="teacher-noor-mapping-list">{noorColumns.map(target => {
      const current = mappingFor(target.id)
      const result = summary(target.id)
      const matches = result.total !== null && Math.abs(result.total - Number(target.maxScore)) < 0.000001
      return <article key={target.id} className={matches && result.count ? 'ready' : ''}>
        <header><div><strong>{target.label}</strong><span>درجة نور المطلوبة: <b className="teacher-sheet-number" lang="en" dir="ltr">{westernDigits(target.maxScore)}</b></span></div><span className={matches && result.count ? 'teacher-noor-match ok' : 'teacher-noor-match'}>مجموع المختار: <b className="teacher-sheet-number" lang="en" dir="ltr">{result.total === null ? '—' : westernDigits(result.total)}</b></span></header>
        <div className="teacher-noor-source-groups">{(['followup', 'homework', 'tests'] as Exclude<TeacherSheetType, 'noor'>[]).map(type => {
          const group = sourceColumns.filter(column => column.sheetType === type)
          if (!group.length) return null
          return <section key={type}><h3>{sheetTypeLabels[type]}</h3>{group.map(source => {
            const link = current.sources.find(item => sourceKey(item) === sourceKey(source))
            const checked = Boolean(link)
            const used = isUsedElsewhere(target.id, { sheetType: source.sheetType, columnId: source.id })
            const options = sourceOptions(source)
            return <div className={`teacher-noor-source ${checked ? 'selected' : ''}`} key={sourceKey(source)}><label><input type="checkbox" checked={checked} disabled={used || busy} onChange={() => toggleSource(target.id, source)} /><span>{westernDigits(source.label)}</span>{source.type === 'score' ? <b className="teacher-sheet-number" lang="en" dir="ltr">/ {westernDigits(source.maxScore)}</b> : <small>{source.type === 'choice' ? 'اختيار' : 'صح أو خطأ'}</small>}</label>{used && !checked && <em>مرتبط بعمود نور آخر</em>}{checked && options.length > 0 && <div className="teacher-noor-choice-scores"><span>ضع درجة كل اختيار:</span>{options.map(option => <label key={option}>{option === 'true' ? 'صح' : option === 'false' ? 'خطأ' : westernDigits(option)}<input className="teacher-sheet-number" lang="en" dir="ltr" type="text" inputMode="decimal" value={scoreText(link?.scores?.[option] ?? '')} onChange={event => updateChoiceScore(target.id, source, option, scoreText(event.target.value))} placeholder="—" disabled={busy} /></label>)}</div>}</div>
          })}</section>
        })}</div>
        <footer>{!result.count ? 'اختر أعمدة لهذا العمود.' : result.total === null ? 'أدخل درجات جميع خيارات الأعمدة المختارة.' : matches ? 'المجموع مطابق ويمكن اعتماده.' : `المجموع يجب أن يساوي ${westernDigits(target.maxScore)} تمامًا.`}</footer>
      </article>
    })}</div>
    {error && <p className="teacher-notice error" role="alert">{error}</p>}{saved && <p className="teacher-notice success" role="status">{saved}</p>}
    <button type="button" className="primary-button" onClick={() => void save()} disabled={!ready || busy}>{busy ? 'جارٍ حفظ الربط…' : 'موافق وحفظ الربط'}</button>
  </section>
}

function TeacherSheetRoster({ lesson, selected, states, updateSheetValue, exportSheet, printSheet, saveLesson, busy, noorCalculated = false }: { lesson: TeacherLesson; selected: TeacherPortalScheduleItem; states: Record<string, StudentState>; updateSheetValue: (studentId: string, columnId: string, value: string | number | boolean) => void; exportSheet: () => void; printSheet: () => void; saveLesson: () => void; busy: string; noorCalculated?: boolean }) {
  const columns = getSheetColumns(lesson)
  const applyColumnValue = (column: RenderSheetColumn, value: string | number | boolean) => lesson.students.forEach(student => updateSheetValue(student.id, column.key, value))
  useEffect(() => { if (window.matchMedia('(max-width: 950px)').matches) document.querySelector<HTMLDivElement>('.teacher-sheet-roster .teacher-roster-table-wrap')?.scrollTo({ left: 0 }) }, [lesson])
  return <section className="teacher-card teacher-roster-card teacher-sheet-roster">
    <div className="teacher-section-head"><div><span>{lesson.assignment.subject} · {lesson.mapping.grade} · الفصل {lesson.mapping.classroom} · {assessmentPeriodLabel(lesson.assessmentPeriod)}</span><h2>كشف {lesson.assignment.subject} — {assessmentPeriodLabel(lesson.assessmentPeriod)} — {selected.classroom}</h2>{noorCalculated && <p className="teacher-noor-calculated-note">درجات هذا الكشف تُحسب تلقائيًا من الأعمدة المرتبطة.</p>}</div><div className="teacher-report-actions"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button>{!noorCalculated && <button className="primary-button" onClick={saveLesson} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ الكشف'}</button>}</div></div>
    <div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead>
      <tr><th>الطالب</th>{columns.map(column => <th key={column.key} className="teacher-sheet-heading"><EnglishDigits value={column.label} />{column.type === 'score' && column.maxScore !== null ? <> / <b className="teacher-sheet-number" lang="en" dir="ltr">{westernDigits(column.maxScore)}</b></> : ''}</th>)}</tr>
      <tr className="teacher-sheet-bulk-row"><th>تطبيق على الجميع</th>{columns.map(column => <th key={column.key}>
        {noorCalculated && column.sheetType === 'noor' ? <span className="teacher-noor-auto-cell">محسوب</span> : <>{column.type === 'boolean' && <select defaultValue="" onChange={event => { if (event.target.value) applyColumnValue(column, event.target.value === 'true') }} aria-label={`تطبيق ${column.label} على الجميع`}><option value="">اختر</option><option value="true">✓ الكل</option><option value="false">✗ الكل</option></select>}
        {column.type === 'score' && <input className="teacher-sheet-number" lang="en" dir="ltr" type="text" inputMode="decimal" placeholder="الكل" onChange={event => { const value = scoreText(event.target.value); if (value !== '') applyColumnValue(column, value) }} aria-label={`درجة ${column.label} للجميع`} />}
        {column.type === 'choice' && <select defaultValue="" onChange={event => { if (event.target.value) applyColumnValue(column, event.target.value) }} aria-label={`تطبيق اختيار ${column.label} على الجميع`}><option value="">اختر الكل</option>{column.choices.filter(Boolean).map((choice, choiceIndex) => <option key={`${choice}-${choiceIndex}`} value={choice}>{choice}</option>)}</select>}</>}
      </th>)}</tr>
    </thead><tbody>{lesson.students.map(student => { const state = states[student.id] || { status: 'present' as const, note: '' as const, sheetValues: {} }; return <tr key={student.id}><td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>{columns.map(column => { const marked = state.sheetValues[column.key] !== false; const calculated = noorCalculated && column.sheetType === 'noor'; return <td key={column.key} className="teacher-sheet-cell">{column.type === 'score' && <input className={`teacher-sheet-number ${calculated ? 'teacher-noor-calculated-input' : ''}`} lang="en" dir="ltr" type="text" inputMode="decimal" value={scoreText(state.sheetValues[column.key] ?? '')} readOnly={calculated} onChange={event => !calculated && updateSheetValue(student.id, column.key, scoreText(event.target.value))} aria-label={`${column.label} لـ ${student.name}`} />}{column.type === 'text' && <input value={String(state.sheetValues[column.key] ?? '')} onChange={event => updateSheetValue(student.id, column.key, event.target.value)} aria-label={`${column.label} لـ ${student.name}`} />}{column.type === 'choice' && <select value={String(state.sheetValues[column.key] ?? '')} onChange={event => updateSheetValue(student.id, column.key, event.target.value)} aria-label={`${column.label} لـ ${student.name}`}><option value="">اختر</option>{column.choices.filter(Boolean).map((choice, choiceIndex) => <option key={`${choice}-${choiceIndex}`} value={choice}>{choice}</option>)}</select>}{column.type === 'boolean' && <button type="button" className={`teacher-sheet-boolean-button ${marked ? 'is-checked' : 'is-crossed'}`} onClick={() => updateSheetValue(student.id, column.key, !marked)} aria-label={`${marked ? 'إلغاء' : 'وضع'} علامة ${column.label} لـ ${student.name}`} aria-pressed={marked}>{marked ? <Check size={18} /> : <X size={19} />}</button>}</td> })}</tr> })}</tbody></table></div>
    <div className="teacher-roster-save-bottom"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button>{!noorCalculated && <button className="primary-button" onClick={saveLesson} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ الكشف'}</button>}</div>
  </section>
}

function TeacherWeekSchedule({ date, schedule, periodNumbers, selected, busy, onOpen, onExportExcel, onPrintPdf }: { date: string; schedule: TeacherPortalScheduleItem[]; periodNumbers: number[]; selected: TeacherPortalScheduleItem | null; busy: string; onOpen: (item: TeacherPortalScheduleItem) => void; onExportExcel: () => void; onPrintPdf: () => void }) {
  const firstDate = dateForWeekday(date, teacherSchoolDays[0])
  const lastDate = dateForWeekday(date, teacherSchoolDays[teacherSchoolDays.length - 1])
  const periods = teacherSchedulePeriods(schedule, periodNumbers)

  return <section className="teacher-card teacher-week-card">
    <div className="teacher-section-head teacher-week-heading"><div className="teacher-week-title"><CalendarDays size={28} /><div><span>جدول هذا الأسبوع</span><h2>من {formatHijriDate(firstDate)} إلى {formatHijriDate(lastDate)}</h2><p>اضغط على اسم الفصل لفتح متابعة الحصة في يومها وتاريخها المحددين.</p></div></div><div className="teacher-report-actions"><button type="button" className="outline-button" onClick={onExportExcel} disabled={!periods.length}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="outline-button" onClick={onPrintPdf} disabled={!periods.length}><Printer size={16} /> PDF</button></div></div>
    {!periods.length ? <p className="teacher-empty">لا توجد حصص مسندة إلى جدولك الأسبوعي.</p> : <div className="teacher-week-table-wrap" role="region" aria-label="الجدول الأسبوعي" tabIndex={0}>
      <table className="teacher-week-table">
        <thead><tr><th>اليوم</th>{periods.map(period => <th key={period}>{periodLabel(period)}</th>)}</tr></thead>
        <tbody>{teacherSchoolDays.map(weekday => {
          const lessonDate = dateForWeekday(date, weekday)
          return <tr key={weekday} className={lessonDate === today() ? 'today' : ''}>
            <th><strong>{dayNames[weekday]}</strong><small>{formatHijriDate(lessonDate)}</small></th>
            {periods.map(period => {
              const items = schedule.filter(item => item.weekday === weekday && item.periodNumber === period)
              return <td key={period}>{items.length ? <div className="teacher-week-cell">{items.map(item => <button type="button" key={item.assignmentId} className={selected?.assignmentId === item.assignmentId ? 'selected' : ''} onClick={() => onOpen(item)} disabled={busy === `lesson-${item.assignmentId}`} title={`${item.subject || 'بدون مادة محددة'}${item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : ''}`}><strong>{item.classroom}</strong><small>{busy === `lesson-${item.assignmentId}` ? 'جارٍ الفتح…' : item.subject || 'بدون مادة'}</small></button>)}</div> : <span className="teacher-week-empty">—</span>}</td>
            })}
          </tr>
        })}</tbody>
      </table>
    </div>}
  </section>
}

function TeacherFollowupRoster({ lesson, selected, activeLessonDate, states, updateStudent, exportSheet, printSheet, saveLesson, busy }: { lesson: TeacherLesson; selected: TeacherPortalScheduleItem; activeLessonDate: string; states: Record<string, StudentState>; updateStudent: (studentId: string, update: Partial<StudentState>) => void; exportSheet: () => void; printSheet: () => void; saveLesson: () => void; busy: string }) {
  return <section id="teacher-active-lesson" className="teacher-card teacher-roster-card">
    <div className="teacher-section-head"><div><span>{dayNames[selected.weekday]} · {formatHijriDate(activeLessonDate)} · {lesson.mapping.grade} · الفصل {lesson.mapping.classroom}</span><h2>{periodLabel(selected.periodNumber)} — {selected.classroom}</h2></div><div className="teacher-report-actions"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={saveLesson} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}</button></div></div>
    <p className="teacher-help">اختيار الحالة والملاحظة هنا خاص بمتابعة المعلم، ولا يغيّر سجل الحضور والغياب الإداري.</p>
    <div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>
      {lesson.students.map(student => { const state = states[student.id] || { status: 'present' as const, note: '' as const, sheetValues: {} }; return <tr key={student.id}>
        <td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>
        <td><div className="teacher-status-toggle"><button type="button" className={state.status === 'present' ? 'active present' : ''} onClick={() => updateStudent(student.id, { status: 'present' })}>حاضر</button><button type="button" className={state.status === 'late' ? 'active late' : ''} onClick={() => updateStudent(student.id, { status: 'late', note: '' })}>تأخر عن الحصة</button><button type="button" className={state.status === 'absent' ? 'active absent' : ''} onClick={() => updateStudent(student.id, { status: 'absent', note: '' })}>غائب</button></div></td>
        <td><select value={state.note} disabled={state.status !== 'present'} onChange={event => updateStudent(student.id, { note: event.target.value as TeacherNote | '' })}><option value="">مشارك فعال عند الحفظ</option>{notes.map(note => <option key={note} value={note}>{note}</option>)}</select></td>
      </tr> })}
    </tbody></table></div>
    <div className="teacher-roster-save-bottom"><button className="outline-button" onClick={exportSheet}><FileSpreadsheet size={16} /> Excel</button><button className="outline-button" onClick={printSheet}><Printer size={16} /> PDF</button><button className="primary-button" onClick={saveLesson} disabled={busy === 'save'}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ المتابعة'}</button></div>
  </section>
}

function TeacherSheetReportView({ title, schedule, sheetType, onBack }: { title: string; schedule: TeacherPortalScheduleItem[]; sheetType: TeacherSheetOpenType; onBack: () => void }) {
  const [subject, setSubject] = useState(schedule[0]?.subject || '')
  const [assessmentPeriod, setAssessmentPeriod] = useState<TeacherAssessmentPeriod>('period1')
  const [classroomId, setClassroomId] = useState('')
  const [report, setReport] = useState<import('./api').TeacherSheetReport | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const subjects = [...new Set(schedule.map(item => item.subject).filter(Boolean))]
  const classrooms = [...new Map(schedule.filter(item => item.subject === subject).map(item => [item.classroomId, item])).values()]
  useEffect(() => { setClassroomId(classrooms[0]?.classroomId || ''); setReport(null) }, [subject, schedule.length])
  const load = async () => { if (!subject || !classroomId) return; setBusy(true); setError(''); try { setReport(await api.teacherSheetReport(subject, classroomId, sheetType, assessmentPeriod)) } catch { setReport(null); setError('لا يوجد كشف مُعد لهذه المادة والفصل.') } finally { setBusy(false) } }
  const grouped = sheetType === 'combined'
  const columns = report ? report.sections.flatMap(section => section.columns.map(column => ({ ...column, key: `${section.sheetType}:${column.id}` }))) : []
  const cellText = (student: import('./api').TeacherSheetReport['students'][number], column: (typeof columns)[number]) => String(displaySheetValue(student.values[column.key], column.type))
  const exportReport = () => {
    if (!report) return
    const head = ['رقم الهوية', 'الطالب', ...columns.map(column => westernDigits(column.label))]
    const rows: Array<Array<string | number>> = grouped ? [['', '', ...report.sections.flatMap(section => section.columns.map((_, index) => index === 0 ? sheetTypeLabels[section.sheetType] : ''))], head] : [head]
    for (const student of report.students) rows.push([westernDigits(student.id), student.name, ...columns.map(column => cellText(student, column))])
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    if (grouped) { let start = 2; sheet['!merges'] = report.sections.map(section => { const merge = { s: { r: 0, c: start }, e: { r: 0, c: start + section.columns.length - 1 } }; start += section.columns.length; return merge }) }
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'التقرير'); XLSX.writeFile(workbook, `${title}-${assessmentPeriodLabel(assessmentPeriod)}-${report.subject}-${report.classroom}.xlsx`)
  }
  const printReport = () => {
    if (!report) return
    const esc = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
    const headRows = `${grouped ? `<tr><th rowspan="2">رقم الهوية</th><th rowspan="2">الطالب</th>${report.sections.map(section => `<th class="group" colspan="${section.columns.length}">${sheetTypeLabels[section.sheetType]}</th>`).join('')}</tr>` : ''}<tr>${grouped ? '' : '<th>رقم الهوية</th><th>الطالب</th>'}${columns.map(column => `<th>${esc(column.label)}</th>`).join('')}</tr>`
    const rows = report.students.map(student => `<tr><td dir="ltr">${esc(westernDigits(student.id))}</td><td class="name">${esc(student.name)}</td>${columns.map(column => `<td>${esc(cellText(student, column))}</td>`).join('')}</tr>`).join('')
    const popup = window.open('', '_blank'); if (!popup) return
    popup.document.write(`<html dir="rtl"><head><title>${esc(title)}</title><style>body{font-family:Arial;padding:18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #94a3b8;padding:5px;text-align:center}td.name{text-align:right;white-space:nowrap}th{background:#e2e8f0}th.group{background:#bfdbfe}thead{display:table-header-group}tr{break-inside:avoid}.print-actions{display:flex;gap:8px;padding:8px;background:#0f172a}.print-actions button{padding:9px 14px;border:0;border-radius:7px}.close-preview{background:#fee2e2}@media print{@page{size:A4 landscape;margin:10mm}.print-actions{display:none}}</style></head><body><nav class="print-actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button class="close-preview" onclick="closePreview()">العودة للموقع</button></nav><h2>${esc(title)} - ${esc(report.subject)} - ${esc(report.classroom)}</h2><table><thead>${headRows}</thead><tbody>${rows}</tbody></table><script>function closePreview(){var openerWindow=window.opener;window.close();setTimeout(function(){if(window.closed)return;if(openerWindow&&!openerWindow.closed){window.location.replace(openerWindow.location.href);return}window.history.back()},250)}window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }
  return <section className="teacher-card"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={onBack}>العودة إلى التقارير</button><span>{title}</span><h2>{title}</h2></div><FileSpreadsheet size={30} /></div><div className="teacher-sheet-selectors"><label>الفترة<select value={assessmentPeriod} onChange={event => { setAssessmentPeriod(event.target.value as TeacherAssessmentPeriod); setReport(null) }}>{assessmentPeriods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>المادة<select value={subject} onChange={event => setSubject(event.target.value)}>{subjects.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>الفصل<select value={classroomId} onChange={event => { setClassroomId(event.target.value); setReport(null) }}>{classrooms.map(item => <option key={item.classroomId} value={item.classroomId}>{item.classroom}</option>)}</select></label></div><button type="button" className="primary-button" onClick={() => void load()} disabled={busy}>{busy ? 'جارٍ التحميل…' : 'عرض التقرير'}</button>{error && <p className="teacher-notice error">{error}</p>}{report && <><div className="teacher-report-actions"><button type="button" className="outline-button" onClick={exportReport}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="outline-button" onClick={printReport}><Printer size={16} /> PDF</button></div><div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead>{grouped && <tr><th rowSpan={2}>رقم الهوية</th><th rowSpan={2}>الطالب</th>{report.sections.map(section => <th key={section.sheetType} colSpan={section.columns.length} className="teacher-sheet-section-head">{sheetTypeLabels[section.sheetType]}</th>)}</tr>}<tr>{!grouped && <><th>رقم الهوية</th><th>الطالب</th></>}{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{report.students.map(student => <tr key={student.id}><td className="teacher-sheet-number" dir="ltr">{westernDigits(student.id)}</td><td><strong>{student.name}</strong><small>{student.grade} · {student.classroom}</small></td>{columns.map(column => <td key={column.key}>{cellText(student, column)}</td>)}</tr>)}</tbody></table></div></>}</section>
}

function TeacherStudentGradesView({ schedule, onBack }: { schedule: TeacherPortalScheduleItem[]; onBack: () => void }) {
  const classrooms = [...new Map(schedule.map(item => [item.classroomId, item])).values()]
  const [classroomId, setClassroomId] = useState(classrooms[0]?.classroomId || '')
  const [assessmentPeriod, setAssessmentPeriod] = useState<TeacherAssessmentPeriod>('period1')
  const [data, setData] = useState<Array<{ subject: string; report: import('./api').TeacherSheetReport }>>([])
  const [search, setSearch] = useState('')
  const [studentId, setStudentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!classroomId) return
    let cancelled = false
    const subjects = [...new Set(schedule.filter(item => item.classroomId === classroomId).map(item => item.subject).filter(Boolean))]
    setBusy(true); setError(''); setStudentId(''); setSearch(''); setData([])
    void Promise.allSettled(subjects.map(subject => api.teacherSheetReport(subject, classroomId, 'combined', assessmentPeriod))).then(results => {
      if (cancelled) return
      const found = results.flatMap(result => result.status === 'fulfilled' ? [{ subject: result.value.subject, report: result.value }] : [])
      setData(found)
      if (!found.length) setError('لا توجد كشوف مُعدّة لمواد هذا الفصل.')
    }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [classroomId, assessmentPeriod, schedule.length])
  const students = data[0]?.report.students || []
  const visibleStudents = students.filter(item => !search || item.name.includes(search))
  const student = students.find(item => item.id === studentId)
  const blocks = student ? data.map(({ subject, report }) => {
    const own = report.students.find(item => item.id === student.id)
    return { subject, rows: report.sections.flatMap(section => section.columns.map(column => ({ section: sheetTypeLabels[section.sheetType], label: column.label, max: column.type === 'score' ? column.maxScore : null, value: String(displaySheetValue(own?.values[`${section.sheetType}:${column.id}`], column.type)) }))) }
  }) : []
  const exportReport = () => {
    if (!student) return
    const rows: Array<Array<string | number>> = [['المادة', 'القسم', 'البند', 'القيمة', 'الدرجة العظمى'], ...blocks.flatMap(block => block.rows.map(row => [block.subject, row.section, row.label, row.value, row.max ?? '']))]
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'درجات الطالب'); XLSX.writeFile(workbook, `درجات-${student.name}.xlsx`)
  }
  const printReport = () => {
    if (!student) return
    const esc = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`)
    const body = blocks.map(block => `<h3>${esc(block.subject)}</h3><table><thead><tr><th>القسم</th><th>البند</th><th>القيمة</th></tr></thead><tbody>${block.rows.map(row => `<tr><td>${esc(row.section)}</td><td>${esc(row.label)}</td><td>${esc(row.value)}${row.max && row.value ? ` / ${row.max}` : ''}</td></tr>`).join('')}</tbody></table>`).join('')
    const popup = window.open('', '_blank'); if (!popup) return
    popup.document.write(`<html dir="rtl"><head><title>درجات ${esc(student.name)}</title><style>body{font-family:Arial;padding:18px}table{width:100%;border-collapse:collapse;margin-bottom:14px}th,td{border:1px solid #94a3b8;padding:6px;text-align:right}th{background:#e2e8f0}h3{margin:14px 0 6px}tr{break-inside:avoid}.print-actions{display:flex;gap:8px;padding:8px;background:#0f172a}.print-actions button{padding:9px 14px;border:0;border-radius:7px}.close-preview{background:#fee2e2}@media print{@page{size:A4 portrait;margin:10mm}.print-actions{display:none}}</style></head><body><nav class="print-actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button class="close-preview" onclick="closePreview()">العودة للموقع</button></nav><h2>تقرير درجات الطالب: ${esc(student.name)}</h2><p>${esc(student.grade)} · ${esc(student.classroom)}</p>${body}<script>function closePreview(){var openerWindow=window.opener;window.close();setTimeout(function(){if(window.closed)return;if(openerWindow&&!openerWindow.closed){window.location.replace(openerWindow.location.href);return}window.history.back()},250)}window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }
  return <section className="teacher-card"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={onBack}>العودة إلى التقارير</button><span>تقرير درجات طالب</span><h2>درجات طالب في جميع المواد</h2></div><UserRound size={30} /></div><div className="teacher-sheet-selectors"><label>الفترة<select value={assessmentPeriod} onChange={event => setAssessmentPeriod(event.target.value as TeacherAssessmentPeriod)}>{assessmentPeriods.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>الفصل<select value={classroomId} onChange={event => setClassroomId(event.target.value)}>{classrooms.map(item => <option key={item.classroomId} value={item.classroomId}>{item.classroom}</option>)}</select></label></div>{busy ? <p className="teacher-empty">جارٍ تحميل الكشوف…</p> : error ? <p className="teacher-notice error">{error}</p> : <><div className="teacher-student-search"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الطالب..." aria-label="ابحث باسم الطالب" /><select value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">اختر الطالب</option>{visibleStudents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>{!student ? <p className="teacher-empty">اختر الطالب لعرض درجاته في كل مادة وكل قسم.</p> : <><div className="teacher-report-actions"><button type="button" className="outline-button" onClick={exportReport}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="outline-button" onClick={printReport}><Printer size={16} /> PDF</button></div><p className="teacher-notice"><strong>{student.name}</strong> · {student.grade} · {student.classroom}</p>{blocks.map(block => <div key={block.subject} className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th colSpan={3} className="teacher-sheet-section-head">{block.subject}</th></tr><tr><th>القسم</th><th>البند</th><th>القيمة</th></tr></thead><tbody>{block.rows.map((row, index) => <tr key={`${row.section}-${index}`}><td>{row.section}</td><td>{row.label}</td><td>{row.value ? `${row.value}${row.max ? ` / ${row.max}` : ''}` : '—'}</td></tr>)}</tbody></table></div>)}</>}</>}</section>
}

function TeacherAttendanceReportsTab({ studentMode, onBack }: { studentMode: boolean; onBack: () => void }) {
  const initialFrom = () => { const value = new Date(`${today()}T12:00:00Z`); value.setUTCFullYear(value.getUTCFullYear() - 1); return value.toISOString().slice(0, 10) }
  const [from, setFrom] = useState(initialFrom)
  const [to, setTo] = useState(today())
  const [date, setDate] = useState(today())
  const [search, setSearch] = useState('')
  const [studentId, setStudentId] = useState('')
  const [reports, setReports] = useState<TeacherLessonReport[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async () => { setBusy(true); setError(''); try { setReports((await api.teacherReports(studentMode ? { from, to } : { date })).reports) } catch { setError('تعذر تحميل تقرير الحضور والملاحظات.') } finally { setBusy(false) } }
  useEffect(() => { void load() }, [from, to, date])
  const studentChoices = [...new Map(reports.flatMap(report => report.records.map(record => [record.studentId, record.name]))).entries()]
  const visibleStudents = studentChoices.filter(([, name]) => !search || name.includes(search))
  const allRows = reports.flatMap(report => report.records.map(record => ({ date: report.date, subject: report.subject, period: report.periodNumber, ...record })))
  const rows = studentMode ? allRows.filter(row => row.studentId === studentId).sort((left, right) => left.date.localeCompare(right.date) || left.period - right.period) : allRows
  const absentDays = rows.filter(row => row.status === 'absent').length
  const lateLessons = rows.filter(row => row.status === 'late').length
  const exportReport = () => { const data = [['التاريخ', 'المادة', 'الفصل', 'الحصة', 'الطالب', 'الحالة', 'الملاحظة'], ...rows.map(row => [row.date, row.subject, row.classroom, row.period, row.name, attendanceStatusLabel(row.status), row.note || ''])]; const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'الحضور والملاحظات'); XLSX.writeFile(workbook, `${studentMode ? 'تقرير-طالب' : 'تقرير-الحضور'}-${studentMode ? to : date}.xlsx`) }
  const printReport = () => {
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
    const body = rows.map(row => `<tr><td>${escape(formatHijriDate(row.date))}</td><td>${escape(row.subject)}</td><td>${escape(row.classroom)}</td><td>${escape(row.name)}</td><td>${attendanceStatusLabel(row.status)}</td><td>${escape(row.note || '')}</td></tr>`).join('')
    const popup = window.open('', '_blank')
    if (!popup) return
    popup.document.write(`<html dir="rtl"><head><title>تقرير الحضور والملاحظات</title><style>body{font-family:Arial;padding:18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #94a3b8;padding:7px;text-align:right}th{background:#e2e8f0}.print-actions{display:flex;gap:8px;padding:8px;background:#0f172a}.print-actions button{padding:9px 14px;border:0;border-radius:7px}.close-preview{background:#fee2e2}@media print{@page{size:A4 landscape;margin:10mm}.print-actions{display:none}}</style></head><body><nav class="print-actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button class="close-preview" onclick="closePreview()">العودة للموقع</button></nav><h2>${studentMode ? 'تقرير حضور وملاحظات طالب' : 'تقرير الحضور والملاحظات'}</h2><table><thead><tr><th>التاريخ</th><th>المادة</th><th>الفصل</th><th>الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>${body}</tbody></table><script>function closePreview(){var openerWindow=window.opener;window.close();setTimeout(function(){if(window.closed)return;if(openerWindow&&!openerWindow.closed){window.location.replace(openerWindow.location.href);return}window.history.back()},250)}window.onload=()=>window.print()</script></body></html>`)
    popup.document.close()
  }
  return <section className="teacher-card"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={onBack}>العودة إلى التقارير</button><span>{studentMode ? 'تقرير حضور وملاحظات طالب' : 'تقرير الحضور والملاحظات'}</span><h2>{studentMode ? 'تقرير طالب مفصل' : 'حضور وملاحظات جميع الطلاب'}</h2></div><LayoutDashboard size={30} /></div><div className="teacher-report-filters">{studentMode ? <><HijriDatePicker label="من التاريخ الهجري" value={from} max={to} onChange={setFrom} /><HijriDatePicker label="إلى التاريخ الهجري" value={to} min={from} max={today()} onChange={setTo} /></> : <HijriDatePicker label="التاريخ الهجري" value={date} max={today()} onChange={setDate} />}</div>{studentMode && <div className="teacher-student-search"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم الطالب..." aria-label="ابحث باسم الطالب" /><select value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">اختر الطالب</option>{visibleStudents.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></div>}<div className="teacher-report-actions"><button type="button" className="outline-button" onClick={exportReport} disabled={!rows.length}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="outline-button" onClick={printReport} disabled={!rows.length}><Printer size={16} /> PDF</button><button type="button" className="primary-button" onClick={() => void load()} disabled={busy}>{busy ? 'جارٍ التحميل…' : 'تحديث التقرير'}</button></div>{error && <p className="teacher-notice error">{error}</p>}{busy ? <p className="teacher-empty">جارٍ تحميل البيانات…</p> : studentMode && !studentId ? <p className="teacher-empty">اختر الطالب لعرض سجله في كل الأيام.</p> : !rows.length ? <p className="teacher-empty">لا توجد سجلات ضمن الفترة المحددة.</p> : <>{studentMode && <p className="teacher-notice">إجمالي السجلات: {rows.length} · حاضر: {rows.length - absentDays - lateLessons} · تأخر عن الحصة: {lateLessons} · غائب: {absentDays}</p>}<div className="teacher-roster-table-wrap"><table className="teacher-roster-table"><thead><tr><th>التاريخ</th><th>المادة</th><th>الفصل</th><th>الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.date}-${row.studentId}-${index}`}><td>{formatHijriDate(row.date)}</td><td>{row.subject}</td><td>{row.classroom}</td><td>{row.name}</td><td>{attendanceStatusLabel(row.status)}</td><td>{row.note || '—'}</td></tr>)}</tbody></table></div></>}</section>
}

function TeacherComprehensiveReportView({ type, schoolName, teacherName, onBack }: { type: TeacherComprehensiveReportType; schoolName: string; teacherName: string; onBack: () => void }) {
  const details: Record<TeacherComprehensiveReportType, { title: string; description: string; eventLabel: string; emptyLabel: string; sheetName: string }> = {
    absence: { title: 'تقرير الغياب الشامل', description: 'يعرض جميع أيام غياب كل طالب في المادة والصف والفصل المختارين.', eventLabel: 'أيام الغياب', emptyLabel: 'لا يوجد غياب مسجل', sheetName: 'الغياب الشامل' },
    late: { title: 'تقرير التأخر الشامل', description: 'يعرض جميع أيام تأخر كل طالب عن الحصة في المادة والصف والفصل المختارين.', eventLabel: 'أيام التأخر', emptyLabel: 'لا يوجد تأخر مسجل', sheetName: 'التأخر الشامل' },
    notes: { title: 'تقرير الملاحظات الشامل', description: 'يعرض جميع الملاحظات المسجلة لكل طالب في المادة والصف والفصل المختارين.', eventLabel: 'الملاحظات المسجلة', emptyLabel: 'لا توجد ملاحظات مسجلة', sheetName: 'الملاحظات الشاملة' },
  }
  const info = details[type]
  const [options, setOptions] = useState<TeacherComprehensiveReportOption[]>([])
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [classroomId, setClassroomId] = useState('')
  const [report, setReport] = useState<TeacherComprehensiveReport | null>(null)
  const [busy, setBusy] = useState<'options' | 'report' | ''>('')
  const [error, setError] = useState('')
  const subjects = [...new Set(options.map(option => option.subject))]
  const grades = [...new Set(options.filter(option => option.subject === subject).map(option => option.grade))]
  const classrooms = options.filter(option => option.subject === subject && option.grade === grade)
  const loadOptions = async () => {
    setBusy('options'); setError('')
    try { setOptions((await api.teacherComprehensiveReportOptions()).options) } catch { setError('تعذر تحميل المواد والفصول المرتبطة بحسابك.') } finally { setBusy('') }
  }
  useEffect(() => { void loadOptions() }, [])
  const showReport = async () => {
    if (!subject || !grade || !classroomId) { setError('اختر المادة والصف والفصل أولًا.'); return }
    setBusy('report'); setError(''); setReport(null)
    try { setReport(await api.teacherComprehensiveReport(type, subject, classroomId)) } catch { setError('تعذر إعداد التقرير. تأكد من ارتباط الفصل بطلابك ثم أعد المحاولة.') } finally { setBusy('') }
  }
  const eventText = (event: { date: string; note?: TeacherNote }) => type === 'notes' ? `${formatHijriDayAndDate(event.date)} · ${event.note || ''}` : formatHijriDayAndDate(event.date)
  const exportExcel = () => {
    if (!report) return
    const rows = [["اسم الطالب", 'الصف', 'الفصل', info.eventLabel], ...report.students.map(student => [student.name, report.grade, report.classroom, student.events.length ? student.events.map(eventText).join('\n') : '—'])]
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    sheet['!cols'] = [{ wch: 32 }, { wch: 18 }, { wch: 12 }, { wch: 64 }]
    XLSX.utils.book_append_sheet(workbook, sheet, info.sheetName)
    XLSX.writeFile(workbook, `${info.title}-${report.subject}-${report.grade}-${report.classroom}.xlsx`)
  }
  const openPdfPreview = () => {
    if (!report) return
    const popup = window.open('', '_blank')
    if (!popup) { setError('تعذر فتح معاينة PDF. اسمح للمتصفح بفتح نافذة جديدة ثم أعد المحاولة.'); return }
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&gt;', '>': '&lt;', '"': '&quot;', "'": '&#39;' }[character] || character))
    const events = (student: TeacherComprehensiveReport['students'][number]) => student.events.length
      ? student.events.map(event => `<span class="event-box">${escape(eventText(event))}</span>`).join('')
      : `<span class="event-empty">${escape(info.emptyLabel)}</span>`
    const columns = '<colgroup><col class="number-column"/><col class="name-column"/><col class="events-column"/></colgroup>'
    const rows = report.students.map((student, index) => `<tr><td class="student-number">${index + 1}</td><td class="student-name">${escape(student.name)}</td><td class="events-cell">${events(student)}</td></tr>`).join('')
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escape(info.title)}</title><style>
      *{box-sizing:border-box}body{margin:0;background:#edf3f7;color:#102a43;font-family:Tahoma,Arial,sans-serif}.print-actions{position:sticky;top:0;z-index:5;display:flex;gap:9px;justify-content:center;padding:12px;background:#102a43}.print-actions button{min-height:42px;padding:8px 15px;border:0;border-radius:9px;background:#1476c9;color:#fff;font:700 14px Tahoma,Arial,sans-serif;cursor:pointer}.print-actions .back{background:#fff;color:#8b2e27}.print-page{width:min(1120px,calc(100% - 24px));margin:14px auto;padding:18px;background:#fff;box-shadow:0 4px 20px #102a4320}.report-table{width:100%;border-collapse:collapse;table-layout:fixed}.number-column{width:8mm}.name-column{width:54mm}.events-column{width:auto}.report-table th,.report-table td{border:1px solid #9fb4c4;padding:8px;text-align:right;vertical-align:top}.report-table thead th{background:#edf5fa}.report-title{text-align:center;padding:8px!important}.report-title h1{margin:0;color:#0b4f82;font-size:22px}.report-title p{margin:6px 0 0;font-size:13px;line-height:1.8}.student-number{text-align:center}.student-name{font-weight:700}.event-box{display:inline-flex;align-items:center;min-height:29px;max-width:100%;margin:2px;padding:4px 7px;border:1px solid #6f9ec0;border-radius:5px;background:#f8fcff;font-size:11px;line-height:1.45;overflow-wrap:anywhere}.event-empty{color:#75899a;font-size:12px}.print-footer{display:none}@media print{@page{size:297mm 210mm;margin:7mm}html,body{background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.print-actions{display:none}.print-page{width:283mm;min-height:196mm;margin:0;padding:0;box-shadow:none}.report-table thead{display:table-header-group}.report-table tr{break-inside:avoid;page-break-inside:avoid}.report-table th,.report-table td{padding:6px}.report-title h1{font-size:19px}.event-box{min-height:25px;font-size:10px}.print-footer{display:block;position:fixed;bottom:0;left:0;font-size:9px;color:#5d7284}.print-footer:after{content:'الصفحة ' counter(page)}}@media(max-width:600px){.print-actions{padding:9px;gap:6px}.print-actions button{flex:1;font-size:12px;padding:8px}.print-page{width:calc(100% - 12px);margin:6px auto;padding:9px}.number-column{width:7mm}.name-column{width:34%}.report-table th,.report-table td{padding:6px 4px}.report-title h1{font-size:17px}.report-title p{font-size:11px}.event-box{font-size:10px;padding:3px 5px}}
    </style></head><body><nav class="print-actions"><button onclick="window.print()">طباعة / حفظ PDF</button><button class="back" onclick="backToReport()">إغلاق والعودة للتقرير</button></nav><main class="print-page"><table class="report-table">${columns}<thead><tr><th class="report-title" colspan="3"><h1>${escape(info.title)}</h1><p>${escape(schoolName)}<br/>المعلم: ${escape(teacherName)} · المادة: ${escape(report.subject)} · الصف: ${escape(report.grade)} · الفصل: ${escape(report.classroom)}<br/>${escape(info.eventLabel)} لكل طالب</p></th></tr><tr><th>م</th><th>اسم الطالب</th><th>${escape(info.eventLabel)}</th></tr></thead><tbody>${rows}</tbody></table></main><footer class="print-footer"></footer><script>function backToReport(){if(window.opener&&!window.opener.closed){window.close();return}if(history.length>1){history.back();return}location.replace('/')}</script></body></html>`)
    popup.document.close()
  }
  const studentsWithEvents = report?.students.filter(student => student.events.length).length || 0
  return <section className="teacher-card teacher-comprehensive-report"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={onBack}>العودة إلى التقارير</button><span>تقارير تراكمية</span><h2>{info.title}</h2><p>{info.description}</p></div><CalendarDays size={30} /></div>
    <div className="teacher-report-filters teacher-comprehensive-filters"><label>المادة<select value={subject} onChange={event => { setSubject(event.target.value); setGrade(''); setClassroomId(''); setReport(null) }} disabled={busy === 'options'}><option value="">اختر المادة</option>{subjects.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>الصف<select value={grade} onChange={event => { setGrade(event.target.value); setClassroomId(''); setReport(null) }} disabled={!subject || busy === 'options'}><option value="">اختر الصف</option>{grades.map(item => <option key={item} value={item}>{item}</option>)}</select></label><label>الفصل<select value={classroomId} onChange={event => { setClassroomId(event.target.value); setReport(null) }} disabled={!grade || busy === 'options'}><option value="">اختر الفصل</option>{classrooms.map(item => <option key={item.classroomId} value={item.classroomId}>{item.classroom}</option>)}</select></label><button type="button" className="primary-button" onClick={() => void showReport()} disabled={busy !== '' || !classroomId}>{busy === 'report' ? 'جارٍ إعداد التقرير…' : 'عرض التقرير'}</button></div>
    {busy === 'options' && <p className="teacher-empty">جارٍ تحميل المواد والصفوف والفصول…</p>}{error && <p className="teacher-notice error" role="alert">{error}</p>}{!busy && !options.length && !error && <p className="teacher-empty">لا توجد مواد وفصول مرتبطة بطلاب في حسابك.</p>}
    {report && <><div className="teacher-report-actions teacher-comprehensive-actions"><span>{report.students.length} طالبًا · {studentsWithEvents} لديهم {info.eventLabel}</span><button type="button" className="outline-button" onClick={exportExcel}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="outline-button" onClick={openPdfPreview}><Printer size={16} /> PDF / طباعة</button></div><p className="teacher-notice">{report.subject} · {report.grade} · الفصل {report.classroom} — تظهر جميع الأيام المسجلة لكل طالب من دون السنة.</p><div className="teacher-comprehensive-list">{report.students.map((student, index) => <article key={student.id}><div className="teacher-comprehensive-student"><b>{index + 1}</b><strong>{student.name}</strong></div><div className="teacher-comprehensive-events">{student.events.length ? student.events.map((event, eventIndex) => <span className="teacher-comprehensive-event" key={`${event.date}-${event.note || ''}-${eventIndex}`}>{eventText(event)}</span>) : <span className="teacher-comprehensive-empty">{info.emptyLabel}</span>}</div></article>)}</div></>}
  </section>
}

function TeacherReportsTab({ schedule, schoolName, teacherName }: { schedule: TeacherPortalScheduleItem[]; schoolName: string; teacherName: string }) {
  type ReportMode = 'menu' | 'grades' | 'studentGrades' | 'attendance' | 'studentAttendance' | 'tests' | 'homework' | 'comprehensiveAbsence' | 'comprehensiveLate' | 'comprehensiveNotes'
  const [mode, setMode] = useState<ReportMode>('menu')
  const [date, setDate] = useState(today())
  const [reports, setReports] = useState<TeacherLessonReport[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = async (value = date) => { setBusy(true); setError(''); try { setReports((await api.teacherReports({ date: value })).reports) } catch { setError('تعذر تحميل تقارير المتابعة.') } finally { setBusy(false) } }
  useEffect(() => { void load() }, [date])
  const exportReports = () => {
    const rows = [['المادة', 'الفصل', 'التاريخ', 'الحصة', 'الطالب', 'الحالة', 'الملاحظة'], ...reports.flatMap(report => report.records.map(record => [report.subject, report.classroom, report.date, report.periodNumber, record.name, attendanceStatusLabel(record.status), record.note || '']))]
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'التقارير'); XLSX.writeFile(workbook, `تقارير-المتابعة-${date}.xlsx`)
  }
  if (mode === 'menu') return <section className="teacher-card"><div className="teacher-section-head"><div><span>مركز التقارير</span><h2>التقارير</h2><p>اختر نوع التقرير المطلوب.</p></div><BarChart3 size={30} /></div><div className="teacher-report-menu">{([['grades', 'تقرير كشوف الدرجات', 'درجات جميع أقسام كشف الفصل', FileSpreadsheet], ['studentGrades', 'تقرير درجات طالب', 'ابحث عن طالب واعرض درجاته', UserRound], ['attendance', 'تقرير الحضور والملاحظات', 'حضور وغياب وملاحظات جميع الأيام', LayoutDashboard], ['studentAttendance', 'تقرير حضور طالب', 'سجل طالب واحد بالتفصيل', UserRound], ['tests', 'تقرير الاختبارات', 'درجات الاختبارات حسب الفصل', BarChart3], ['homework', 'تقرير الواجبات', 'حالة ودرجات الواجبات حسب الفصل', FileSpreadsheet], ['comprehensiveAbsence', 'تقرير الغياب الشامل', 'أيام غياب كل طالب في المادة والفصل', CalendarDays], ['comprehensiveLate', 'تقرير التأخر الشامل', 'أيام تأخر كل طالب عن الحصة', CalendarDays], ['comprehensiveNotes', 'تقرير الملاحظات الشامل', 'كل الملاحظات المسجلة للطلاب', BookOpenCheck]] as const).map(([value, title, description, Icon]) => <button type="button" key={value} onClick={() => setMode(value)}><Icon size={25} /><strong>{title}</strong><small>{description}</small></button>)}</div></section>
  if (mode === 'grades' || mode === 'tests' || mode === 'homework') return <TeacherSheetReportView title={mode === 'grades' ? 'تقرير كشوف الدرجات' : mode === 'tests' ? 'تقرير الاختبارات' : 'تقرير الواجبات'} schedule={schedule} sheetType={mode === 'tests' ? 'tests' : mode === 'homework' ? 'homework' : 'combined'} onBack={() => setMode('menu')} />
  if (mode === 'studentGrades') return <TeacherStudentGradesView schedule={schedule} onBack={() => setMode('menu')} />
  if (mode === 'attendance' || mode === 'studentAttendance') return <TeacherAttendanceReportsTab studentMode={mode === 'studentAttendance'} onBack={() => setMode('menu')} />
  if (mode === 'comprehensiveAbsence' || mode === 'comprehensiveLate' || mode === 'comprehensiveNotes') return <TeacherComprehensiveReportView type={mode === 'comprehensiveAbsence' ? 'absence' : mode === 'comprehensiveLate' ? 'late' : 'notes'} schoolName={schoolName} teacherName={teacherName} onBack={() => setMode('menu')} />
  return <section className="teacher-card"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={() => setMode('menu')}>العودة إلى التقارير</button><span>تقرير المتابعة</span><h2>التقارير</h2><p>اعرض حصص المتابعة حسب التاريخ وصدّرها عند الحاجة.</p></div><BarChart3 size={30} /></div><div className="teacher-report-filters"><HijriDatePicker label="تاريخ التقرير الهجري" value={date} max={today()} onChange={setDate} /><div className="teacher-report-actions"><button type="button" className="outline-button" onClick={exportReports} disabled={!reports.length}><FileSpreadsheet size={16} /> Excel</button><button type="button" className="primary-button" onClick={() => void load()} disabled={busy}>{busy ? 'جارٍ التحميل…' : 'تحديث التقارير'}</button></div></div>{error && <p className="teacher-notice error">{error}</p>}{busy ? <p className="teacher-empty">جارٍ التحميل…</p> : !reports.length ? <p className="teacher-empty">لا توجد تقارير متابعة لهذا التاريخ.</p> : <div className="teacher-report-list">{reports.map(report => <article key={report.id}><div><strong>{report.subject || 'مادة غير محددة'} · {report.classroom}</strong><span>{formatHijriDate(report.date)} · {periodLabel(report.periodNumber)} · {report.studentsCount} طالب · {report.presentCount} حاضر · {report.lateCount} تأخر عن الحصة · {report.absentCount} غائب</span></div></article>)}</div>}</section>
}

export function TeacherPortal({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [date, setDate] = useState(today())
  const [dashboard, setDashboard] = useState<TeacherPortalDashboard | null>(null)
  const [lesson, setLesson] = useState<TeacherLesson | null>(null)
  const [selected, setSelected] = useState<TeacherPortalScheduleItem | null>(null)
  const [states, setStates] = useState<Record<string, StudentState>>({})
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [activeTab, setActiveTab] = useState<TeacherTab>('home')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sheets, setSheets] = useState<TeacherSheetSubject[]>([])
  const [sheetMode, setSheetMode] = useState<'menu' | 'setup' | 'start' | 'noorGuide' | 'noorMapping'>('menu')
  const [activeLessonDate, setActiveLessonDate] = useState(date)
  const [sheetOnlyView, setSheetOnlyView] = useState(false)
  const [selectedSheetType, setSelectedSheetType] = useState<TeacherSheetOpenType>('followup')
  const [selectedAssessmentPeriod, setSelectedAssessmentPeriod] = useState<TeacherAssessmentPeriod>('period1')
  const [printPreview, setPrintPreview] = useState('')
  const [reportsKey, setReportsKey] = useState(0)
  const [cooperationStatus, setCooperationStatus] = useState<TeacherCooperationStatus | null>(null)
  const [thanksClosed, setThanksClosed] = useState(false)

  const loadCooperationStatus = async () => {
    try {
      const next = await api.teacherCooperationStatus()
      setCooperationStatus(next)
      setThanksClosed(Boolean(localStorage.getItem(`teacher-cooperation-thanks:${account.schoolId}:${next.date}`)))
      if (!next.available) setActiveTab(current => current === 'cooperation' ? 'home' : current)
    } catch { /* لا نحجب بقية بوابة المعلم عند تعذر تحديث شريط التعاون */ }
  }

  const loadDashboard = async () => {
    setBusy('dashboard')
    setError('')
    try { setDashboard(await api.teacherDashboard(date)) } catch { setError('تعذر تحميل جدولك. اطلب من الإدارة التأكد من ربط حسابك بالجدول.') } finally { setBusy('') }
  }

  useEffect(() => { void loadDashboard() }, [date])
  useEffect(() => { void api.teacherSheets().then(result => setSheets(result.sheets)).catch(() => setSheets([])) }, [])
  useEffect(() => {
    void loadCooperationStatus()
    const refresh = window.setInterval(() => void loadCooperationStatus(), 15000)
    return () => window.clearInterval(refresh)
  }, [])
  useEffect(() => {
    if (!printPreview) return
    document.body.classList.add('teacher-print-mode')
    return () => document.body.classList.remove('teacher-print-mode')
  }, [printPreview])

  const openLesson = async (item: TeacherPortalScheduleItem, sheetType: TeacherSheetOpenType = 'followup', sheetOnly = false, targetTab?: TeacherTab, assessmentPeriod: TeacherAssessmentPeriod = 'period1') => {
    setBusy(`lesson-${item.assignmentId}`)
    setError('')
    const targetDate = dateForWeekday(date, item.weekday)
    try {
      const next = await api.teacherLesson(item.classroomId, targetDate, item.periodNumber, sheetType, assessmentPeriod)
      setLesson(next)
      setSelected(item)
      setActiveLessonDate(targetDate)
      setSelectedSheetType(sheetType)
      setSelectedAssessmentPeriod(next.assessmentPeriod)
      setSheetOnlyView(sheetOnly)
      setActiveTab(targetTab || (sheetOnly ? 'sheets' : 'home'))
      setSheetMode('menu')
      const booleanKeys = next.sheetConfigs.flatMap(config => config.columns.filter(column => column.type === 'boolean').map(column => `${config.sheetType}:${column.id}`))
      setStates(Object.fromEntries(next.students.map(student => {
        const sheetValues = { ...student.sheetValues }
        for (const key of booleanKeys) if (sheetValues[key] === undefined || sheetValues[key] === null || sheetValues[key] === '') sheetValues[key] = true
        return [student.id, { status: student.status, note: student.note, sheetValues }]
      })))
      if (!sheetOnly) window.setTimeout(() => document.getElementById('teacher-active-lesson')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    } catch {
      setError('تعذر فتح طلاب الفصل. اطلب من الإدارة مطابقة الصف والفصل مع بيانات الطلاب أولًا.')
    } finally { setBusy('') }
  }

  const updateStudent = (studentId: string, update: Partial<StudentState>) => {
    setStates(current => ({ ...current, [studentId]: { ...current[studentId], ...update } }))
  }

  const updateSheetValue = (studentId: string, columnId: string, value: string | number | boolean) => setStates(current => {
    const state = current[studentId] || { status: 'present' as const, note: '' as const, sheetValues: {} }
    return { ...current, [studentId]: { ...state, sheetValues: { ...state.sheetValues, [columnId]: value } } }
  })

  const exportSheet = () => {
    if (!lesson || !selected) return
    const columns = sheetOnlyView ? getSheetColumns(lesson) : []
    const rows = [sheetOnlyView
      ? ['رقم الهوية', 'الطالب', ...columns.map(column => westernDigits(column.label))]
      : ['رقم الهوية', 'الطالب', 'الحالة', 'الملاحظة'], ...lesson.students.map(student => {
      const state = states[student.id] || { status: 'present' as const, note: '', sheetValues: {} }
      return sheetOnlyView
        ? [westernDigits(student.id), student.name, ...columns.map(column => displaySheetValue(state.sheetValues[column.key]))]
        : [westernDigits(student.id), student.name, attendanceStatusLabel(state.status), state.note || '']
    })]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'الكشف')
    XLSX.writeFile(workbook, `كشف-${lesson.assignment.subject}-${assessmentPeriodLabel(lesson.assessmentPeriod)}-${activeLessonDate}.xlsx`)
  }

  const exportWeekSchedule = () => {
    if (!dashboard) return
    const periods = teacherSchedulePeriods(dashboard.weekSchedule, dashboard.periodNumbers || [])
    if (!periods.length) return
    const firstDate = dateForWeekday(date, teacherSchoolDays[0])
    const lastDate = dateForWeekday(date, teacherSchoolDays[teacherSchoolDays.length - 1])
    const rows: Array<Array<string>> = [
      ['الجدول الأسبوعي للمعلم'],
      [`المدرسة: ${dashboard.schoolName}`],
      [`المعلم: ${dashboard.teacher.name}`],
      [`الأسبوع: من ${formatHijriDate(firstDate)} إلى ${formatHijriDate(lastDate)}`],
      [],
      ['اليوم', ...periods.map(periodLabel)],
      ...teacherSchoolDays.map(weekday => [
        `${dayNames[weekday]}\n${formatHijriDate(dateForWeekday(date, weekday))}`,
        ...periods.map(period => dashboard.weekSchedule
          .filter(item => item.weekday === weekday && item.periodNumber === period)
          .map(item => `${item.classroom}${item.subject ? `\n${item.subject}` : ''}`)
          .join('\n')),
      ]),
    ]
    const worksheet = XLSX.utils.aoa_to_sheet(rows)
    worksheet['!merges'] = [0, 1, 2, 3].map(row => ({ s: { r: row, c: 0 }, e: { r: row, c: periods.length } }))
    worksheet['!cols'] = [{ wch: 24 }, ...periods.map(() => ({ wch: 21 }))]
    worksheet['!rows'] = [{ hpt: 28 }, { hpt: 21 }, { hpt: 21 }, { hpt: 23 }, { hpt: 8 }, { hpt: 25 }, ...teacherSchoolDays.map(() => ({ hpt: 48 }))]
    const workbook = XLSX.utils.book_new()
    workbook.Workbook = { Views: [{ RTL: true }] }
    XLSX.utils.book_append_sheet(workbook, worksheet, 'الجدول الأسبوعي')
    XLSX.writeFile(workbook, `جدول-${dashboard.teacher.name}-${firstDate}-${lastDate}.xlsx`)
  }

  const printWeekSchedule = () => {
    if (!dashboard) return
    const periods = teacherSchedulePeriods(dashboard.weekSchedule, dashboard.periodNumbers || [])
    if (!periods.length) return
    const firstDate = dateForWeekday(date, teacherSchoolDays[0])
    const lastDate = dateForWeekday(date, teacherSchoolDays[teacherSchoolDays.length - 1])
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
    const rows = teacherSchoolDays.map(weekday => `<tr><th><strong>${escape(dayNames[weekday])}</strong><small>${escape(formatHijriDate(dateForWeekday(date, weekday)))}</small></th>${periods.map(period => {
      const items = dashboard.weekSchedule.filter(item => item.weekday === weekday && item.periodNumber === period)
      return `<td>${items.length ? items.map(item => `<div class="teacher-week-print-lesson"><strong>${escape(item.classroom)}</strong><small>${escape(item.subject || 'بدون مادة')}</small></div>`).join('') : '<span class="teacher-week-print-empty">—</span>'}</td>`
    }).join('')}</tr>`).join('')
    setPrintPreview(`<section class="teacher-week-print"><header><span>بوابة المعلم</span><h1>الجدول الأسبوعي</h1><p>${escape(dashboard.schoolName)}</p></header><div class="teacher-week-print-meta"><div><span>اسم المعلم</span><strong>${escape(dashboard.teacher.name)}</strong></div><div><span>الفترة</span><strong>من ${escape(formatHijriDate(firstDate))} إلى ${escape(formatHijriDate(lastDate))}</strong></div></div><table><thead><tr><th>اليوم</th>${periods.map(period => `<th>${escape(periodLabel(period))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table><footer>تم استخراج الجدول من بوابة المعلم</footer></section>`)
  }

  const printSheet = () => {
    if (!lesson || !selected) return
    const columns = sheetOnlyView ? getSheetColumns(lesson) : []
    const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
    const rows = lesson.students.map(student => {
      const state = states[student.id] || { status: 'present' as const, note: '', sheetValues: {} }
      return sheetOnlyView ? `<tr><td dir="ltr">${escape(westernDigits(student.id))}</td><td>${escape(student.name)}</td>${columns.map(column => `<td>${escape(displaySheetValue(state.sheetValues[column.key]))}</td>`).join('')}</tr>` : `<tr><td dir="ltr">${escape(westernDigits(student.id))}</td><td>${escape(student.name)}</td><td>${attendanceStatusLabel(state.status)}</td><td>${escape(state.note || '')}</td>${columns.map(column => `<td>${escape(displaySheetValue(state.sheetValues[column.key]))}</td>`).join('')}</tr>`
    }).join('')
    setPrintPreview(`<h2>كشف ${escape(lesson.assignment.subject)} - ${escape(assessmentPeriodLabel(lesson.assessmentPeriod))} - ${escape(selected.classroom)}</h2><p>${escape(formatHijriDate(activeLessonDate))}</p><table><thead><tr><th>رقم الهوية</th><th>الطالب</th>${sheetOnlyView ? '' : '<th>الحالة</th><th>الملاحظة</th>'}${columns.map(column => `<th>${escape(westernDigits(column.label))}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`)
  }

  const saveLesson = async () => {
    if (!lesson || !selected) return
    setBusy('save')
    setNotice('')
    setError('')
    try {
      const result = await api.saveTeacherLesson({
        classroomId: selected.classroomId,
        date: activeLessonDate,
        periodNumber: selected.periodNumber,
        sheetType: selectedSheetType,
        assessmentPeriod: selectedAssessmentPeriod,
        students: lesson.students.map(student => ({ studentId: student.id, ...(states[student.id] || { status: 'present', note: '', sheetValues: {} }) })),
      })
      setNotice(sheetOnlyView ? `تم حفظ الكشف لـ ${result.saved} طالبًا.` : `تم حفظ متابعة ${result.saved} طالبًا. يُسجّل الحاضر بلا ملاحظة كمشارك فعال.`)
    } catch { setError('تعذر حفظ المتابعة. تحقق من اتصالك ثم أعد المحاولة.') } finally { setBusy('') }
  }

  const savePassword = async () => {
    if (password.length < 8 || password !== passwordConfirm) { setError('اكتب كلمة مرور من 8 أحرف على الأقل، وتأكد من تطابقها.'); return }
    setBusy('password')
    setError('')
    setNotice('')
    try {
      await api.changeTeacherPassword(password)
      setPassword('')
      setPasswordConfirm('')
      setNotice('تم حفظ كلمة المرور الجديدة.')
    } catch { setError('تعذر تغيير كلمة المرور.') } finally { setBusy('') }
  }


  const navigate = (tab: TeacherTab) => { setActiveTab(tab); setMobileNavOpen(false); setLesson(null); setSelected(null); setNotice(''); setError(''); if (tab === 'reports') setReportsKey(current => current + 1) }
  return <main className="teacher-portal" dir="rtl">
    <button type="button" className="teacher-mobile-nav-button" onClick={() => setMobileNavOpen(true)} aria-label="فتح قائمة بوابة المعلم"><Menu size={20} /></button>
    <aside className={`teacher-sidebar ${mobileNavOpen ? 'open' : ''}`}>
      <div className="teacher-sidebar-brand"><BookOpenCheck size={24} /><div><strong>بوابة المعلم</strong><small>{dashboard?.teacher.name || account.displayName}</small></div><button type="button" className="teacher-sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="إغلاق القائمة"><X size={19} /></button></div>
      <nav className="teacher-sidebar-nav" aria-label="أقسام بوابة المعلم">
        <button type="button" className={activeTab === 'home' ? 'active' : ''} onClick={() => navigate('home')}><LayoutDashboard size={18} /> الرئيسية</button>
        <button type="button" className={activeTab === 'schedule' ? 'active' : ''} onClick={() => navigate('schedule')}><CalendarDays size={18} /> جدولي</button>
        {cooperationStatus?.available && <button type="button" className={`teacher-cooperation-nav ${activeTab === 'cooperation' ? 'active' : ''}`} onClick={() => navigate('cooperation')}><Handshake size={18} /> تعاون المعلم<span>متاح الآن</span></button>}
        <button type="button" className={activeTab === 'referrals' ? 'active' : ''} onClick={() => navigate('referrals')}><Send size={18} /> إحالة طالب</button>
        <button type="button" className={activeTab === 'sheets' ? 'active' : ''} onClick={() => navigate('sheets')}><FileSpreadsheet size={18} /> الكشوف</button>
        <button type="button" className={activeTab === 'portfolio' ? 'active' : ''} onClick={() => navigate('portfolio')}><FolderOpen size={18} /> ملف الإنجاز</button>
        <button type="button" className={activeTab === 'reports' ? 'active' : ''} onClick={() => navigate('reports')}><BarChart3 size={18} /> التقارير</button>
        <button type="button" className={activeTab === 'password' ? 'active' : ''} onClick={() => navigate('password')}><KeyRound size={18} /> كلمة المرور</button>
      </nav>
      <button type="button" className="teacher-sidebar-logout" onClick={onLogout}><LogOut size={18} /> تسجيل الخروج</button>
    </aside>
    {mobileNavOpen && <button type="button" className="teacher-sidebar-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="إغلاق القائمة" />}
    <div className="teacher-workspace">
    <header className="teacher-topbar">
      <div><span>بوابة المعلم</span><h1>{dashboard?.schoolName || 'نظام الحصر'}</h1></div>
    </header>
    {!!cooperationStatus?.contributors.length && !thanksClosed && <section className="teacher-thanks-banner" aria-label="شكر المعلمين المتعاونين"><button type="button" onClick={() => { localStorage.setItem(`teacher-cooperation-thanks:${account.schoolId}:${cooperationStatus.date}`, '1'); setThanksClosed(true) }} aria-label="إغلاق شريط الشكر"><X size={17} /></button><Handshake size={19} /><div className="teacher-thanks-window"><div className="teacher-thanks-track"><strong>شكر وتقدير للمعلمين المتعاونين مع الإدارة اليوم:</strong>{cooperationStatus.contributors.map(item => <span key={item.teacherId}>الأستاذ {item.name}</span>)}<b>تعاونكم يدل على وعيكم ويسهم في انضباط طلاب المدرسة</b></div></div></section>}
    <section className="teacher-welcome">
      <div><UserRound size={27} /><div><strong>{dashboard?.teacher.name || account.displayName}</strong><small>يعرض هذا الحساب جدولك وطلاب فصولك فقط.</small></div></div>
      {activeTab === 'cooperation' ? <div className="teacher-cooperation-date"><span>تعاون اليوم</span><strong>{formatHijriDate(cooperationStatus?.date || today())}</strong></div> : <HijriDatePicker label="التاريخ الهجري" value={date} max={today()} onChange={value => { setDate(value); setLesson(null); setSelected(null) }} />}
    </section>

    {activeTab === 'password' && <section className="teacher-security-card">
      <div><KeyRound size={22} /><div><h2>تغيير كلمة المرور</h2></div></div>
      <div className="teacher-password-form"><input type="password" placeholder="كلمة المرور الجديدة" value={password} onChange={event => setPassword(event.target.value)} /><input type="password" placeholder="تأكيد كلمة المرور" value={passwordConfirm} onChange={event => setPasswordConfirm(event.target.value)} /><button onClick={() => void savePassword()} disabled={busy === 'password'}>حفظ كلمة المرور</button></div>
    </section>}

    {notice && <div className="teacher-notice success">{notice}</div>}
    {error && <div className="teacher-notice error">{error}</div>}

    {activeTab === 'home' && <>
    <section className="teacher-card">
      <div className="teacher-section-head"><div><span>جدول اليوم</span><h2>{dayNames[dashboard?.weekday || 0]} · {formatHijriDate(date)}</h2></div><BookOpenCheck size={26} /></div>
      {busy === 'dashboard' ? <p className="teacher-empty">جارٍ تحميل الجدول…</p> : !dashboard?.schedule.length ? <p className="teacher-empty">لا توجد حصص مسندة لك في هذا اليوم.</p> : <div className="teacher-schedule-grid">
        {dashboard.schedule.map(item => <button key={item.assignmentId} className={`teacher-schedule-card ${selected?.assignmentId === item.assignmentId ? 'selected' : ''}`} onClick={() => void openLesson(item)}>
          <strong>{periodLabel(item.periodNumber)}</strong><span>{item.classroom}</span><small>{item.subject || 'بدون مادة محددة'}{item.startTime && item.endTime ? ` · ${item.startTime}–${item.endTime}` : ''}</small>
        </button>)}
      </div>}
    </section>

    {lesson && selected && <TeacherFollowupRoster lesson={lesson} selected={selected} activeLessonDate={activeLessonDate} states={states} updateStudent={updateStudent} exportSheet={exportSheet} printSheet={printSheet} saveLesson={() => void saveLesson()} busy={busy} />}
    </>}
    {activeTab === 'schedule' && <>
      <TeacherWeekSchedule date={date} schedule={dashboard?.weekSchedule || []} periodNumbers={dashboard?.periodNumbers || []} selected={selected} busy={busy} onOpen={item => void openLesson(item, 'followup', false, 'schedule')} onExportExcel={exportWeekSchedule} onPrintPdf={printWeekSchedule} />
      {lesson && selected && <TeacherFollowupRoster lesson={lesson} selected={selected} activeLessonDate={activeLessonDate} states={states} updateStudent={updateStudent} exportSheet={exportSheet} printSheet={printSheet} saveLesson={() => void saveLesson()} busy={busy} />}
    </>}
    {activeTab === 'cooperation' && cooperationStatus?.available && <TeacherCooperationPanel status={cooperationStatus} onRefresh={loadCooperationStatus} />}
    {activeTab === 'referrals' && <TeacherReferralCenter date={date} schedule={dashboard?.schedule || []} schoolName={dashboard?.schoolName || 'المدرسة'} teacherName={dashboard?.teacher.name || account.displayName} />}
    {activeTab === 'sheets' && <section className="teacher-card"><div className="teacher-section-head"><div><span>إدارة الكشوف</span><h2>الكشوف</h2><p>جهز كشف كل مادة مرة واحدة، أو ابدأ المتابعة مباشرة.</p></div><FileSpreadsheet size={30} /></div>
      {sheetMode === 'menu' && <div className="teacher-sheet-menu"><button type="button" onClick={() => { setLesson(null); setSelected(null); setSheetOnlyView(false); setSheetMode('setup') }}><FileSpreadsheet size={30} /><strong>إعداد الكشوف</strong><small>أنشئ الأعمدة والدرجات لكل مادة</small></button><button type="button" onClick={() => setSheetMode('start')}><BookOpenCheck size={30} /><strong>بدء المتابعة</strong><small>اختر المادة والفصل والكشف ثم افتح الطلاب</small></button><button type="button" className="teacher-noor-sheet-menu-button" onClick={() => { setLesson(null); setSelected(null); setSheetOnlyView(false); setSheetMode('noorGuide') }}><span className="teacher-experimental-badge">تجريبي</span><Copy size={30} /><strong>نسخ نموذج من نور</strong><small>ارفع لقطة نور وأنشئ أعمدة الدرجات</small></button><button type="button" onClick={() => { setLesson(null); setSelected(null); setSheetOnlyView(false); setSheetMode('noorMapping') }}><Copy size={30} /><strong>ربط كشف نور</strong><small>اجمع درجات الكشوف في أعمدة نور</small></button></div>}
      {sheetMode === 'setup' && <><button type="button" className="outline-button teacher-sheet-back" onClick={() => setSheetMode('menu')}>العودة إلى الكشوف</button><TeacherSheetsSetup sheets={sheets} onSaved={config => setSheets(current => current.map(subject => subject.subject === config.subject ? { ...subject, configs: [...subject.configs.filter(item => item.sheetType !== config.sheetType || item.assessmentPeriod !== config.assessmentPeriod), config] } : subject))} onDeleted={(subjectName, sheetType, assessmentPeriod) => setSheets(current => current.map(subject => subject.subject === subjectName ? { ...subject, configs: subject.configs.filter(config => config.sheetType !== sheetType || config.assessmentPeriod !== assessmentPeriod) } : subject))} /></>}
      {sheetMode === 'start' && <><button type="button" className="outline-button teacher-sheet-back" onClick={() => setSheetMode('menu')}>العودة إلى الكشوف</button><TeacherSheetStart sheets={sheets} schedule={dashboard?.weekSchedule || []} onOpen={(item, type, assessmentPeriod) => void openLesson(item, type, true, undefined, assessmentPeriod)} /></>}
      {sheetMode === 'noorGuide' && <TeacherNoorSheetGuide sheets={sheets} onBack={() => setSheetMode('menu')} onSaved={config => setSheets(current => current.map(subject => subject.subject === config.subject ? { ...subject, configs: [...subject.configs.filter(item => item.sheetType !== config.sheetType || item.assessmentPeriod !== config.assessmentPeriod), config] } : subject))} />}
      {sheetMode === 'noorMapping' && <TeacherNoorSheetMapping sheets={sheets} onBack={() => setSheetMode('menu')} onSaved={config => setSheets(current => current.map(subject => subject.subject === config.subject ? { ...subject, configs: [...subject.configs.filter(item => item.sheetType !== config.sheetType || item.assessmentPeriod !== config.assessmentPeriod), config] } : subject))} />}
      {sheetMode !== 'setup' && sheetMode !== 'noorGuide' && sheetMode !== 'noorMapping' && sheetOnlyView && lesson && selected && <TeacherSheetRoster lesson={lesson} selected={selected} states={states} updateSheetValue={updateSheetValue} exportSheet={exportSheet} printSheet={printSheet} saveLesson={saveLesson} busy={busy} noorCalculated={Boolean(lesson.noorCalculated)} />}
    </section>}
    {activeTab === 'portfolio' && <StudentPortfolioBoard scope="teacher" />}
    {activeTab === 'reports' && <TeacherReportsTab key={reportsKey} schedule={dashboard?.weekSchedule || []} schoolName={dashboard?.schoolName || 'المدرسة'} teacherName={dashboard?.teacher.name || account.displayName} />}
    {printPreview && <div className="teacher-print-overlay" role="dialog" aria-modal="true" aria-label="معاينة الطباعة"><div className="teacher-print-actions"><button type="button" className="outline-button" onClick={() => setPrintPreview('')}>إغلاق والعودة</button><button type="button" className="primary-button" onClick={() => window.print()}><Printer size={16} /> طباعة / حفظ PDF</button></div><div className="teacher-print-preview" dangerouslySetInnerHTML={{ __html: printPreview }} /></div>}
    </div>
  </main>
}
