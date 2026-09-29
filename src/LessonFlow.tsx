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
  type LessonSchedule,
  type LessonScheduleAssignment,
  type LessonTimeSlot,
} from './api'
import { downloadWorkbook, openPrintDocument } from './SchoolFeatures'

const jsQR = ((jsQRNs as unknown as { default?: unknown }).default || jsQRNs) as (data: Uint8ClampedArray, width: number, height: number) => { data: string } | null

type SectionKey = 'setup' | 'times' | 'codes' | 'schedules' | 'incidents'
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
  return `<h1>جدول فصل ${escapeHtml(schedule.classroom.name)}</h1><table><thead><tr><th>اليوم</th>${periods.map(period => `<th>الحصة ${period}</th>`).join('')}</tr></thead><tbody>${days.map(day => `<tr><th>${escapeHtml(weekdayLabel(day))}</th>${periods.map(period => {
    const cell = scheduleCell(schedule.assignments, day, period)
    return `<td>${cell ? `${escapeHtml(cell.teacherName || cell.rawTeacherName || 'غير مربوط')}<br/><small>${escapeHtml(cell.subjectName || '')}</small>` : '—'}</td>`
  }).join('')}</tr>`).join('')}</tbody></table>`
}

function incidentPrintHtml(incident: LessonIncident) {
  return `<section class="page"><h1>تنبيه عن تأخر / انصراف</h1>
    <table><tbody>
      <tr><th>المدرسة</th><td></td><th>السجل المدني</th><td dir="ltr">${escapeHtml(incident.identityNumber)}</td></tr>
      <tr><th>الاسم</th><td>${escapeHtml(incident.teacherName)}</td><th>الفصل</th><td>${escapeHtml(incident.classroom)}</td></tr>
      <tr><th>اليوم</th><td>${escapeHtml(weekdayLabel(incident.weekday))}</td><th>التاريخ</th><td>${escapeHtml(incident.incidentDate)}</td></tr>
    </tbody></table>
    <p style="margin-top:24px;line-height:2">نفيدكم بعدم تواجدكم أثناء الدوام من الساعة <strong dir="ltr">${escapeHtml(incident.startTime)}</strong> إلى الساعة <strong dir="ltr">${escapeHtml(incident.endTime)}</strong> في الحصة رقم <strong>${incident.periodNumber}</strong>${incident.subject ? ` لمقرر ${escapeHtml(incident.subject)}` : ''}.</p>
    <p style="margin-top:20px">عليه نأمل منكم توضيح أسباب ذلك في أقرب وقت.</p>
    <div style="margin-top:34px;display:grid;grid-template-columns:1fr 1fr;gap:28px"><p>قائد المدرسة: ........................</p><p>التوقيع: ........................</p></div>
    <hr style="margin:36px 0 24px" />
    <h2>إفادة المعلم</h2>
    <p style="min-height:120px;border-bottom:1px dotted #999;line-height:2"></p>
    <div style="margin-top:24px;display:grid;grid-template-columns:1fr 1fr;gap:28px"><p>الاسم: ........................</p><p>التوقيع: ........................</p></div>
  </section>`
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
  const [cameraOn, setCameraOn] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number | null>(null)

  const teacherOptions = overview?.teachers || []
  const timesForDay = useMemo(() => times.filter(slot => slot.weekday === activeDay).sort((a, b) => a.periodNumber - b.periodNumber), [times, activeDay])

  const loadOverview = async () => {
    const data = await api.lessonOverview()
    setOverview(data)
    if (data.times.length) setTimes(data.times)
    if (!selectedClassroomId && data.classrooms[0]) setSelectedClassroomId(data.classrooms[0].id)
  }

  const loadIncidents = async (date = incidentDate) => {
    const data = await api.lessonIncidents(date)
    setIncidents(data.incidents)
  }

  useEffect(() => {
    void loadOverview().catch(err => setError(err.message || 'تعذر تحميل سير الحصص.'))
    void loadIncidents().catch(() => undefined)
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
    try {
      const message = await task()
      setNotice(message)
      await loadOverview()
      await loadIncidents()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع.')
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
    openPrintDocument(`جدول فصل ${schedule.classroom.name}`, `<section class="page">${scheduleTableHtml(schedule)}</section>`, schoolName, 'landscape')
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
      setScanIncident(result.incident)
      setShowIncidents(true)
      return result.existing ? 'هذه المساءلة موجودة مسبقًا لهذه الحصة.' : 'تم إنشاء مسودة مساءلة للمعلم.'
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
      setError('تعذر فتح الكاميرا. استخدم زر رفع صورة للباركود.')
    }
  }

  function stopCamera() {
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    setCameraOn(false)
  }

  const scanImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      const context = canvas.getContext('2d')
      if (!context) return
      context.drawImage(image, 0, 0)
      const data = context.getImageData(0, 0, canvas.width, canvas.height)
      const result = jsQR(data.data, data.width, data.height)
      if (result?.data) void handleScanCode(result.data)
      else setError('لم أستطع قراءة الباركود من الصورة.')
      URL.revokeObjectURL(image.src)
    }
    image.src = URL.createObjectURL(file)
  }

  const confirmIncident = async (incident: LessonIncident) => {
    await run('confirm-incident', async () => {
      await api.confirmLessonIncident(incident.id)
      return 'تم اعتماد المساءلة.'
    })
  }

  const cancelIncident = async (incident: LessonIncident) => {
    if (!window.confirm('سيتم إلغاء هذه المساءلة ولن تبقى محتسبة كمساءلة مفتوحة.')) return
    await run('cancel-incident', async () => {
      await api.cancelLessonIncident(incident.id)
      return 'تم إلغاء المساءلة.'
    })
  }

  const printIncident = (incident: LessonIncident) => {
    openPrintDocument(`مساءلة ${incident.teacherName}`, incidentPrintHtml(incident), schoolName)
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
              <label className="secondary-button lesson-file-button"><Upload size={16} /> رفع صورة<input type="file" accept="image/*" capture="environment" onChange={scanImage} /></label>
            </div>
            {cameraOn && <div className="lesson-camera-preview"><video ref={videoRef} muted playsInline /><button type="button" onClick={stopCamera}>إيقاف الكاميرا</button></div>}
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
                  {incident.status !== 'cancelled' && <button type="button" className="secondary-button" onClick={() => void cancelIncident(incident)}><XCircle size={16} /> إلغاء</button>}
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
