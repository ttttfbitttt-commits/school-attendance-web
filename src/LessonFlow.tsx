import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import * as QRCode from 'qrcode'
import * as jsQRNs from 'jsqr'
import {
  AlertCircle,
  Camera,
  CheckCircle2,
  Clock3,
  Download,
  FileSpreadsheet,
  Link2,
  Printer,
  QrCode,
  Save,
  Search,
  Upload,
  XCircle,
} from 'lucide-react'
import {
  api,
  type LessonFlowOverview,
  type LessonIncident,
  type LessonScanPreview,
  type LessonSchedule,
  type LessonScheduleAssignment,
  type LessonTimeSlot,
  type TeacherDayAbsence,
} from './api'
import { downloadWorkbook, openOfficialFormDocument, openPrintDocument } from './SchoolFeatures'

const jsQR = ((jsQRNs as unknown as { default?: unknown }).default || jsQRNs) as (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null

type SectionKey = 'setup' | 'times' | 'codes' | 'schedules' | 'incidents'
type LessonActionPanel = 'teacher-absence' | 'waiting-teacher' | 'cancel-incident' | null
type TeacherImportRow = { name: string; identityNumber: string; phone?: string }
type ParsedSchedule = {
  sourceSchoolName: string
  classrooms: Array<{ name: string }>
  assignments: Array<{ classroomName: string; weekday: number; periodNumber: number; subjectName: string; rawTeacherName: string }>
  times: LessonTimeSlot[]
}

const weekdays = [
  { id: 1, label: 'الأحد' },
  { id: 2, label: 'الاثنين' },
  { id: 3, label: 'الثلاثاء' },
  { id: 4, label: 'الأربعاء' },
  { id: 5, label: 'الخميس' },
  { id: 6, label: 'الجمعة' },
  { id: 7, label: 'السبت' },
]

const sections: Array<{ key: SectionKey; label: string }> = [
  { key: 'setup', label: 'الاستيراد والربط' },
  { key: 'times', label: 'أوقات الحصص' },
  { key: 'codes', label: 'باركود الفصول' },
  { key: 'schedules', label: 'جداول الفصول' },
  { key: 'incidents', label: 'المساءلات' },
]

function todayRiyadh() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
}

function weekdayForDate(date: string) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day === 0 ? 1 : day + 1
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)
}

function normalizeArabicDigits(value: unknown) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
}

function compact(value: unknown) {
  return normalizeArabicDigits(value).replace(/\s+/g, ' ').trim()
}

function normalizeHeader(value: unknown) {
  return compact(value)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase()
}

function toNumber(value: unknown) {
  const number = Number(normalizeArabicDigits(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(number) ? number : 0
}

function rowsFromSheet(sheet: XLSX.WorkSheet) {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })
}

function objectRows(workbook: XLSX.WorkBook, sheetName: string) {
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  const rows = rowsFromSheet(sheet)
  const headers = (rows[0] || []).map(value => compact(value))
  return rows.slice(1).map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])))
}

function valueOf(row: Record<string, unknown>, names: string[]) {
  const wanted = names.map(normalizeHeader)
  const key = Object.keys(row).find(item => wanted.includes(normalizeHeader(item)))
  return key ? row[key] : ''
}

function findColumn(headerRow: unknown[], names: string[]) {
  const wanted = names.map(normalizeHeader)
  return headerRow.findIndex(value => wanted.some(name => normalizeHeader(value).includes(name)))
}

function formatTime(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const total = Math.round((value % 1) * 24 * 60)
    const hours = Math.floor(total / 60) % 24
    const minutes = total % 60
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }
  const text = compact(value)
  const match = /(\d{1,2})\s*[:٫]\s*(\d{1,2})/.exec(text)
  if (!match) return ''
  let hours = Number(match[1])
  const minutes = Number(match[2])
  const isPm = /م|pm/i.test(text)
  const isAm = /ص|am/i.test(text)
  if (isPm && hours < 12) hours += 12
  if (isAm && hours === 12) hours = 0
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return ''
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function fixedEndTime(startTime: string, endTime: string) {
  if (startTime && endTime && endTime <= startTime && startTime >= '10:00' && endTime.startsWith('00:')) {
    return `12:${endTime.slice(3)}`
  }
  return endTime
}

function addMinutes(time: string, minutes: number) {
  const [hours, mins] = time.split(':').map(Number)
  const total = Math.max(0, Math.min(23 * 60 + 59, hours * 60 + mins + minutes))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function defaultTimes() {
  const starts = ['07:00', '07:50', '08:40', '09:30', '10:20', '11:10', '12:00']
  return weekdays.slice(0, 5).flatMap(day => starts.map((startTime, index) => ({
    weekday: day.id,
    periodNumber: index + 1,
    startTime,
    endTime: addMinutes(startTime, 50),
  })))
}

function parseTeacherWorkbook(workbook: XLSX.WorkBook): TeacherImportRow[] {
  for (const sheetName of workbook.SheetNames) {
    const rows = rowsFromSheet(workbook.Sheets[sheetName])
    const headerIndex = rows.findIndex(row => findColumn(row, ['الاسم', 'اسم المعلم']) >= 0 && findColumn(row, ['رقم الهوية', 'السجل المدني', 'الهوية']) >= 0)
    if (headerIndex < 0) continue
    const header = rows[headerIndex]
    const nameColumn = findColumn(header, ['الاسم', 'اسم المعلم'])
    const identityColumn = findColumn(header, ['رقم الهوية', 'السجل المدني', 'الهوية'])
    const phoneColumn = findColumn(header, ['الجوال', 'رقم الجوال', 'الهاتف'])
    return rows.slice(headerIndex + 1).map(row => ({
      name: compact(row[nameColumn]),
      identityNumber: compact(row[identityColumn]).replace(/\D/g, ''),
      phone: phoneColumn >= 0 ? compact(row[phoneColumn]).replace(/\D/g, '') : '',
    })).filter(row => row.name && row.identityNumber.length >= 5)
  }
  throw new Error('لم أجد أعمدة الاسم ورقم الهوية في ملف بيانات المعلمين.')
}

function parseSmartSchedule(workbook: XLSX.WorkBook): ParsedSchedule {
  const required = ['Courses', 'Cells', 'Classrooms', 'ClassBase']
  const missing = required.filter(sheet => !workbook.Sheets[sheet])
  if (missing.length) throw new Error(`ملف الجدول الذكي لا يحتوي على الأوراق المطلوبة: ${missing.join(', ')}`)

  const classrooms = objectRows(workbook, 'Classrooms')
    .map(row => ({ name: compact(valueOf(row, ['name', 'classroom_name', 'full_name'])) }))
    .filter(row => row.name)

  const courses = new Map<string, { classroomName: string; subjectName: string; rawTeacherName: string }>()
  for (const row of objectRows(workbook, 'Courses')) {
    const id = compact(valueOf(row, ['row_id', 'id']))
    if (!id) continue
    courses.set(id, {
      classroomName: compact(valueOf(row, ['classroom_name', 'classroom', 'classroom_identify'])),
      subjectName: compact(valueOf(row, ['name', 'full_name', 'course_name'])),
      rawTeacherName: compact(valueOf(row, ['teacher_name', 'teacher', 'teacher_full_name'])),
    })
  }

  const classBaseRows = objectRows(workbook, 'ClassBase')
  const periodCount = Math.max(1, ...classBaseRows.map(row => toNumber(valueOf(row, ['order', 'period', 'period_number'])) + 1))
  const times = classBaseRows.map(row => {
    const weekday = Math.max(1, toNumber(valueOf(row, ['weekday', 'day'])))
    const periodNumber = toNumber(valueOf(row, ['order', 'period', 'period_number'])) + 1
    const startTime = formatTime(valueOf(row, ['start_time', 'starts_at', 'start']))
    const endTime = fixedEndTime(startTime, formatTime(valueOf(row, ['end_time', 'ends_at', 'end'])))
    return { weekday, periodNumber, startTime, endTime }
  }).filter(row => row.weekday >= 1 && row.weekday <= 7 && row.periodNumber >= 1 && row.startTime && row.endTime && row.endTime > row.startTime)

  const assignments = objectRows(workbook, 'Cells').map(row => {
    const courseId = compact(valueOf(row, ['course_row_id', 'course_id']))
    const course = courses.get(courseId)
    const cellNumber = toNumber(valueOf(row, ['cell_number', 'cell']))
    const activate = compact(valueOf(row, ['activate', 'active']))
    const classroomName = compact(valueOf(row, ['classroom_name', 'classroom'])) || course?.classroomName || ''
    const weekday = Math.floor(cellNumber / periodCount) + 1
    const periodNumber = (cellNumber % periodCount) + 1
    return {
      classroomName,
      weekday,
      periodNumber,
      subjectName: course?.subjectName || '',
      rawTeacherName: course?.rawTeacherName || '',
      active: !activate || activate === '1' || activate.toLowerCase() === 'true',
    }
  }).filter(row => row.active && row.classroomName && row.weekday >= 1 && row.weekday <= 7 && row.rawTeacherName)

  const sourceSchoolName = objectRows(workbook, '_META')
    .map(row => Object.values(row).map(compact).find(value => value && /مدرس|school/i.test(value)))
    .find(Boolean) || ''

  if (!classrooms.length || !assignments.length) throw new Error('لم أستطع استخراج الفصول أو الحصص من ملف الجدول الذكي.')
  return { sourceSchoolName, classrooms, assignments, times }
}

async function workbookFromFile(file: File) {
  const buffer = await file.arrayBuffer()
  return XLSX.read(buffer, { type: 'array', cellDates: false })
}

function weekdayLabel(id: number) {
  return weekdays.find(day => day.id === id)?.label || `اليوم ${id}`
}

function incidentStatus(status: LessonIncident['status']) {
  if (status === 'confirmed') return 'معتمدة'
  if (status === 'cancelled') return 'ملغاة'
  return 'مسودة'
}

function scheduleCell(assignments: LessonScheduleAssignment[], weekday: number, periodNumber: number) {
  return assignments.find(item => item.weekday === weekday && item.periodNumber === periodNumber)
}

function classroomPrintHeading(name: string) {
  const normalized = compact(name)
  const match = /^(.*?)[\s\-–—/]+([0-9٠-٩]+)$/.exec(normalized)
  return match ? `الصف: ${match[1].trim()} · الفصل: ${match[2]}` : `الصف والفصل: ${normalized}`
}

function scheduleExportRows(schedule: LessonSchedule) {
  return schedule.assignments.map(row => [
    weekdayLabel(row.weekday),
    row.periodNumber,
    row.teacherName || row.rawTeacherName || 'غير مربوط',
    row.identityNumber || '',
    row.subjectName || '',
    row.mappingStatus === 'unresolved' ? 'يحتاج ربط' : 'مربوط',
  ])
}

function scheduleTableHtml(schedule: LessonSchedule) {
  const periods = [...new Set(schedule.assignments.map(row => row.periodNumber))].sort((a, b) => a - b)
  const days = [...new Set(schedule.assignments.map(row => row.weekday))].sort((a, b) => a - b)
  const heading = classroomPrintHeading(schedule.classroom.name)
  return `<div style="margin:0 0 16px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#0c4277;font-size:16px;font-weight:800;text-align:center">${escapeHtml(heading)}</div><table><thead><tr><th>اليوم</th>${periods.map(period => `<th>الحصة ${period}</th>`).join('')}</tr></thead><tbody>${days.map(day => `<tr><th>${escapeHtml(weekdayLabel(day))}</th>${periods.map(period => {
    const cell = scheduleCell(schedule.assignments, day, period)
    return `<td>${cell ? `${escapeHtml(cell.teacherName || cell.rawTeacherName || 'غير مربوط')}<br/><small>${escapeHtml(cell.subjectName || '')}</small>` : '—'}</td>`
  }).join('')}</tr>`).join('')}</tbody></table>`
}

function incidentPrintHtml(incident: LessonIncident, schoolName: string) {
  const identityNumber = Array.from(String(incident.identityNumber || '').replace(/\s/g, ''))
  const civilIdCells = Array.from({ length: Math.max(10, identityNumber.length) }, (_, index) => `<span>${escapeHtml(identityNumber[index] || '')}</span>`).join('')
  const date = new Date(`${incident.incidentDate}T12:00:00+03:00`)
  const dateParts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Riyadh',
  }).formatToParts(date)
  const hijriPart = (type: string) => dateParts.find(part => part.type === type)?.value || ''
  const logoUrl = `${window.location.origin}/moe-logo.png`
  return `<main class="sheet">
    <header class="top">
      <div class="meta"><p>الرقم: ........................</p><p>التاريخ: .... / .... / ........</p><p>المشفوعات: ........................</p></div>
      <div class="ministry"><img src="${logoUrl}" alt="شعار وزارة التعليم"></div>
      <div class="state"><div class="country">المملكة العربية السعودية</div><div>وزارة التعليم</div><div class="school">مدرسة ${escapeHtml(schoolName)}</div></div>
    </header>
    <div class="form-code">نموذج رقم (18)<br><span class="code">رمز النموذج: (و.م.ع.ن - 02 - 02)</span></div>
    <h1 class="form-title">تنبيه عن تأخر / انصراف</h1>
    <table class="fields school-row"><tbody><tr><th>المدرسة</th><td>${escapeHtml(schoolName)}</td></tr></tbody></table>
    <table class="fields civil-row"><tbody><tr><th>السجل المدني</th><td><div class="civil-boxes">${civilIdCells}</div></td></tr></tbody></table>
    <table class="fields teacher-table"><thead><tr><th>الاسم</th><th>التخصص</th><th>المستوى / المرتبة</th><th>رقم الوظيفة</th><th>العمل الحالي</th></tr></thead><tbody><tr><td>${escapeHtml(incident.teacherName)}</td><td></td><td></td><td></td><td></td></tr></tbody></table>
    <div class="greeting"><p>المكرم المعلم: ${escapeHtml(incident.teacherName)} وفقه الله</p><p>السلام عليكم ورحمة الله وبركاته</p></div>
    <div class="case-intro"><span>إنه في يوم ${escapeHtml(weekdayLabel(incident.weekday))}</span><span class="date-line">الموافق ${escapeHtml(hijriPart('day'))} / ${escapeHtml(hijriPart('month'))} / ${escapeHtml(hijriPart('year'))}هـ، اتضح ما يلي:</span></div>
    <div class="options">
      <div class="option"><span class="box">&#9744;</span><span>تأخركم من بداية الدوام وحضوركم الساعة ( ................ )</span></div>
      <div class="option"><span class="box">&#9745;</span><span>عدم تواجدكم أثناء الدوام من الساعة ( <b dir="ltr">${escapeHtml(incident.startTime)}</b> ) إلى الساعة ( <b dir="ltr">${escapeHtml(incident.endTime)}</b> )</span></div>
      <div class="option"><span class="box">&#9744;</span><span>انصرافكم مبكراً قبل نهاية الدوام من الساعة ( .... : .... )</span></div>
    </div>
    <p class="request">عليه نأمل توضيح أسباب ذلك مع إرفاق ما يؤيد عذركم. ولكم تحياتي.</p>
    <div class="signatures"><div>قائد المدرسة: ........................</div><div>التوقيع: ........................</div><div>التاريخ: .... / .... / 14هـ</div></div>
    <hr class="divider">
    <h2 class="section-title">المكرم / قائد المدرسة</h2>
    <p class="reply">السلام عليكم ورحمة الله وبركاته</p>
    <p class="reply">أفيدكم أن أسباب ذلك ما يلي:</p>
    <div class="writing-lines"><div></div><div></div><div></div><div></div></div>
    <div class="reply-signatures"><div>الاسم: ........................</div><div>التوقيع: ........................</div><div>التاريخ: .... / .... / 14هـ</div></div>
    <hr class="divider">
    <h2 class="manager-title">رأي قائد المدرسة</h2>
    <div class="manager-options"><div><span class="box">&#9744;</span> عذره مقبول.</div><div><span class="box">&#9744;</span> عذره غير مقبول.</div><div><span class="box">&#9744;</span> ما تراه الإدارة أو إجراء آخر: ....................................................</div></div>
    <div class="manager-signature"><div>مدير المدرسة: ........................</div><div>التوقيع: ........................</div><div>التاريخ: .... / .... / 14هـ</div></div>
    <p class="footnote">ملاحظة: ترفق بطاقة المساءلة مع أصل القرار في حالة عدم قبول العذر لحفظها بملفه بالإدارة بالمدرسة، أصله لملفه بالمدرسة.</p>
    <footer class="source"><span>الدليل الإجرائي لمدارس التعليم العام للعام الدراسي 1436 - 1437 هـ - الإصدار الثالث</span></footer>
  </main>`
}

export function LessonFlowCenter({ schoolName }: { schoolName: string }) {
  const [overview, setOverview] = useState<LessonFlowOverview | null>(null)
  const [activeSection, setActiveSection] = useState<SectionKey>('setup')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [mappingChoices, setMappingChoices] = useState<Record<string, string>>({})
  const [times, setTimes] = useState<LessonTimeSlot[]>(defaultTimes())
  const [activeDay, setActiveDay] = useState(1)
  const [selectedClassroomId, setSelectedClassroomId] = useState('')
  const [schedule, setSchedule] = useState<LessonSchedule | null>(null)
  const [incidentDate, setIncidentDate] = useState(todayRiyadh())
  const [incidents, setIncidents] = useState<LessonIncident[]>([])
  const [showIncidents, setShowIncidents] = useState(false)
  const [scanIncident, setScanIncident] = useState<LessonIncident | null>(null)
  const [scanPreview, setScanPreview] = useState<LessonScanPreview | null>(null)
  const [openLessonActionPanel, setOpenLessonActionPanel] = useState<LessonActionPanel>(null)
  const [manualClassroomId, setManualClassroomId] = useState('')
  const [manualPeriodNumber, setManualPeriodNumber] = useState('')
  const [manualTeacherId, setManualTeacherId] = useState('')
  const [teacherSearch, setTeacherSearch] = useState('')
  const [manualObservationError, setManualObservationError] = useState('')
  const [teacherDayAbsences, setTeacherDayAbsences] = useState<TeacherDayAbsence[]>([])
  const [teacherAbsenceSearch, setTeacherAbsenceSearch] = useState('')
  const [selectedAbsentTeacherIds, setSelectedAbsentTeacherIds] = useState<Set<string>>(new Set())
  const [pendingAbsentTeacherIds, setPendingAbsentTeacherIds] = useState<string[] | null>(null)
  const [selectedCancellationId, setSelectedCancellationId] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)

  const teacherOptions = overview?.teachers || []
  const timesForDay = useMemo(() => times.filter(slot => slot.weekday === activeDay).sort((a, b) => a.periodNumber - b.periodNumber), [times, activeDay])
  const manualWeekday = useMemo(() => weekdayForDate(incidentDate), [incidentDate])
  const manualPeriods = useMemo(() => times.filter(slot => slot.weekday === manualWeekday).sort((a, b) => a.periodNumber - b.periodNumber), [times, manualWeekday])
  const manualTeachers = useMemo(() => {
    const query = compact(teacherSearch)
    if (!query) return teacherOptions
    return teacherOptions.filter(teacher => compact(`${teacher.name} ${teacher.identityNumber}`).includes(query))
  }, [teacherOptions, teacherSearch])
  const teacherAbsenceMatches = useMemo(() => {
    const query = compact(teacherAbsenceSearch)
    if (!query) return []
    const alreadyAbsent = new Set(teacherDayAbsences.map(item => item.teacherId))
    return teacherOptions.filter(teacher => !alreadyAbsent.has(teacher.id) && compact(`${teacher.name} ${teacher.identityNumber}`).includes(query)).slice(0, 8)
  }, [teacherOptions, teacherAbsenceSearch, teacherDayAbsences])
  const selectedAbsentTeachers = useMemo(() => teacherOptions.filter(teacher => selectedAbsentTeacherIds.has(teacher.id)), [teacherOptions, selectedAbsentTeacherIds])
  const pendingAbsentTeachers = useMemo(() => teacherOptions.filter(teacher => pendingAbsentTeacherIds?.includes(teacher.id)), [teacherOptions, pendingAbsentTeacherIds])
  const cancellableIncidents = useMemo(() => incidents.filter(incident => incident.status !== 'cancelled'), [incidents])

  const loadOverview = async () => {
    const data = await api.lessonOverview()
    setOverview(data)
    if (data.times.length) setTimes(data.times)
    if (!selectedClassroomId && data.classrooms[0]) setSelectedClassroomId(data.classrooms[0].id)
    if (!manualClassroomId && data.classrooms[0]) setManualClassroomId(data.classrooms[0].id)
  }

  const loadIncidents = async (date = incidentDate) => {
    const data = await api.lessonIncidents(date)
    setIncidents(data.incidents)
  }

  const loadTeacherDayAbsences = async () => {
    const data = await api.teacherDayAbsences()
    setTeacherDayAbsences(data.teachers)
  }

  useEffect(() => {
    void loadOverview().catch(err => setError(err.message || 'تعذر تحميل سير الحصص.'))
    void loadIncidents().catch(() => undefined)
    void loadTeacherDayAbsences().catch(() => undefined)
    return () => stopCamera()
  }, [])

  useEffect(() => {
    if (!selectedClassroomId) return
    api.lessonSchedule(selectedClassroomId).then(setSchedule).catch(() => setSchedule(null))
  }, [selectedClassroomId])

  const run = async (label: string, task: () => Promise<string>) => {
    setBusy(label)
    setError('')
    setNotice('')
    if (label === 'manual-incident') setManualObservationError('')
    try {
      const message = await task()
      setNotice(message)
      await loadOverview()
      await loadIncidents()
      await loadTeacherDayAbsences()
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      const apiError = err as Error & { data?: { classroomId?: string; periodNumber?: number; date?: string } }
      if (message === 'teacher_absent_today') {
        setManualObservationError('المعلم مسجل غائباً اليوم. اختر معلماً بديلاً أو أزله من سجل الغياب إذا كان قد حضر.')
        if (apiError.data?.classroomId) {
          setManualClassroomId(apiError.data.classroomId)
          setManualPeriodNumber(String(apiError.data.periodNumber || ''))
          setIncidentDate(apiError.data.date || todayRiyadh())
          setManualTeacherId('')
          setTeacherSearch('')
          setOpenLessonActionPanel('waiting-teacher')
        }
        return
      }
      const userMessage = message === 'scan_confirmation_expired'
        ? 'انتهت مهلة التأكيد. امسح باركود الفصل مرة أخرى.'
        : message === 'outside_lesson_time'
          ? 'لا يمكن رصد المساءلة الآن لأن الوقت الحالي خارج أوقات الحصص المحفوظة لهذا اليوم. راجع تبويب «أوقات الحصص»، أو استخدم «رصد المعلم المنتظر» لتحديد الحصة يدويًا.'
          : message
      setError(userMessage || 'حدث خطأ غير متوقع.')
    } finally {
      setBusy('')
    }
  }

  const importTeachers = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await run('teachers', async () => {
      const teachers = parseTeacherWorkbook(await workbookFromFile(file))
      const result = await api.importLessonTeachers(teachers)
      return `تم استيراد ${result.imported} معلم، وتم ربط ${result.exactResolved} خانة مطابقة تلقائيًا.`
    })
  }

  const importSchedule = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    await run('schedule', async () => {
      const parsed = parseSmartSchedule(await workbookFromFile(file))
      const result = await api.importLessonSchedule(parsed)
      return `تم استيراد ${result.importedClassrooms} فصل و ${result.importedAssignments} حصة. المتبقي للربط: ${result.importedAssignments - result.resolved}.`
    })
  }

  const saveMappings = async () => {
    const mappings = Object.entries(mappingChoices).filter(([, teacherId]) => teacherId).map(([rawName, teacherId]) => ({ rawName, teacherId }))
    if (!mappings.length) {
      setError('اختر معلمًا واحدًا على الأقل لحفظ الربط.')
      return
    }
    await run('mappings', async () => {
      const result = await api.saveLessonMappings(mappings)
      setMappingChoices({})
      return `تم حفظ الربط وتحديث ${result.updated} حصة.`
    })
  }

  const updateTime = (periodNumber: number, key: 'startTime' | 'endTime', value: string) => {
    setTimes(current => current.map(slot => slot.weekday === activeDay && slot.periodNumber === periodNumber ? { ...slot, [key]: value } : slot))
  }

  const addPeriod = () => {
    setTimes(current => {
      const daySlots = current.filter(slot => slot.weekday === activeDay)
      const last = daySlots.sort((a, b) => b.periodNumber - a.periodNumber)[0]
      const periodNumber = (last?.periodNumber || 0) + 1
      const startTime = last?.endTime || '07:00'
      return [...current, { weekday: activeDay, periodNumber, startTime, endTime: addMinutes(startTime, 50) }]
    })
  }

  const removePeriod = (periodNumber: number) => {
    setTimes(current => current.filter(slot => !(slot.weekday === activeDay && slot.periodNumber === periodNumber)))
  }

  const saveTimes = async () => {
    await run('times', async () => {
      const result = await api.saveLessonTimes(times)
      return `تم حفظ ${result.saved} توقيتًا للحصص.`
    })
  }

  const exportQrPdf = async () => {
    if (!overview?.classrooms.length) return
    setBusy('qr')
    try {
      const cards = await Promise.all(overview.classrooms.map(async classroom => {
        const image = await QRCode.toDataURL(`lesson:${classroom.qrToken}`, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
        return `<article style="display:inline-block;width:31%;min-width:170px;margin:1%;padding:14px;border:1px solid #d8e3ef;border-radius:10px;text-align:center;break-inside:avoid"><h2 style="margin:0 0 10px;font-size:18px">${escapeHtml(classroom.name)}</h2><img src="${image}" style="width:150px;height:150px" /><p style="font-size:12px;color:#64748b">رمز سير الحصص</p></article>`
      }))
      openPrintDocument('باركودات الفصول', `<section class="page">${cards.join('')}</section>`, schoolName)
    } finally {
      setBusy('')
    }
  }

  const exportSelectedScheduleExcel = () => {
    if (!schedule) return
    downloadWorkbook(`جدول_${schedule.classroom.name}`, [['اليوم', 'الحصة', 'المعلم', 'رقم الهوية', 'المادة', 'حالة الربط'], ...scheduleExportRows(schedule)], 'جدول الفصل', schoolName, `جدول فصل ${schedule.classroom.name}`)
  }

  const exportSelectedSchedulePdf = () => {
    if (!schedule) return
    openPrintDocument(`جدول ${classroomPrintHeading(schedule.classroom.name)}`, `<section class="page">${scheduleTableHtml(schedule)}</section>`, schoolName, 'landscape')
  }

  const exportAllSchedulesPdf = async () => {
    if (!overview?.classrooms.length) return
    await run('all-schedules-pdf', async () => {
      const schedules = await Promise.all(overview.classrooms.map(classroom => api.lessonSchedule(classroom.id).catch(() => null)))
      openPrintDocument('جداول الفصول', schedules.filter(Boolean).map(item => `<section class="page">${scheduleTableHtml(item as LessonSchedule)}</section>`).join(''), schoolName, 'landscape')
      return 'تم تجهيز ملف PDF لكل جداول الفصول.'
    })
  }

  const exportAllSchedulesExcel = async () => {
    if (!overview?.classrooms.length) return
    await run('all-schedules-excel', async () => {
      const workbook = XLSX.utils.book_new()
      for (const classroom of overview.classrooms) {
        const item = await api.lessonSchedule(classroom.id).catch(() => null)
        if (!item) continue
        const worksheet = XLSX.utils.aoa_to_sheet([['اليوم', 'الحصة', 'المعلم', 'رقم الهوية', 'المادة', 'حالة الربط'], ...scheduleExportRows(item)])
        XLSX.utils.book_append_sheet(workbook, worksheet, classroom.name.slice(0, 25) || 'فصل')
      }
      XLSX.writeFile(workbook, 'جداول_الفصول.xlsx')
      return 'تم تصدير جداول الفصول إلى Excel.'
    })
  }

  const handleScanCode = async (code: string) => {
    stopCamera()
    await run('scan', async () => {
      const result = await api.scanLessonClass(code)
      if (result.existing && result.incident) {
        setScanPreview(null)
        setScanIncident(result.incident)
        setShowIncidents(true)
        return 'هذه المساءلة موجودة مسبقًا لهذه الحصة.'
      }
      if (!result.preview) throw new Error('scan_preview_missing')
      setScanIncident(null)
      setScanPreview(result.preview)
      return 'تمت قراءة الباركود. راجع بيانات المعلم ثم أكد الرصد.'
    })
  }

  const confirmScanPreview = async () => {
    if (!scanPreview) return
    await run('confirm-camera-scan', async () => {
      const result = await api.confirmLessonScan(scanPreview.confirmationToken)
      setScanPreview(null)
      setScanIncident(result.incident)
      setShowIncidents(true)
      return result.existing ? 'هذه المساءلة موجودة مسبقًا لهذه الحصة.' : 'تمت إضافة مساءلة المعلم إلى السجل.'
    })
  }

  const scanFrame = () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) {
      frameRef.current = window.requestAnimationFrame(scanFrame)
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (context) {
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      const result = jsQR(image.data, image.width, image.height)
      if (result?.data) {
        void handleScanCode(result.data)
        return
      }
    }
    frameRef.current = window.requestAnimationFrame(scanFrame)
  }

  const startCamera = async () => {
    setError('')
    setScanPreview(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
      streamRef.current = stream
      setCameraOn(true)
      window.setTimeout(() => {
        if (!videoRef.current) return
        videoRef.current.srcObject = stream
        void videoRef.current.play()
        frameRef.current = window.requestAnimationFrame(scanFrame)
      }, 50)
    } catch {
      setError('تعذر فتح الكاميرا. اسمح للمتصفح باستخدامها ثم أعد المحاولة.')
    }
  }

  function stopCamera() {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraOn(false)
  }

  const createManualIncident = async () => {
    if (!manualClassroomId || !manualPeriodNumber || !manualTeacherId) {
      setError('اختر الفصل والحصة واسم المعلم أولاً.')
      return
    }
    await run('manual-incident', async () => {
      const result = await api.createManualLessonIncident({
        classroomId: manualClassroomId,
        periodNumber: Number(manualPeriodNumber),
        teacherId: manualTeacherId,
        incidentDate,
      })
      setScanIncident(result.incident)
      setShowIncidents(true)
      setOpenLessonActionPanel(null)
      return result.existing ? 'توجد مساءلة قائمة بالفعل لهذا الفصل والحصة والتاريخ.' : 'تم إنشاء مساءلة للمعلم المختار.'
    })
  }

  const toggleAbsentTeacherSelection = (teacherId: string) => setSelectedAbsentTeacherIds(current => {
    const next = new Set(current)
    if (next.has(teacherId)) next.delete(teacherId)
    else next.add(teacherId)
    return next
  })

  const reviewTeacherDayAbsences = () => {
    if (!selectedAbsentTeachers.length) {
      setError('ابحث واختر معلماً واحداً على الأقل.')
      return
    }
    setError('')
    setPendingAbsentTeacherIds(selectedAbsentTeachers.map(teacher => teacher.id))
  }

  const saveTeacherDayAbsences = async () => {
    if (!pendingAbsentTeacherIds?.length) return
    await run('teacher-day-absences', async () => {
      const result = await api.addTeacherDayAbsences(pendingAbsentTeacherIds)
      setPendingAbsentTeacherIds(null)
      setSelectedAbsentTeacherIds(new Set())
      setTeacherAbsenceSearch('')
      return result.added ? `تم تسجيل غياب ${result.added} معلم لهذا اليوم.` : 'المعلمون المحددون مسجلون غائبين لهذا اليوم مسبقاً.'
    })
  }

  const removeTeacherDayAbsence = async (teacher: TeacherDayAbsence) => {
    if (!window.confirm(`هل حضر ${teacher.name} وتريد إزالة تسجيل غيابه لهذا اليوم؟`)) return
    await run(`remove-day-absence-${teacher.teacherId}`, async () => {
      const result = await api.removeTeacherDayAbsence(teacher.teacherId)
      return result.removed ? `تمت إزالة ${teacher.name} من سجل الغياب لهذا اليوم.` : 'لم يعد هذا المعلم مسجلاً غائباً لهذا اليوم.'
    })
  }

  const openCancellation = async () => {
    setError('')
    try {
      await loadIncidents()
      setOpenLessonActionPanel('cancel-incident')
      setSelectedCancellationId('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل سجل المساءلات.')
    }
  }

  const deleteSelectedIncident = async () => {
    const incident = cancellableIncidents.find(item => item.id === selectedCancellationId)
    if (!incident) {
      setError('اختر مساءلة من السجل أولاً.')
      return
    }
    if (!window.confirm(`سيتم حذف مساءلة ${incident.teacherName} للفصل ${incident.classroom} والحصة ${incident.periodNumber}. لا يمكن التراجع عن هذا الإجراء.`)) return
    await run('delete-incident', async () => {
      await api.deleteLessonIncident(incident.id)
      setOpenLessonActionPanel(null)
      setSelectedCancellationId('')
      if (scanIncident?.id === incident.id) setScanIncident(null)
      return 'تم حذف المساءلة من السجل.'
    })
  }

  const confirmIncident = async (incident: LessonIncident) => {
    await run('confirm-incident', async () => {
      await api.confirmLessonIncident(incident.id)
      return 'تم اعتماد المساءلة.'
    })
  }

  const printIncident = (incident: LessonIncident) => {
    openOfficialFormDocument('تنبيه عن تأخر / انصراف', incidentPrintHtml(incident, schoolName))
  }

  const renderSection = () => {
    if (activeSection === 'setup') return (
      <section className="lesson-panel">
        <div className="lesson-import-grid">
          <label className="lesson-upload-card">
            <Upload size={22} />
            <strong>استيراد بيانات المعلمين</strong>
            <span>{overview?.summary.teachers || 0} معلم محفوظ</span>
            <input type="file" accept=".xlsx,.xls" onChange={importTeachers} />
          </label>
          <label className="lesson-upload-card">
            <FileSpreadsheet size={22} />
            <strong>استيراد جداول الفصول</strong>
            <span>{overview?.summary.assignments || 0} حصة في الجدول النشط</span>
            <input type="file" accept=".xlsx,.xls" onChange={importSchedule} />
          </label>
        </div>
        <div className="lesson-kpi-grid">
          <span><strong>{overview?.summary.classrooms || 0}</strong> فصل</span>
          <span><strong>{overview?.summary.unresolved || 0}</strong> يحتاج ربط</span>
          <span><strong>{overview?.summary.incidents.confirmed || 0}</strong> مساءلة معتمدة</span>
        </div>
        {!!overview?.unresolved.length && <div className="lesson-mapping-list">
          <div className="lesson-section-heading">
            <div><span className="panel-kicker">ربط الأسماء</span><h3>أسماء تحتاج اعتمادًا مرة واحدة</h3></div>
            <button className="primary-button" type="button" onClick={saveMappings} disabled={!!busy}><Save size={16} /> حفظ الربط</button>
          </div>
          {overview.unresolved.map(item => <article className="lesson-map-row" key={item.rawName}>
            <div>
              <strong>{item.rawName}</strong>
              <small>{item.occurrences} حصة · {item.candidates.length ? `أقرب اقتراح: ${item.candidates[0].name}` : 'لا يوجد اقتراح قريب'}</small>
            </div>
            <select value={mappingChoices[item.rawName] || ''} onChange={event => setMappingChoices(current => ({ ...current, [item.rawName]: event.target.value }))}>
              <option value="">اختر المعلم الصحيح</option>
              {teacherOptions.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name} · {teacher.identityNumber}</option>)}
            </select>
          </article>)}
        </div>}
        {!overview?.unresolved.length && <p className="lesson-empty"><CheckCircle2 size={18} /> لا توجد أسماء غير مربوطة في الجدول النشط.</p>}
      </section>
    )

    if (activeSection === 'times') return (
      <section className="lesson-panel">
        <div className="lesson-day-tabs">{weekdays.slice(0, 5).map(day => <button type="button" className={activeDay === day.id ? 'active' : ''} key={day.id} onClick={() => setActiveDay(day.id)}>{day.label}</button>)}</div>
        <div className="lesson-times-list">
          {timesForDay.map(slot => <article className="lesson-time-row" key={`${slot.weekday}-${slot.periodNumber}`}>
            <strong>الحصة {slot.periodNumber}</strong>
            <input type="time" value={slot.startTime} onChange={event => updateTime(slot.periodNumber, 'startTime', event.target.value)} />
            <input type="time" value={slot.endTime} onChange={event => updateTime(slot.periodNumber, 'endTime', event.target.value)} />
            <button type="button" className="icon-danger-button" onClick={() => removePeriod(slot.periodNumber)}><XCircle size={18} /></button>
          </article>)}
        </div>
        <div className="feature-actions">
          <button type="button" className="secondary-button" onClick={addPeriod}><Clock3 size={16} /> إضافة حصة</button>
          <button type="button" className="primary-button" onClick={saveTimes} disabled={!!busy}><Save size={16} /> حفظ أوقات الحصص</button>
        </div>
      </section>
    )

    if (activeSection === 'codes') return (
      <section className="lesson-panel">
        <div className="lesson-section-heading">
          <div><span className="panel-kicker">رموز الفصول</span><h3>{overview?.classrooms.length || 0} فصل جاهز للطباعة</h3></div>
          <button type="button" className="export-btn pdf" onClick={() => void exportQrPdf()} disabled={!overview?.classrooms.length || !!busy}><Printer size={16} /> PDF</button>
        </div>
        <div className="lesson-classroom-grid">{overview?.classrooms.map(classroom => <article key={classroom.id}><QrCode size={18} /><strong>{classroom.name}</strong></article>)}</div>
      </section>
    )

    if (activeSection === 'schedules') return (
      <section className="lesson-panel">
        <div className="lesson-toolbar">
          <select value={selectedClassroomId} onChange={event => setSelectedClassroomId(event.target.value)}>
            {overview?.classrooms.map(classroom => <option value={classroom.id} key={classroom.id}>{classroom.name}</option>)}
          </select>
          <button className="export-btn csv" type="button" onClick={exportSelectedScheduleExcel} disabled={!schedule}><Download size={16} /> Excel</button>
          <button className="export-btn pdf" type="button" onClick={exportSelectedSchedulePdf} disabled={!schedule}><Printer size={16} /> PDF</button>
          <button className="secondary-button" type="button" onClick={() => void exportAllSchedulesExcel()} disabled={!overview?.classrooms.length || !!busy}><Download size={16} /> كل الفصول Excel</button>
          <button className="secondary-button" type="button" onClick={() => void exportAllSchedulesPdf()} disabled={!overview?.classrooms.length || !!busy}><Printer size={16} /> كل الفصول PDF</button>
        </div>
        <div className="lesson-schedule-scroll">
          {schedule ? <table className="lesson-schedule-table">
            <thead><tr><th>اليوم</th>{[...new Set(schedule.assignments.map(item => item.periodNumber))].sort((a, b) => a - b).map(period => <th key={period}>الحصة {period}</th>)}</tr></thead>
            <tbody>{[...new Set(schedule.assignments.map(item => item.weekday))].sort((a, b) => a - b).map(day => <tr key={day}><th>{weekdayLabel(day)}</th>{[...new Set(schedule.assignments.map(item => item.periodNumber))].sort((a, b) => a - b).map(period => {
              const cell = scheduleCell(schedule.assignments, day, period)
              return <td key={period}>{cell ? <><strong>{cell.teacherName || cell.rawTeacherName || 'غير مربوط'}</strong><small>{cell.subjectName || '—'}{cell.mappingStatus === 'unresolved' ? ' · يحتاج ربط' : ''}</small></> : '—'}</td>
            })}</tr>)}</tbody>
          </table> : <p className="lesson-empty">اختر فصلًا لعرض جدوله.</p>}
        </div>
      </section>
    )

    return (
      <section className="lesson-panel">
        <div className="lesson-scan-grid">
          <div className="lesson-camera-card">
            <div><span className="panel-kicker">تصوير الباركود</span><h3>توجيه مساءلة حسب الحصة الحالية</h3></div>
            <div className="feature-actions">
              <button type="button" className="primary-button" onClick={() => void startCamera()} disabled={cameraOn || !!busy}><Camera size={16} /> فتح الكاميرا</button>
              <button type="button" className="secondary-button" onClick={() => { setOpenLessonActionPanel(current => current === 'teacher-absence' ? null : 'teacher-absence'); setPendingAbsentTeacherIds(null); setError('') }} disabled={!!busy}>تسجيل غياب معلم اليوم</button>
              <button type="button" className="secondary-button" onClick={() => { setOpenLessonActionPanel(current => current === 'waiting-teacher' ? null : 'waiting-teacher'); setManualObservationError('') }} disabled={!!busy}><Search size={16} /> رصد المعلم المنتظر</button>
              <button type="button" className="secondary-button" onClick={() => void openCancellation()} disabled={!!busy}><XCircle size={16} /> إلغاء مساءلة</button>
            </div>
            {openLessonActionPanel === 'teacher-absence' && <section className="lesson-manual-form teacher-day-absence-form">
              <div className="lesson-section-heading"><div><span className="panel-kicker">غياب اليوم</span><h3>تسجيل غياب المعلمين لهذا اليوم</h3><p>اختر معلماً أو أكثر. سيظهر تأكيد بالأسماء قبل الحفظ.</p></div><button type="button" className="icon-danger-button" onClick={() => { setOpenLessonActionPanel(null); setPendingAbsentTeacherIds(null) }} aria-label="إغلاق"><XCircle size={18} /></button></div>
              {!pendingAbsentTeacherIds && <>
                <label className="teacher-absence-search">ابحث باسم المعلم أو رقم هويته<input value={teacherAbsenceSearch} onChange={event => setTeacherAbsenceSearch(event.target.value)} placeholder="ابدأ بكتابة اسم المعلم..." /></label>
                {teacherAbsenceMatches.length > 0 && <div className="teacher-absence-suggestions">{teacherAbsenceMatches.map(teacher => <label key={teacher.id}><input type="checkbox" checked={selectedAbsentTeacherIds.has(teacher.id)} onChange={() => toggleAbsentTeacherSelection(teacher.id)} /><span>{teacher.name}<small>{teacher.identityNumber}</small></span></label>)}</div>}
                {teacherAbsenceSearch.trim() && !teacherAbsenceMatches.length && <p className="lesson-empty">لا توجد أسماء مطابقة غير مسجلة غائبة اليوم.</p>}
                {selectedAbsentTeachers.length > 0 && <p className="lesson-time-hint">المحددون: {selectedAbsentTeachers.map(teacher => teacher.name).join('، ')}</p>}
                <div className="feature-actions"><button type="button" className="primary-button" onClick={reviewTeacherDayAbsences} disabled={!selectedAbsentTeachers.length || !!busy}><CheckCircle2 size={16} /> مراجعة الأسماء</button></div>
              </>}
              {pendingAbsentTeacherIds && <div className="teacher-absence-confirm"><strong>تأكيد تسجيل الغياب طوال اليوم</strong><p>سيُمنع توجيه مساءلة للمعلمين التاليين عند مسح فصولهم، ويمكن إزالة أي اسم إذا حضر.</p><ul>{pendingAbsentTeachers.map(teacher => <li key={teacher.id}>{teacher.name} · {teacher.identityNumber}</li>)}</ul><div className="feature-actions"><button type="button" className="primary-button" onClick={() => void saveTeacherDayAbsences()} disabled={!!busy}>{busy === 'teacher-day-absences' ? 'جارٍ الحفظ…' : 'تأكيد تسجيل الغياب'}</button><button type="button" className="secondary-button" onClick={() => setPendingAbsentTeacherIds(null)} disabled={!!busy}>إلغاء</button></div></div>}
              {teacherDayAbsences.length > 0 && <div className="teacher-day-absence-list"><h4>المعلمون المسجلون غائبين اليوم · {teacherDayAbsences[0].date}</h4>{teacherDayAbsences.map(teacher => <div key={teacher.teacherId}><span><strong>{teacher.name}</strong><small>{teacher.identityNumber}</small></span><button type="button" className="outline-button" onClick={() => void removeTeacherDayAbsence(teacher)} disabled={!!busy}>حضر المعلم · إزالة من السجل</button></div>)}</div>}
            </section>}
            {openLessonActionPanel === 'waiting-teacher' && <section className="lesson-manual-form">
              <div className="lesson-section-heading">
                <div><span className="panel-kicker">رصد يدوي</span><h3>رصد المعلم المنتظر</h3><p>اختر المعلم المطلوب؛ وقت المساءلة يؤخذ من الحصة المختارة ولا يرتبط بوقت الإدخال.</p></div>
                <button type="button" className="icon-danger-button" onClick={() => setOpenLessonActionPanel(null)} aria-label="إغلاق"><XCircle size={18} /></button>
              </div>
              <div className="lesson-manual-fields">
                <label>التاريخ<input type="date" value={incidentDate} onChange={event => setIncidentDate(event.target.value)} /></label>
                <label>الفصل<select value={manualClassroomId} onChange={event => setManualClassroomId(event.target.value)}><option value="">اختر الفصل</option>{overview?.classrooms.map(classroom => <option key={classroom.id} value={classroom.id}>{classroom.name}</option>)}</select></label>
                <label>الحصة<select value={manualPeriodNumber} onChange={event => setManualPeriodNumber(event.target.value)}><option value="">اختر الحصة</option>{manualPeriods.map(slot => <option key={slot.periodNumber} value={slot.periodNumber}>الحصة {slot.periodNumber} · {slot.startTime} إلى {slot.endTime}</option>)}</select></label>
                <label>ابحث عن المعلم<input value={teacherSearch} onChange={event => { setTeacherSearch(event.target.value); setManualObservationError('') }} placeholder="الاسم أو رقم الهوية" /></label>
                <label>المعلم<select value={manualTeacherId} onChange={event => { setManualTeacherId(event.target.value); setManualObservationError('') }}><option value="">اختر المعلم</option>{manualTeachers.map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.name} · {teacher.identityNumber}</option>)}</select></label>
              </div>
              {manualObservationError && <p className="lesson-inline-error" role="alert">{manualObservationError}</p>}
              {manualPeriodNumber && <p className="lesson-time-hint">وقت المساءلة: {manualPeriods.find(slot => slot.periodNumber === Number(manualPeriodNumber))?.startTime || '—'} إلى {manualPeriods.find(slot => slot.periodNumber === Number(manualPeriodNumber))?.endTime || '—'}</p>}
              <div className="feature-actions"><button type="button" className="primary-button" onClick={() => void createManualIncident()} disabled={!!busy}><CheckCircle2 size={16} /> تأكيد الرصد وتوجيه المساءلة</button></div>
            </section>}
            {openLessonActionPanel === 'cancel-incident' && <section className="lesson-manual-form lesson-cancellation-form">
              <div className="lesson-section-heading">
                <div><span className="panel-kicker">حذف مساءلة</span><h3>إلغاء مساءلة معلم</h3><p>اختر السجل المطلوب حذفه من مساءلات تاريخ {incidentDate}.</p></div>
                <button type="button" className="icon-danger-button" onClick={() => setOpenLessonActionPanel(null)} aria-label="إغلاق"><XCircle size={18} /></button>
              </div>
              <label className="lesson-cancellation-select">المعلم المرصود<select value={selectedCancellationId} onChange={event => setSelectedCancellationId(event.target.value)}><option value="">اختر المساءلة</option>{cancellableIncidents.map(incident => <option key={incident.id} value={incident.id}>{incident.teacherName} · {incident.classroom} · الحصة {incident.periodNumber} · {incident.startTime} إلى {incident.endTime}</option>)}</select></label>
              {!cancellableIncidents.length && <p className="lesson-empty">لا توجد مساءلات قابلة للإلغاء في هذا التاريخ.</p>}
              <div className="feature-actions"><button type="button" className="danger-button" onClick={() => void deleteSelectedIncident()} disabled={!selectedCancellationId || !!busy}><XCircle size={16} /> تأكيد حذف المساءلة</button></div>
            </section>}
            {cameraOn && <div className="lesson-camera-preview"><video ref={videoRef} muted playsInline /><button type="button" onClick={stopCamera}>إيقاف الكاميرا</button></div>}
            {scanPreview && <article className="lesson-scan-preview">
              <div>
                <span className="panel-kicker">تمت قراءة الباركود</span>
                <h3>{scanPreview.teacherName}</h3>
                <p>راجع البيانات قبل إضافة المساءلة إلى السجل.</p>
              </div>
              <dl className="lesson-scan-preview-details">
                <div><dt>الفصل</dt><dd>{scanPreview.classroom}</dd></div>
                <div><dt>الحصة</dt><dd>{scanPreview.periodNumber}</dd></div>
                <div><dt>الوقت</dt><dd>{scanPreview.startTime} إلى {scanPreview.endTime}</dd></div>
                <div><dt>رقم الهوية</dt><dd>{scanPreview.identityNumber}</dd></div>
              </dl>
              <div className="feature-actions">
                <button type="button" className="primary-button" onClick={() => void confirmScanPreview()} disabled={!!busy}><CheckCircle2 size={16} /> تأكيد الرصد</button>
                <button type="button" className="secondary-button" onClick={() => setScanPreview(null)} disabled={!!busy}><XCircle size={16} /> إلغاء</button>
              </div>
            </article>}
            {scanIncident && <article className="lesson-incident-card highlighted">
              <strong>{scanIncident.teacherName}</strong>
              <small>{scanIncident.classroom} · الحصة {scanIncident.periodNumber} · {scanIncident.startTime} إلى {scanIncident.endTime}</small>
              <div className="feature-actions">
                <button type="button" className="primary-button" onClick={() => void confirmIncident(scanIncident)}><CheckCircle2 size={16} /> اعتماد</button>
                <button type="button" className="export-btn pdf" onClick={() => printIncident(scanIncident)}><Printer size={16} /> PDF</button>
              </div>
            </article>}
          </div>
          <div className="lesson-incidents-side">
            <div className="lesson-toolbar">
              <input type="date" value={incidentDate} onChange={event => setIncidentDate(event.target.value)} />
              <button className="secondary-button" type="button" onClick={() => void loadIncidents()}><Search size={16} /> عرض</button>
              <button className="secondary-button" type="button" onClick={() => setShowIncidents(value => !value)}>{showIncidents ? 'إخفاء السجل' : `عرض السجل (${incidents.length})`}</button>
            </div>
            {showIncidents && <div className="lesson-incidents-list">
              {incidents.map(incident => <article className="lesson-incident-card" key={incident.id}>
                <div><strong>{incident.teacherName}</strong><small>{incident.classroom} · {weekdayLabel(incident.weekday)} · الحصة {incident.periodNumber} · {incidentStatus(incident.status)}</small></div>
                <div className="feature-actions">
                  {incident.status === 'draft' && <button type="button" className="primary-button" onClick={() => void confirmIncident(incident)}><CheckCircle2 size={16} /> اعتماد</button>}
                  <button type="button" className="export-btn pdf" onClick={() => printIncident(incident)}><Printer size={16} /> PDF</button>
                </div>
              </article>)}
              {!incidents.length && <p className="lesson-empty">لا توجد مساءلات لهذا التاريخ.</p>}
            </div>}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="lesson-flow">
      <section className="panel lesson-hero-panel">
        <div>
          <span className="panel-kicker">سير الحصص</span>
          <h2>متابعة الفصول وتوجيه مساءلة المعلم حسب الجدول</h2>
          <p>الربط يتم عند الاستيراد ويُحفظ داخل جدول المدرسة، ثم يستخدم الباركود اسم المعلم ورقم هويته مباشرة.</p>
        </div>
        <Link2 size={34} />
      </section>

      <div className="lesson-section-tabs">
        {sections.map(section => <button type="button" key={section.key} className={activeSection === section.key ? 'active' : ''} onClick={() => setActiveSection(section.key)}>{section.label}</button>)}
      </div>

      {notice && <p className="lesson-alert success"><CheckCircle2 size={16} /> {notice}</p>}
      {error && <p className="lesson-alert error"><AlertCircle size={16} /> {error}</p>}
      {busy && <p className="lesson-alert pending">جاري التنفيذ...</p>}

      {renderSection()}
    </section>
  )
}
