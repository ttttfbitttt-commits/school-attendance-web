import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import * as QRCode from 'qrcode'
import * as jsQRNs from 'jsqr'
const jsQR = (jsQRNs as any).default || jsQRNs
import {
  BarChart3,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderOpen,
  GraduationCap,
  Layers,
  LayoutDashboard,
  Maximize2,
  Menu,
  Minimize2,
  Printer,
  QrCode,
  Save,
  Search,
  Settings,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Users,
  X,
  Zap,
  ZapOff,
} from 'lucide-react'
import './App.css'

type Student = {
  id: string
  name: string
  phone: string
  grade: string
  classroom: string
  sheet: string
  row: number
  qr?: string
}

type AttendanceStatus = 'present' | 'late' | 'absence'

type AttendanceRecord = {
  status: AttendanceStatus
  time: string
}

type AttendanceMode = 'late' | 'present' | 'auto'

type ScanRecord = {
  studentId: string
  day: string
  date: string
  time: string
  name: string
  grade: string
  classroom: string
  phone: string
  status: 'present' | 'late'
}

type CardsPerPage = 4 | 6 | 8

const QR_SCAN_INTERVAL_MS = 100
const QR_SCAN_MAX_DIMENSION = 360

const aliases = {
  id: ['رقم الطالب', 'الهوية', 'رقم الهوية', 'student id', 'id', 'الرقم'],
  name: ['اسم الطالب', 'الاسم', 'اسم', 'student name', 'name'],
  phone: ['الجوال', 'رقم الجوال', 'الهاتف', 'الجوال الرسمي', 'phone', 'mobile'],
  grade: ['رقم الصف', 'الصف', 'المرحلة', 'المستوى', 'grade'],
  classroom: ['الفصل', 'الشعبة', 'class', 'classroom'],
}

const ARABIC_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

const getTodayDateStr = () => {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const normalize = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const cleanKey = (value: unknown) => normalize(value).toLowerCase()


const findColumnIndex = (headers: unknown[], names: readonly string[]) => {
  return headers.findIndex((header) =>
    names.some((name) => cleanKey(header) === cleanKey(name))
  )
}

const findHeaderRow = (rows: unknown[][]) => {
  let best = { index: -1, score: 0 }

  rows.slice(0, 40).forEach((row, index) => {
    if (!Array.isArray(row)) return

    const rowValues = row.map(cleanKey)
    const score = Object.values(aliases).reduce((total, names) => {
      return total + (names.some((name) => rowValues.includes(cleanKey(name))) ? 1 : 0)
    }, 0)

    if (score > best.score) {
      best = { index, score }
    }
  })

  return best.score >= 2 ? best.index : -1
}

function App() {
  const [students, setStudents] = useState<Student[]>(() => {
    try {
      const saved = localStorage.getItem('school_students')
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [fileName, setFileName] = useState<string>(() => {
    return localStorage.getItem('school_file_name') || 'لم يتم رفع ملف بعد'
  })
  const [notice, setNotice] = useState('جاهز لإدارة الطلاب وحصر الحضور الذكي')
  const [search, setSearch] = useState('')
  const [attendanceSearch, setAttendanceSearch] = useState('')
  const [scanInput, setScanInput] = useState('')
  const [activeNav, setActiveNav] = useState<'dashboard' | 'students' | 'attendance' | 'reports'>('attendance')
  const [isImporting, setIsImporting] = useState(false)
  const [attendanceRecords, setAttendanceRecords] = useState<Record<string, AttendanceRecord>>({})
  const [showPrintableCards, setShowPrintableCards] = useState(false)
  const [cardsPerPage, setCardsPerPage] = useState<CardsPerPage>(6)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [printGradeFilter, setPrintGradeFilter] = useState('all')
  const [printClassFilter, setPrintClassFilter] = useState('all')
  const [gradeAliases, setGradeAliases] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('school_grade_aliases')
      return saved ? JSON.parse(saved) : {}
    } catch {
      return {}
    }
  })
  const [showGradeEditor, setShowGradeEditor] = useState(false)

  // نظام حصر الحضور بالكاميرا
  const [attendanceMode, setAttendanceMode] = useState<AttendanceMode>(() => {
    return (localStorage.getItem('school_attendance_mode') as AttendanceMode) || 'auto'
  })
  const [cutoffTime, setCutoffTime] = useState<string>(() => {
    return localStorage.getItem('school_cutoff_time') || '07:30'
  })
  const [cutoffDraft, setCutoffDraft] = useState<string>(() => {
    return localStorage.getItem('school_cutoff_time') || '07:30'
  })
  const [cutoffSavedNotice, setCutoffSavedNotice] = useState(false)
  const [isCameraActive, setIsCameraActive] = useState(false)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [lastScannedOverlay, setLastScannedOverlay] = useState<{
    student: Student
    status: 'present' | 'late'
    scanTime: string
  } | null>(null)

  const [scanLog, setScanLog] = useState<ScanRecord[]>(() => {
    try {
      const saved = localStorage.getItem(`school_attendance_log_${getTodayDateStr()}`)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })

  // مرجع لتخزين أحدث حالة من السجل لتجنب مشكلة الـ Stale Closure داخل حلقة الكاميرا
  const scanLogRef = useRef<ScanRecord[]>(scanLog)
  useEffect(() => {
    scanLogRef.current = scanLog
  }, [scanLog])

  // المراجع (Refs) للكاميرا والمسح
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scannerBoxRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number>(0)
  const lastScanAtRef = useRef(0)
  const scanContextRef = useRef<CanvasRenderingContext2D | null>(null)
  const cameraWrapperRef = useRef<HTMLDivElement>(null)
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScanThrottleRef = useRef<{ code: string; timestamp: number }>({ code: '', timestamp: 0 })

  // حفظ الطلاب واسم الملف دائماً في localStorage
  useEffect(() => {
    if (students.length > 0) {
      try {
        const stripped = students.map(({ qr, ...rest }) => rest)
        localStorage.setItem('school_students', JSON.stringify(stripped))
        localStorage.setItem('school_file_name', fileName)
      } catch (e) {
        console.warn('Failed to save students to localStorage', e)
      }
    }
  }, [students, fileName])



  // حفظ سجل الحضور اليومي
  useEffect(() => {
    try {
      localStorage.setItem(`school_attendance_log_${getTodayDateStr()}`, JSON.stringify(scanLog))
    } catch (e) {
      console.warn('Failed to save scan log', e)
    }
  }, [scanLog])

  // حفظ أسماء الصفوف المخصصة
  useEffect(() => {
    try {
      localStorage.setItem('school_grade_aliases', JSON.stringify(gradeAliases))
    } catch {}
  }, [gradeAliases])

  // حفظ وضع الحضور المختار
  useEffect(() => {
    try {
      localStorage.setItem('school_attendance_mode', attendanceMode)
    } catch {}
  }, [attendanceMode])

  // متابعة تغيير وضع ملء الشاشة عند الخروج بزر Esc
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullScreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFsChange)
    }
  }, [])

  useEffect(() => {
    if (!isCameraActive || !streamRef.current || !videoRef.current) return

    const video = videoRef.current
    const stream = streamRef.current
    let cancelled = false

    const attachStream = async () => {
      video.srcObject = stream
      video.setAttribute('playsinline', 'true')
      video.muted = true
      video.autoplay = true
      video.playsInline = true

      await waitForVideoMetadata(video)
      if (cancelled) return

      try {
        await video.play()
      } catch {
        // The stream remains attached; some browsers delay playback briefly.
      }

      if (!cancelled) {
        animFrameRef.current = requestAnimationFrame(scanTick)
      }
    }

    void attachStream()

    return () => {
      cancelled = true
    }
  }, [isCameraActive])

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return students

    return students.filter((student) =>
      [student.id, student.name, student.grade, student.classroom, student.phone]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }, [students, search])

  const filteredScanLog = useMemo(() => {
    const query = attendanceSearch.trim().toLowerCase()
    if (!query) return scanLog

    return scanLog.filter((record) =>
      [record.studentId, record.name, record.grade, record.classroom, record.phone]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }, [scanLog, attendanceSearch])

  const printableStudents = useMemo(() => students.filter((student) => Boolean(student.qr)), [students])

  const availableGrades = useMemo(() => {
    return Array.from(new Set(students.map((s) => s.grade).filter(Boolean))).sort()
  }, [students])

  const availableClassrooms = useMemo(() => {
    const pool = printGradeFilter === 'all'
      ? students
      : students.filter((s) => s.grade === printGradeFilter)
    return Array.from(new Set(pool.map((s) => s.classroom).filter(Boolean))).sort()
  }, [students, printGradeFilter])

  const filteredPrintableStudents = useMemo(() => {
    return students.filter((student) => {
      if (!student.qr) return false
      if (printGradeFilter !== 'all' && student.grade !== printGradeFilter) return false
      if (printClassFilter !== 'all' && student.classroom !== printClassFilter) return false
      return true
    })
  }, [students, printGradeFilter, printClassFilter])

  const samplePreviewStudents = useMemo(() => {
    return filteredPrintableStudents.slice(0, cardsPerPage)
  }, [filteredPrintableStudents, cardsPerPage])

  const estimatedPages = useMemo(() => {
    if (!filteredPrintableStudents.length) return 0
    return Math.ceil(filteredPrintableStudents.length / cardsPerPage)
  }, [filteredPrintableStudents, cardsPerPage])

  /** إرجاع اسم الصف المعدَّل إن وُجد، وإلا الاسم الأصلي من الملف */
  const gradeLabel = (grade: string) => gradeAliases[grade]?.trim() || grade

  const stats = useMemo(() => {
    const grades = new Set(students.map((student) => student.grade).filter(Boolean))
    // نستخدم "الصف|الفصل" مفتاحاً مركّباً حتى لا يُعدّ "فصل أ في الصف الأول"
    // و"فصل أ في الصف الثاني" كفصل واحد مكرر
    const classrooms = new Set(
      students
        .filter((s) => s.classroom)
        .map((s) => `${s.grade}|${s.classroom}`)
    )
    const qrReady = students.filter((student) => Boolean(student.qr)).length

    return {
      total: students.length,
      grades: grades.size,
      classrooms: classrooms.size,
      qrReady,
    }
  }, [students])

  const attendanceSummary = useMemo(() => {
    const summary = { present: 0, late: 0, absence: 0 }

    students.forEach((student) => {
      const record = attendanceRecords[student.id]
      if (!record) return
      summary[record.status] += 1
    })

    return summary
  }, [attendanceRecords, students])

  const importWorkbook = async (file: File) => {
    setIsImporting(true)
    setFileName(file.name)

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), {
        type: 'array',
        cellText: false,
        cellDates: false,
      })

      const imported: Student[] = []
      const warnings: string[] = []

      workbook.SheetNames.forEach((sheetName) => {
        const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
          header: 1,
          defval: '',
        })

        const headerRowIndex = findHeaderRow(rows)
        if (headerRowIndex < 0) {
          return
        }

        const headers = rows[headerRowIndex] ?? []
        const columns = {
          id: findColumnIndex(headers, aliases.id),
          name: findColumnIndex(headers, aliases.name),
          phone: findColumnIndex(headers, aliases.phone),
          grade: findColumnIndex(headers, aliases.grade),
          classroom: findColumnIndex(headers, aliases.classroom),
        }

        if (columns.id < 0 || columns.name < 0) {
          warnings.push(`تعذر التعرف على اسم الطالب أو رقم الطالب في ورقة ${sheetName}`)
          return
        }

        rows.slice(headerRowIndex + 1).forEach((row, index) => {
          if (!Array.isArray(row)) return

          const id = normalize(row[columns.id])
          const name = normalize(row[columns.name])

          if (!id && !name) return
          if (!id || !name) {
            warnings.push(`صف ناقص في ورقة ${sheetName} عند الصف ${headerRowIndex + index + 2}`)
            return
          }

          imported.push({
            id,
            name,
            phone: normalize(row[columns.phone]),
            grade: normalize(row[columns.grade]),
            classroom: normalize(row[columns.classroom]),
            sheet: sheetName,
            row: headerRowIndex + index + 2,
          })
        })
      })

      const uniqueStudents = Array.from(
        new Map(imported.map((student) => [student.id, student])).values()
      )

      const duplicateCount = imported.length - uniqueStudents.length
      setStudents(uniqueStudents)
      setAttendanceRecords({})
      setShowPrintableCards(false)
      setNotice(
        `تم استيراد ${uniqueStudents.length} طالبًا${duplicateCount ? `، وتم تجاهل ${duplicateCount} تكرارًا` : ''}${warnings.length ? `، مع ${warnings.length} تنبيهًا` : ''}`
      )
    } catch {
      setNotice('تعذر قراءة الملف. تأكد أنه ملف Excel صالح بصيغة XLS أو XLSX أو XLSM.')
    } finally {
      setIsImporting(false)
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      void importWorkbook(file)
    }
  }

  const generateQrCodes = async () => {
    if (!students.length) {
      setNotice('لا توجد بيانات طلاب لاستحداث الباركود لها')
      return
    }

    const nextStudents = await Promise.all(
      students.map(async (student) => ({
        ...student,
        qr:
          student.qr ??
          (await QRCode.toDataURL(student.id, {
            width: 220,
            margin: 1,
            color: {
              dark: '#102a43',
              light: '#ffffff',
            },
          })),
      }))
    )

    setStudents(nextStudents)
    setShowPrintableCards(false)
    setNotice(`تم تجهيز باركود ثابت لـ ${nextStudents.length} طالبًا. الرمز مرتبط برقم الطالب ولا يتغير.`)
  }

  // حفظ وقت الحضور المبكر
  const saveCutoffTime = () => {
    setCutoffTime(cutoffDraft)
    localStorage.setItem('school_cutoff_time', cutoffDraft)
    setCutoffSavedNotice(true)
    setTimeout(() => setCutoffSavedNotice(false), 2200)
    setNotice(`تم حفظ وقت الحضور المبكر: ${cutoffDraft}`)
  }

  // مولد الأصوات الفوري (Web Audio API)
  const playAudioBeep = (type: 'success' | 'duplicate' | 'not-found') => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) return
      const ctx = new AudioCtx()
      if (ctx.state === 'suspended') {
        void ctx.resume()
      }

      if (type === 'success') {
        // نغمة نجاح ناعمة وخفيفة (سواء حاضر أو متأخر)
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(1174, ctx.currentTime + 0.12)
        gain.gain.setValueAtTime(0.18, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.16)
      } else if (type === 'duplicate') {
        // صوت مختلف عند تكرار الطالب بدون إشعار
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(440, ctx.currentTime)
        osc.frequency.setValueAtTime(330, ctx.currentTime + 0.08)
        gain.gain.setValueAtTime(0.22, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.22)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.22)
      } else {
        // تنبيه خفيف عند عدم العثور على الباركود
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(240, ctx.currentTime)
        gain.gain.setValueAtTime(0.15, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.18)
      }
    } catch (e) {
      console.warn('Audio play error', e)
    }
  }

  const waitForVideoMetadata = (video: HTMLVideoElement) => {
    return new Promise<void>((resolve) => {
      const onReady = () => {
        video.removeEventListener('loadedmetadata', onReady)
        video.removeEventListener('canplay', onReady)
        resolve()
      }

      video.addEventListener('loadedmetadata', onReady, { once: true })
      video.addEventListener('canplay', onReady, { once: true })

      if (video.readyState >= 2) {
        resolve()
      }
    })
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice('المتصفح الحالي لا يدعم الوصول إلى الكاميرا. جرّب Chrome أو Edge.')
      return
    }

    const candidateConstraints: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      },
      {
        video: {
          facingMode: { ideal: 'user' },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      },
      {
        video: {
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ]

    let lastError: unknown = null
    let stream: MediaStream | null = null

    for (const constraints of candidateConstraints) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        if (stream.getVideoTracks().length > 0) {
          break
        }
      } catch (error) {
        lastError = error
      }
    }

    if (!stream || stream.getVideoTracks().length === 0) {
      const detail = lastError instanceof Error ? lastError.message : 'Unknown camera error'
      console.error('Camera error:', detail)
      setNotice('تعذر الوصول إلى الكاميرا. تأكد من منح الإذن في المتصفح، وإغلاق أي تطبيق يستخدم الكاميرا، ثم أعد المحاولة.')
      return
    }

    try {
      streamRef.current = stream
      setIsCameraActive(true)
      setNotice('تم تشغيل الكاميرا بنجاح. وجّه الكاميرا نحو باركود الطالب للحصر الفوري.')

      try {
        const track = stream.getVideoTracks()[0]
        const caps = track?.getCapabilities ? (track.getCapabilities() as Record<string, unknown>) : null
        setTorchSupported(Boolean(caps?.torch))
      } catch {
        setTorchSupported(false)
      }

    } catch (err) {
      console.error('Camera stream setup error:', err)
      setNotice('تمت محاولة تشغيل الكاميرا، لكن النظام لم يحصل على فيديو حقيقي من الجهاز. تأكد من إعدادات الكاميرا في المتصفح.')
      stopCamera()
    }
  }

  // إيقاف الكاميرا وإنهاء الحصر
  const stopCamera = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    scanContextRef.current = null
    lastScanAtRef.current = 0
    setIsCameraActive(false)
    setTorchOn(false)
    setNotice('تم إيقاف الكاميرا وإنهاء الحصر.')
  }

  // تشغيل وإطفاء الفلاش (اختياري إن كان مدعوماً)
  const toggleTorch = async () => {
    if (!streamRef.current) return
    const track = streamRef.current.getVideoTracks()[0]
    if (!track) return
    try {
      const nextTorch = !torchOn
      await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: nextTorch }],
      })
      setTorchOn(nextTorch)
    } catch (err) {
      console.warn('Torch toggle failed', err)
    }
  }

  // التبديل لملء الشاشة
  const toggleFullScreen = () => {
    const container = cameraWrapperRef.current
    if (!container) return

    if (!document.fullscreenElement) {
      container.requestFullscreen?.().catch(() => {})
    } else {
      document.exitFullscreen?.().catch(() => {})
    }
  }

  // حلقة فحص إطارات الكاميرا واستخراج QR
  const scanTick = () => {
    if (!streamRef.current || !videoRef.current) return

    const video = videoRef.current
    const canvas = canvasRef.current
    const scannerBox = scannerBoxRef.current
    const now = performance.now()

    if (
      now - lastScanAtRef.current >= QR_SCAN_INTERVAL_MS &&
      video.readyState >= video.HAVE_ENOUGH_DATA &&
      video.videoWidth > 0 &&
      video.videoHeight > 0 &&
      canvas &&
      scannerBox
    ) {
      lastScanAtRef.current = now
      const sourceWidth = video.videoWidth
      const sourceHeight = video.videoHeight
      const videoRect = video.getBoundingClientRect()
      const scannerRect = scannerBox.getBoundingClientRect()
      // Convert the visible scan box to camera pixels after accounting for object-fit: cover.
      const coverScale = Math.max(
        videoRect.width / sourceWidth,
        videoRect.height / sourceHeight,
      )
      const renderedWidth = sourceWidth * coverScale
      const renderedHeight = sourceHeight * coverScale
      const renderedOffsetX = (videoRect.width - renderedWidth) / 2
      const renderedOffsetY = (videoRect.height - renderedHeight) / 2
      const sourceLeft = (scannerRect.left - videoRect.left - renderedOffsetX) / coverScale
      const sourceTop = (scannerRect.top - videoRect.top - renderedOffsetY) / coverScale
      const sourceRight = sourceLeft + scannerRect.width / coverScale
      const sourceBottom = sourceTop + scannerRect.height / coverScale
      const regionX = Math.max(0, Math.floor(sourceLeft))
      const regionY = Math.max(0, Math.floor(sourceTop))
      const regionWidth = Math.min(sourceWidth, Math.ceil(sourceRight)) - regionX
      const regionHeight = Math.min(sourceHeight, Math.ceil(sourceBottom)) - regionY
      const scale = Math.min(
        1,
        QR_SCAN_MAX_DIMENSION / Math.max(regionWidth, regionHeight),
      )
      const scanWidth = Math.max(1, Math.round(regionWidth * scale))
      const scanHeight = Math.max(1, Math.round(regionHeight * scale))

      if (
        sourceWidth > 0 &&
        sourceHeight > 0 &&
        regionWidth > 0 &&
        regionHeight > 0 &&
        (canvas.width !== scanWidth || canvas.height !== scanHeight)
      ) {
        canvas.width = scanWidth
        canvas.height = scanHeight
        scanContextRef.current = canvas.getContext('2d', { willReadFrequently: true })
      }

      const ctx = scanContextRef.current
      if (ctx) {
        ctx.drawImage(
          video,
          regionX,
          regionY,
          regionWidth,
          regionHeight,
          0,
          0,
          scanWidth,
          scanHeight,
        )
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        })

        if (code && code.data) {
          handleScannedCode(code.data.trim())
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(scanTick)
  }

  // معالجة قراءة باركود الطالب
  const handleScannedCode = (rawCode: string) => {
    const code = rawCode.trim()
    if (!code) return

    // منع تكرار قراءة نفس الكود لنفس الطالب خلال ثانية واحدة عند استمرار الكاميرا أمامه
    const nowMs = Date.now()
    if (
      lastScanThrottleRef.current.code === code &&
      nowMs - lastScanThrottleRef.current.timestamp < 1200
    ) {
      return
    }
    lastScanThrottleRef.current = { code, timestamp: nowMs }

    const student = students.find(
      (s) => s.id === code || s.id.toLowerCase() === code.toLowerCase() || s.name === code
    )

    if (!student) {
      playAudioBeep('not-found')
      return
    }

    // التحقق هل تم تسجيله اليوم مسبقاً (نستخدم المرجع المحدث دائماً)
    const alreadyInLog = scanLogRef.current.some((rec) => rec.studentId === student.id)
    if (alreadyInLog) {
      // إصدار صوت مختلف فقط بدون أي إشعار يعطل العملية
      playAudioBeep('duplicate')
      return
    }

    // تحديد الحالة بحسب الوضع المختار
    let status: 'present' | 'late' = 'present'
    if (attendanceMode === 'late') {
      status = 'late'
    } else if (attendanceMode === 'present') {
      status = 'present'
    } else {
      // الوضع التلقائي: مقارنة الوقت الحالي بوقت الحضور المحدد
      const d = new Date()
      const currentHM = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      status = currentHM > cutoffTime ? 'late' : 'present'
    }

    // إصدار صوت خفيف لطيف
    playAudioBeep('success')

    const d = new Date()
    const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
    const todayDate = getTodayDateStr()
    const dayName = ARABIC_DAYS[d.getDay()]

    // إظهار اسم الطالب فوراً باللون الأحمر على شاشة الكاميرا لمدة ثانية أو استبداله بالجديد فوراً
    setLastScannedOverlay({
      student,
      status,
      scanTime: timeStr,
    })

    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current)
    overlayTimerRef.current = setTimeout(() => {
      setLastScannedOverlay(null)
    }, 1000)

    // إدراج الطالب فوراً في سجل الحضور
    const newRecord: ScanRecord = {
      studentId: student.id,
      day: dayName,
      date: todayDate,
      time: timeStr,
      name: student.name,
      grade: gradeLabel(student.grade),
      classroom: student.classroom,
      phone: student.phone,
      status,
    }

    setScanLog((prev) => [newRecord, ...prev])

    // تحديث سجلات الحضور
    setAttendanceRecords((prev) => ({
      ...prev,
      [student.id]: { status, time: timeStr },
    }))
  }

  // تفريغ سجل اليوم
  const clearTodayScanLog = () => {
    if (!scanLog.length) return
    if (window.confirm('هل أنت متأكد من تفريغ سجل الحضور لهذا اليوم؟')) {
      setScanLog([])
      setNotice('تم تفريغ سجل اليوم بنجاح.')
    }
  }

  // Export the same default daily report as the desktop report dialog.
  const exportAttendanceXlsx = () => {
    if (!students.length && !scanLog.length) {
      setNotice('لا توجد بيانات طلاب لتصديرها')
      return
    }
    const reportDate = getTodayDateStr()
    const reportDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date(`${reportDate}T12:00:00`))
    const attendanceByStudent = new Map<string, ScanRecord>()

    // The desktop app records one attendance row per student for the selected day.
    for (const record of scanLog) {
      if (record.date === reportDate && !attendanceByStudent.has(record.studentId)) {
        attendanceByStudent.set(record.studentId, record)
      }
    }

    const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
    const attendanceRows = [...attendanceByStudent.values()].sort(
      (a, b) =>
        compareText(a.grade, b.grade) ||
        compareText(a.classroom, b.classroom) ||
        compareText(a.name, b.name) ||
        compareText(a.time, b.time),
    )
    const attendedStudentIds = new Set(attendanceByStudent.keys())
    const absentRows = students
      .filter((student) => !attendedStudentIds.has(student.id))
      .sort(
        (a, b) =>
          compareText(gradeLabel(a.grade), gradeLabel(b.grade)) ||
          compareText(a.classroom, b.classroom) ||
          compareText(a.name, b.name),
      )

    const headers = ['اليوم', 'التاريخ', 'الوقت', 'اسم الطالب', 'الصف', 'الفصل', 'رقم الهاتف', 'الحالة']
    const rows = [
      ...attendanceRows.map((record) => [
        reportDay,
        reportDate,
        record.time,
        record.name,
        record.grade,
        record.classroom,
        record.phone,
        record.status === 'late' ? 'متأخر' : 'حاضر',
      ]),
      ...absentRows.map((student) => [
        reportDay,
        reportDate,
        '-',
        student.name,
        gradeLabel(student.grade),
        student.classroom,
        student.phone,
        'غائب',
      ]),
    ]

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1')
    XLSX.writeFile(workbook, `تقرير_الحضور_${reportDate}.xlsx`)
    setNotice('تم تصدير تقرير الحضور بصيغة Excel بنجاح.')
  }

  // تصدير سجل الحضور كـ PDF قابل للطباعة
  const exportScanLogPdf = () => {
    if (!scanLog.length) {
      setNotice('لا يوجد طلاب مسجلين في سجل اليوم لتصديره كـ PDF')
      return
    }

    const todayStr = getTodayDateStr()
    const dayName = ARABIC_DAYS[new Date().getDay()]
    const presentCount = scanLog.filter((s) => s.status === 'present').length
    const lateCount = scanLog.filter((s) => s.status === 'late').length

    const rowsHtml = scanLog
      .map(
        (r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${r.day} ${r.date}</td>
        <td style="font-weight: 700; direction: ltr;">${r.time}</td>
        <td>${r.studentId}</td>
        <td style="font-weight: 700; color: #0c4277;">${r.name}</td>
        <td>${r.grade}</td>
        <td>${r.classroom || '—'}</td>
        <td style="direction: ltr;">${r.phone || '—'}</td>
        <td>
          <span class="badge ${r.status}">
            ${r.status === 'present' ? '✓ حاضر' : '⏰ متأخر'}
          </span>
        </td>
      </tr>`
      )
      .join('')

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>سجل الحضور اليومي - ${todayStr}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Cairo', Arial, sans-serif; direction: rtl; margin: 0; padding: 16px; color: #0f172a; }
    .header { text-align: center; border-bottom: 2px solid #0c4277; padding-bottom: 12px; margin-bottom: 14px; }
    .header h1 { margin: 0; color: #0c4277; font-size: 22px; font-weight: 800; }
    .header p { margin: 4px 0 0; color: #475569; font-size: 13px; }
    .summary-pills { display: flex; justify-content: center; gap: 16px; margin-bottom: 16px; }
    .pill { padding: 6px 18px; border-radius: 999px; font-weight: 700; font-size: 13px; border: 1px solid #cbd5e1; }
    .pill.total { background: #f1f5f9; color: #0f172a; }
    .pill.present { background: #dcfce7; color: #166534; border-color: #bbf7d0; }
    .pill.late { background: #fef3c7; color: #92400e; border-color: #fde68a; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #0c4277; color: white; padding: 8px 6px; border: 1px solid #0c4277; font-weight: 700; }
    td { padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center; }
    tr:nth-child(even) { background: #f8fafc; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 6px; font-weight: 700; font-size: 11px; }
    .badge.present { background: #dcfce7; color: #166534; }
    .badge.late { background: #fef3c7; color: #92400e; }
  </style>
</head>
<body>
  <div class="header">
    <h1>سجل حصر الحضور والتأخر المدرسي</h1>
    <p>اليوم: ${dayName} | التاريخ: ${todayStr} | مدرسة الفزاري الثانوية | وقت الطباعة: ${new Intl.DateTimeFormat('ar-SA', { hour: '2-digit', minute: '2-digit' }).format(new Date())}</p>
  </div>
  <div class="summary-pills">
    <div class="pill total">إجمالي الطلاب المسجلين: ${scanLog.length}</div>
    <div class="pill present">الحضور: ${presentCount}</div>
    <div class="pill late">المتأخرون: ${lateCount}</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>م</th>
        <th>اليوم والتاريخ</th>
        <th>وقت الحضور</th>
        <th>رقم الطالب</th>
        <th>اسم الطالب</th>
        <th>الصف</th>
        <th>الفصل</th>
        <th>رقم الجوال</th>
        <th>الحالة</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); }, 400);
    };
  </script>
</body>
</html>`

    openBlobUrl(html)
    setNotice('تم فتح تقرير PDF للطباعة في تبويب جديد.')
  }

  const exportAttendanceCsv = () => {
    if (!students.length) {
      setNotice('لا توجد بيانات حتى الآن لتصدير التقرير')
      return
    }

    const rows = [
      ['رقم الطالب', 'اسم الطالب', 'الصف', 'الفصل', 'الحالة', 'الوقت'],
      ...students.map((student) => {
        const record = attendanceRecords[student.id] ?? { status: 'present', time: '-' }
        return [student.id, student.name, gradeLabel(student.grade), student.classroom, record.status, record.time]
      }),
    ]

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'تقرير_الحضور_اليومي.csv'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    setNotice('تم تصدير تقرير الحضور بصيغة CSV بنجاح.')
  }

  const buildPrintHtml = (students: typeof filteredPrintableStudents, cols: number, autoprint = false) => {
    const cardsHtml = students
      .map(
        (student) => `
      <article class="print-card">
        <div class="print-card-header">
          <span class="print-card-school">مدرسة الفزاري الثانوية</span>
          <span class="print-card-id">${student.id}</span>
        </div>
        <div class="print-card-body">
          <img src="${student.qr}" alt="QR ${student.name}" class="print-card-qr" />
          <div class="print-card-meta">
            <strong>${student.name}</strong>
            <span>${gradeLabel(student.grade) || '—'} | ${student.classroom || '—'}</span>
          </div>
        </div>
      </article>`
      )
      .join('')

    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <title>طباعة بطاقات الطلاب (${students.length} طالب)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    @page { size: A4 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Cairo', Arial, sans-serif;
      margin: 0; padding: 16px;
      background: #f8fafc; color: #1e293b; direction: rtl;
    }
    .no-print-bar {
      background: #1476c9; color: white;
      padding: 14px 20px; border-radius: 12px; margin-bottom: 20px;
      display: flex; align-items: center; justify-content: space-between;
      box-shadow: 0 4px 12px rgba(20,118,201,0.2);
    }
    .no-print-bar strong { font-size: 16px; }
    .no-print-bar button {
      background: #fff; color: #0c4277; border: none;
      padding: 10px 22px; font-family: inherit; font-size: 14px;
      font-weight: 700; border-radius: 8px; cursor: pointer;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }
    .no-print-bar button:hover { background: #f0f7ff; }
    .print-cards-grid { display: grid; gap: 12px; grid-template-columns: repeat(${cols}, 1fr); }
    .print-card {
      background: white; border: 1px solid #cbd5e1;
      border-radius: 12px; padding: 12px 10px;
      page-break-inside: avoid; break-inside: avoid; text-align: center;
    }
    .print-card-header {
      display: flex; justify-content: space-between;
      font-size: 11px; color: #64748b; margin-bottom: 8px;
    }
    .print-card-school { font-weight: 700; color: #0c4277; }
    .print-card-id { font-weight: 700; }
    .print-card-body { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .print-card-qr { width: 100px; height: 100px; }
    .print-card-meta strong { display: block; font-size: 13px; color: #0f172a; }
    .print-card-meta span { display: block; font-size: 11px; color: #64748b; margin-top: 2px; }
    @media print {
      body { background: white; padding: 0; }
      .no-print-bar { display: none !important; }
      .print-card { border: 1px solid #64748b !important; }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <div>
      <strong>مركز الطباعة – مدرسة الفزاري الثانوية</strong>
      <div style="font-size:12px;opacity:0.9;margin-top:2px;">عدد الطلاب: ${students.length} طالب | ${cols === 2 ? '4' : cols === 3 ? '6' : '8'} بطاقات بالورقة</div>
    </div>
    <button onclick="window.print()">إرسال لأمر الطباعة الآن 🖨️</button>
  </div>
  <div class="print-cards-grid">${cardsHtml}</div>
  ${autoprint ? `<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 600); });<\/script>` : ''}
</body>
</html>`
  }

  const getGridCols = () => cardsPerPage === 4 ? 2 : cardsPerPage === 8 ? 4 : 3

  const handlePrintCards = () => {
    if (!students.length) {
      setNotice('لا توجد بيانات طلاب للطباعة')
      return
    }

    if (!printableStudents.length) {
      setNotice('يجب أولاً توليد الباركودات، ثم يمكنك الطباعة.')
      return
    }

    setPrintGradeFilter('all')
    setPrintClassFilter('all')
    setShowPrintableCards(true)
    setNotice('تم فتح مركز الطباعة. حدد الصف أو الفصل وعدد البطاقات واضغط طباعة.')
  }

  /**
   * الطباعة المباشرة: تفتح Blob URL في تبويب جديد مع تشغيل الطباعة تلقائياً.
   * هذا أموثوقية من iframe لأنه يعمل في جميع البيئات بما فيها VS Code Simple Browser.
   */
  const triggerDirectPrint = () => {
    if (!filteredPrintableStudents.length) {
      setNotice('لا يوجد طلاب مطابقون للفلترة المحددة للطباعة.')
      return
    }
    openBlobUrl(buildPrintHtml(filteredPrintableStudents, getGridCols(), false))
    setNotice('✅ تم فتح صفحة البطاقات — اضغط زر "اضغط هنا للطباعة" في الشريط الأزرق العلوي.')
  }

  /**
   * فتح في تبويب مستقل بدون طباعة تلقائية — للمراجعة والطباعة اليدوية.
   */
  const openPrintInNewTab = () => {
    if (!filteredPrintableStudents.length) {
      setNotice('لا يوجد طلاب مطابقون للفلترة المحددة للطباعة.')
      return
    }
    openBlobUrl(buildPrintHtml(filteredPrintableStudents, getGridCols(), false))
    setNotice('تم فتح صفحة الطباعة في تبويب جديد. استخدم Ctrl+P أو زر الطباعة في الصفحة.')
  }

  /**
   * فتح التقرير على Blob URL حقيقي حتى لا يتحول تبويب about:blank إلى صفحة بيضاء عند تحديثه.
   */
  const openBlobUrl = (html: string) => {
    const printWindow = window.open('', '_blank')

    if (!printWindow) {
      setNotice('تعذر فتح تقرير PDF. اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.')
      return
    }

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    printWindow.location.href = url

    // إبقاء الرابط متاحًا أثناء المراجعة والطباعة أو تحديث التقرير.
    setTimeout(() => URL.revokeObjectURL(url), 600000)
  }

  return (
    <div className="app-shell" dir="rtl">
      {isMobileMenuOpen && (
        <div className="sidebar-backdrop" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      <aside className={`sidebar ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="brand">
            <span className="brand-mark">
              <GraduationCap size={24} />
            </span>
            <div>
              <strong>حصر</strong>
              <small>منصة المدارس</small>
            </div>
          </div>
          <button
            className="sidebar-close-btn"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="إغلاق القائمة"
          >
            <X size={20} />
          </button>
        </div>

        <div className="school-chip">
          <span className="school-avatar">ف</span>
          <div>
            <strong>مدرسة الفزاري الثانوية</strong>
            <small>حساب مدير المدرسة</small>
          </div>
          <span className="online-dot" />
        </div>

        <nav className="sidebar-nav">
          <button
            className={activeNav === 'dashboard' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setActiveNav('dashboard')
              setIsMobileMenuOpen(false)
            }}
          >
            <LayoutDashboard size={18} />
            <span>لوحة التحكم</span>
          </button>

          <button
            className={activeNav === 'students' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setActiveNav('students')
              setIsMobileMenuOpen(false)
            }}
          >
            <Users size={18} />
            <span>إدارة الطلاب</span>
            <span className="nav-count">{students.length}</span>
          </button>

          <button
            className={activeNav === 'attendance' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setActiveNav('attendance')
              setIsMobileMenuOpen(false)
            }}
          >
            <BarChart3 size={18} />
            <span>سجل الحضور</span>
          </button>

          <button
            className={activeNav === 'reports' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setActiveNav('reports')
              setIsMobileMenuOpen(false)
            }}
          >
            <FileSpreadsheet size={18} />
            <span>التقارير</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setIsMobileMenuOpen(false)}>
            <Settings size={18} />
            <span>إعدادات المدرسة</span>
          </button>

          <div className="help-box">
            <span>تحتاج مساعدة؟</span>
            <small>تواصل مع الدعم الفني</small>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title-section">
            <button
              className="mobile-menu-btn"
              onClick={() => setIsMobileMenuOpen(true)}
              aria-label="فتح القائمة"
            >
              <Menu size={22} />
            </button>
            <div>
              <span className="eyebrow">إدارة المدرسة / {activeNav === 'attendance' ? 'الحضور' : activeNav === 'reports' ? 'التقارير' : 'الطلاب'}</span>
              <h1>{activeNav === 'attendance' ? 'سجل الحضور' : activeNav === 'reports' ? 'التقارير' : 'إدارة الطلاب'}</h1>
            </div>
          </div>

          <div className="top-actions">
            <span className="date-label">{new Intl.DateTimeFormat('ar-SA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span>
            <button className="profile-button">
              <span className="profile-avatar">م</span>
              <span>
                <strong>مدير المدرسة</strong>
                <small>المدير العام</small>
              </span>
            </button>
          </div>
        </header>

        {activeNav === 'dashboard' || activeNav === 'students' ? (
          <>
            <section className="page-intro">
              <div>
                <h2>بيانات الطلاب</h2>
                <p>استورد ملف المدرسة لإدارة الطلاب وتوليد بطاقات QR ثابتة لكل طالب.</p>
              </div>

              <div className="secure-label">
                <CheckCircle2 size={16} />
                البيانات محفوظة بشكل آمن
              </div>
            </section>

            <section className="stats-grid">
              <div className="stat-card blue">
                <div className="stat-icon">
                  <Users size={22} />
                </div>
                <div>
                  <span>إجمالي الطلاب</span>
                  <strong>{stats.total}</strong>
                </div>
              </div>

              <div className="stat-card orange">
                <div className="stat-icon">
                  <FolderOpen size={22} />
                </div>
                <div>
                  <span>عدد الصفوف</span>
                  <strong>{stats.grades}</strong>
                </div>
              </div>

              <div className="stat-card green">
                <div className="stat-icon">
                  <Download size={22} />
                </div>
                <div>
                  <span>عدد الفصول</span>
                  <strong>{stats.classrooms}</strong>
                </div>
              </div>

              <div className="stat-card navy">
                <div className="stat-icon">
                  <QrCode size={22} />
                </div>
                <div>
                  <span>باركود جاهز</span>
                  <strong>{stats.qrReady}</strong>
                </div>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <span className="panel-kicker">استيراد البيانات</span>
                  <h3>ملف Excel للطلاب</h3>
                </div>

                <div className="panel-actions">
                  <label className="primary-button">
                    <Upload size={18} />
                    <span>{isImporting ? 'جاري الاستيراد...' : 'رفع ملف Excel'}</span>
                    <input type="file" accept=".xls,.xlsx,.xlsm" onChange={handleFileChange} disabled={isImporting} />
                  </label>

                  <button className="secondary-button" onClick={generateQrCodes} disabled={!students.length}>
                    <QrCode size={18} />
                    توليد باركود الطلاب
                  </button>

                  <button className="print-button" onClick={handlePrintCards} disabled={!students.length || !printableStudents.length}>
                    <Printer size={18} />
                    طباعة الباركودات
                  </button>
                </div>
              </div>

              <div className="notice-box">{notice}</div>

              {students.length > 0 && (
                <div className="grade-editor-wrapper">
                  <button
                    className="grade-editor-toggle"
                    onClick={() => setShowGradeEditor((v) => !v)}
                  >
                    <Settings size={15} />
                    <span>تخصيص أسماء الصفوف</span>
                    <span className="grade-editor-arrow">{showGradeEditor ? '▲' : '▼'}</span>
                  </button>

                  {showGradeEditor && (
                    <div className="grade-editor-grid">
                      {availableGrades.map((rawGrade) => (
                        <div key={rawGrade} className="grade-editor-row">
                          <span className="grade-editor-original">{rawGrade}</span>
                          <span className="grade-editor-arrow-icon">←</span>
                          <input
                            type="text"
                            className="grade-editor-input"
                            placeholder={`اسم بديل للصف "${rawGrade}"`}
                            value={gradeAliases[rawGrade] ?? ''}
                            onChange={(e) =>
                              setGradeAliases((prev) => ({
                                ...prev,
                                [rawGrade]: e.target.value,
                              }))
                            }
                          />
                          {gradeAliases[rawGrade] && (
                            <button
                              className="grade-editor-clear"
                              onClick={() =>
                                setGradeAliases((prev) => {
                                  const next = { ...prev }
                                  delete next[rawGrade]
                                  return next
                                })
                              }
                              title="مسح الاسم البديل"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="toolbar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ابحث باسم الطالب أو رقمه أو صفه..."
                  />
                </div>

                <div className="file-meta">
                  <span>اسم الملف:</span>
                  <strong>{fileName}</strong>
                </div>
              </div>
            </section>

            <section className="table-panel">
              <div className="table-heading">
                <div>
                  <span className="panel-kicker">قائمة الطلاب</span>
                  <h3>بيانات الطلاب المستوردة</h3>
                </div>
              </div>

              {filteredStudents.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>رقم الطالب</th>
                        <th>اسم الطالب</th>
                        <th>الصف</th>
                        <th>الفصل</th>
                        <th>الجوال</th>
                        <th>باركود</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredStudents.map((student) => (
                        <tr key={`${student.id}-${student.sheet}`}>
                          <td>{student.id}</td>
                          <td>{student.name}</td>
                          <td>{gradeLabel(student.grade) || '—'}</td>
                          <td>{student.classroom || '—'}</td>
                          <td>{student.phone || '—'}</td>
                          <td>
                            {student.qr ? (
                              <img src={student.qr} alt={`QR ${student.name}`} className="qr-thumb" />
                            ) : (
                              <span className="qr-empty">غير منشأ</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <FolderOpen size={28} />
                  </div>
                  <h4>لا توجد بيانات طلاب بعد</h4>
                  <p>قم برفع ملف Excel الخاص بالطلاب لبدء الاستيراد.</p>
                </div>
              )}
            </section>

            {showPrintableCards && (
              <div className="print-modal-overlay" onClick={() => setShowPrintableCards(false)}>
                <div className="print-modal-dialog" onClick={(e) => e.stopPropagation()}>
                  <header className="print-modal-header">
                    <div className="print-modal-heading">
                      <div className="print-modal-icon">
                        <Printer size={22} />
                      </div>
                      <div>
                        <h3>مركز طباعة بطاقات الطلاب</h3>
                        <p>تخصيص الفلاتر ومعاينة نموذج الورقة وإرسال أمر الطباعة</p>
                      </div>
                    </div>
                    <button
                      className="modal-close-btn"
                      onClick={() => setShowPrintableCards(false)}
                      aria-label="إغلاق النافذة"
                    >
                      <X size={20} />
                    </button>
                  </header>

                  <div className="print-modal-controls">
                    <div className="control-item">
                      <label>
                        <Filter size={15} />
                        <span>الصف:</span>
                      </label>
                      <select
                        value={printGradeFilter}
                        onChange={(e) => {
                          setPrintGradeFilter(e.target.value)
                          setPrintClassFilter('all')
                        }}
                      >
                        <option value="all">جميع الصفوف ({printableStudents.length} طالب)</option>
                        {availableGrades.map((grade) => (
                          <option key={grade} value={grade}>
                            {gradeLabel(grade)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="control-item">
                      <label>
                        <Layers size={15} />
                        <span>الفصل:</span>
                      </label>
                      <select
                        value={printClassFilter}
                        onChange={(e) => setPrintClassFilter(e.target.value)}
                        disabled={availableClassrooms.length === 0}
                      >
                        <option value="all">جميع الفصول</option>
                        {availableClassrooms.map((cls) => (
                          <option key={cls} value={cls}>
                            فصل {cls}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="control-item">
                      <label>
                        <FileText size={15} />
                        <span>البطاقات في كل صفحة:</span>
                      </label>
                      <select
                        value={cardsPerPage}
                        onChange={(event) => setCardsPerPage(Number(event.target.value) as CardsPerPage)}
                      >
                        <option value={4}>4 بطاقات (مقاس كبير وواضح)</option>
                        <option value={6}>6 بطاقات (المقاس القياسي الموصى به)</option>
                        <option value={8}>8 بطاقات (اقتصادي)</option>
                      </select>
                    </div>
                  </div>

                  <div className="print-modal-meta-bar">
                    <div className="meta-pill primary">
                      <span>الطلاب المشمولون:</span>
                      <strong>{filteredPrintableStudents.length} طالب</strong>
                    </div>
                    <div className="meta-pill">
                      <span>الصفحات المقدرة (A4):</span>
                      <strong>{estimatedPages} صفحة</strong>
                    </div>
                    <div className="meta-pill hint">
                      <Eye size={15} />
                      <span>معاينة واقعية لنموذج الورقة الأولى</span>
                    </div>
                  </div>

                  <div className="print-modal-preview-wrapper">
                    {filteredPrintableStudents.length > 0 ? (
                      <div className="a4-sheet-simulated">
                        <div className="sheet-label-badge">نموذج محاكاة لورقة A4 مطبوعة</div>
                        <div className={`print-cards-grid cards-per-page-${cardsPerPage}`}>
                          {samplePreviewStudents.map((student) => (
                            <article key={`preview-${student.id}`} className="print-card">
                              <div className="print-card-header">
                                <span className="print-card-school">مدرسة الفزاري الثانوية</span>
                                <span className="print-card-id">{student.id}</span>
                              </div>

                              <div className="print-card-body">
                                <img src={student.qr} alt={`QR ${student.name}`} className="print-card-qr" />
                                <div className="print-card-meta">
                                  <strong>{student.name}</strong>
                                  <span>{gradeLabel(student.grade) || '—'} | {student.classroom || '—'}</span>
                                </div>
                              </div>
                            </article>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="empty-preview">
                        <p>لا يوجد طلاب مطابقون للفلاتر المحددة حالياً.</p>
                      </div>
                    )}
                  </div>

                  <footer className="print-modal-footer">
                    <button className="secondary-button" onClick={() => setShowPrintableCards(false)}>
                      إغلاق
                    </button>
                    <button
                      className="secondary-button print-newtab-btn"
                      onClick={openPrintInNewTab}
                      disabled={!filteredPrintableStudents.length}
                    >
                      <ExternalLink size={16} />
                      <span>فتح في تبويب مستقل للطباعة</span>
                    </button>
                    <button
                      className="primary-button print-action-btn"
                      onClick={triggerDirectPrint}
                      disabled={!filteredPrintableStudents.length}
                    >
                      <Printer size={18} />
                      <span>بدء الطباعة الآن ({filteredPrintableStudents.length} بطاقة)</span>
                    </button>
                  </footer>
                </div>
              </div>
            )}
          </>
        ) : null}

        {activeNav === 'attendance' && (
          <section className="attendance-panel">
            {/* 1. الشريط العلوي للأوضاع الثلاثة والوقت الثابت */}
            <div className="attendance-control-panel">
              <div className="attendance-mode-header">
                <div>
                  <span className="panel-kicker">إدارة نمط التحضير</span>
                  <h3>اختر طريقة حصر الطلاب اليوم</h3>
                </div>
                <div className="school-date-tag">
                  <span>اليوم: <strong>{ARABIC_DAYS[new Date().getDay()]}</strong></span>
                  <span>•</span>
                  <span>التاريخ: <strong>{getTodayDateStr()}</strong></span>
                </div>
              </div>

              <div className="attendance-modes-row">
                <div className="modes-buttons-group">
                  <button
                    type="button"
                    className={`mode-selector-btn late ${attendanceMode === 'late' ? 'active' : ''}`}
                    onClick={() => setAttendanceMode('late')}
                  >
                    <Clock3 size={18} />
                    <span>حصر التأخر</span>
                  </button>

                  <button
                    type="button"
                    className={`mode-selector-btn present ${attendanceMode === 'present' ? 'active' : ''}`}
                    onClick={() => setAttendanceMode('present')}
                  >
                    <CheckCircle2 size={18} />
                    <span>تحضير الطلاب</span>
                  </button>

                  <button
                    type="button"
                    className={`mode-selector-btn auto ${attendanceMode === 'auto' ? 'active' : ''}`}
                    onClick={() => setAttendanceMode('auto')}
                  >
                    <Sparkles size={18} />
                    <span>التحضير التلقائي</span>
                  </button>
                </div>

                {/* ضبط وقت الحضور الثابت مع زر الحفظ */}
                <div className="cutoff-config-card">
                  <div className="cutoff-title">
                    <Clock3 size={15} />
                    <span>وقت نهاية الحضور المبكر:</span>
                  </div>
                  <div className="cutoff-form">
                    <input
                      type="time"
                      value={cutoffDraft}
                      onChange={(e) => setCutoffDraft(e.target.value)}
                      className="cutoff-time-field"
                    />
                    <button
                      type="button"
                      className="cutoff-save-button"
                      onClick={saveCutoffTime}
                      title="حفظ الوقت ثابتاً في النظام"
                    >
                      <Save size={15} />
                      <span>حفظ</span>
                    </button>
                    {cutoffSavedNotice && (
                      <span className="cutoff-success-pill animate-fade">
                        <Check size={13} /> تم الحفظ
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 2. شريط زر بدء / إيقاف الحصر والأدوات المساعدة */}
            <div className="camera-actions-bar">
              <div className="camera-main-trigger">
                {!isCameraActive ? (
                  <button
                    type="button"
                    className="camera-launch-btn start"
                    onClick={startCamera}
                  >
                    <Camera size={22} />
                    <span>بدء الحصر</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="camera-launch-btn stop"
                    onClick={stopCamera}
                  >
                    <Square size={20} fill="currentColor" />
                    <span>إيقاف الحصر</span>
                  </button>
                )}
              </div>

              <div className="camera-aux-tools">
                <button
                  type="button"
                  className="aux-tool-btn"
                  onClick={toggleFullScreen}
                  title="ملء الشاشة للتسهيل على الجوال"
                >
                  {isFullScreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                  <span>{isFullScreen ? 'تصغير' : 'ملء الشاشة'}</span>
                </button>

                {torchSupported && (
                  <button
                    type="button"
                    className={`aux-tool-btn ${torchOn ? 'active' : ''}`}
                    onClick={toggleTorch}
                    title="تشغيل أو إطفاء فلاش الكاميرا"
                  >
                    {torchOn ? <ZapOff size={17} /> : <Zap size={17} />}
                    <span>{torchOn ? 'إطفاء الفلاش' : 'تشغيل الفلاش'}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="notice-box">{notice}</div>

            {/* 3. شاشة الكاميرا والماسح الفوري */}
            <div
              ref={cameraWrapperRef}
              className={`camera-viewport-card ${isCameraActive ? 'is-live' : 'is-idle'} ${isFullScreen ? 'fullscreen' : ''}`}
            >
              {isCameraActive ? (
                <div className="camera-live-wrapper">
                  <video
                    ref={videoRef}
                    className="camera-stream-feed"
                    playsInline
                    muted
                    autoPlay
                  />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />

                  {/* إطار المسح والخط الليزري */}
                  <div className="camera-scanner-hud">
                    <div ref={scannerBoxRef} className="scanner-bracket-box">
                      <span className="bracket bracket-tr" />
                      <span className="bracket bracket-tl" />
                      <span className="bracket bracket-br" />
                      <span className="bracket bracket-bl" />
                      <div className="scanner-laser-beam" />
                    </div>
                    <span className="scanner-live-badge">الكاميرا تلتقط الباركود تلقائياً...</span>
                  </div>

                  {/* بطاقة الطالب الحمراء عند التعرف (ثانية واحدة أو تُستبدل فوراً) */}
                  {lastScannedOverlay && (
                    <div className="scanned-student-overlay-card animate-zoom-in">
                      <div className="overlay-red-header">
                        <CheckCircle2 size={16} />
                        <span>تمت القراءة والحصر</span>
                      </div>
                      <div className="overlay-student-name">
                        {lastScannedOverlay.student.name}
                      </div>
                      <div className="overlay-sub-details">
                        <span className="overlay-meta-item">
                          {gradeLabel(lastScannedOverlay.student.grade)} • {lastScannedOverlay.student.classroom || '—'}
                        </span>
                        <span className={`overlay-status-pill ${lastScannedOverlay.status}`}>
                          {lastScannedOverlay.status === 'present' ? '✓ حاضر' : '⏰ متأخر'}
                        </span>
                        <span className="overlay-time-tag">{lastScannedOverlay.scanTime}</span>
                      </div>
                    </div>
                  )}

                  {/* زر خروج عائم عند وضع ملء الشاشة */}
                  {isFullScreen && (
                    <button
                      type="button"
                      className="floating-exit-fs"
                      onClick={toggleFullScreen}
                    >
                      <Minimize2 size={16} />
                      <span>خروج من ملء الشاشة</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="camera-idle-wrapper">
                  <div className="idle-camera-icon">
                    <Camera size={44} />
                  </div>
                  <h4>شاشة الكاميرا في وضع الاستعداد</h4>
                  <p>
                    اضغط على زر <strong>(بدء الحصر)</strong> بالأعلى لتشغيل الكاميرا والبدء بمسح بطاقات الطلاب بسرعة وبدون توقف.
                  </p>
                  <button
                    type="button"
                    className="idle-trigger-btn"
                    onClick={startCamera}
                  >
                    <Camera size={18} />
                    <span>تشغيل الكاميرا الآن</span>
                  </button>
                </div>
              )}
            </div>

            {/* 4. العدادات الحية للإحصائيات السريعة */}
            <div className="live-attendance-counters">
              <div className="counter-box present">
                <span>الحضور اليوم</span>
                <strong>{scanLog.filter((s) => s.status === 'present').length}</strong>
              </div>
              <div className="counter-box late">
                <span>المتأخرون اليوم</span>
                <strong>{scanLog.filter((s) => s.status === 'late').length}</strong>
              </div>
              <div className="counter-box total">
                <span>إجمالي المسجلين</span>
                <strong>{scanLog.length}</strong>
              </div>
            </div>

            {/* 5. سجل الحضور اليومي والجدول */}
            <section className="scan-log-table-panel">
              <div className="scan-log-header">
                <div>
                  <span className="panel-kicker">سجل الطلاب المسجلين</span>
                  <h3>
                    سجل الحضور لليوم: {ARABIC_DAYS[new Date().getDay()]} ({getTodayDateStr()})
                  </h3>
                </div>

                <div className="scan-log-export-group">
                  <button
                    type="button"
                    className="export-btn csv"
                    onClick={exportAttendanceXlsx}
                    disabled={!students.length && !scanLog.length}
                    title="تصدير تقرير الحضور بصيغة Excel"
                  >
                    <Download size={16} />
                    <span>تصدير Excel</span>
                  </button>

                  <button
                    type="button"
                    className="export-btn pdf"
                    onClick={exportScanLogPdf}
                    disabled={!scanLog.length}
                    title="تصدير وطباعة السجل كملف PDF منظم"
                  >
                    <Printer size={16} />
                    <span>تصدير / طباعة PDF</span>
                  </button>

                  <button
                    type="button"
                    className="export-btn clear"
                    onClick={clearTodayScanLog}
                    disabled={!scanLog.length}
                    title="تفريغ سجل اليوم"
                  >
                    <Trash2 size={16} />
                    <span>تفريغ اليوم</span>
                  </button>
                </div>
              </div>

              <div className="scan-log-toolbar">
                <div className="search-box">
                  <Search size={16} />
                  <input
                    type="text"
                    value={attendanceSearch}
                    onChange={(event) => setAttendanceSearch(event.target.value)}
                    placeholder="ابحث في سجل اليوم باسم الطالب أو رقمه أو صفه..."
                  />
                </div>

                <div className="search-box manual-scan-box">
                  <Search size={16} />
                  <input
                    type="text"
                    value={scanInput}
                    onChange={(event) => setScanInput(event.target.value)}
                    placeholder="إدخال يدوي: اكتب رقم الطالب واضغط Enter"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleScannedCode(scanInput)
                        setScanInput('')
                      }
                    }}
                  />
                </div>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    if (scanInput.trim()) {
                      handleScannedCode(scanInput)
                      setScanInput('')
                    }
                  }}
                  disabled={!students.length}
                >
                  تسجيل يدوي
                </button>
              </div>

              {filteredScanLog.length > 0 ? (
                <div className="table-wrap">
                  <table className="scan-records-table">
                    <thead>
                      <tr>
                        <th style={{ width: '45px' }}>م</th>
                        <th>اليوم والتاريخ</th>
                        <th>وقت الحضور</th>
                        <th>رقم الطالب</th>
                        <th>اسم الطالب</th>
                        <th>الصف</th>
                        <th>الفصل</th>
                        <th>رقم الجوال</th>
                        <th>الحالة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredScanLog.map((record, index) => (
                        <tr key={`${record.studentId}-${record.time}-${index}`}>
                          <td>{index + 1}</td>
                          <td>
                            {record.day} {record.date}
                          </td>
                          <td className="log-time-cell">{record.time}</td>
                          <td className="log-id-cell">{record.studentId}</td>
                          <td className="log-name-cell">{record.name}</td>
                          <td>{record.grade}</td>
                          <td>{record.classroom || '—'}</td>
                          <td style={{ direction: 'ltr' }}>{record.phone || '—'}</td>
                          <td>
                            <span className={`log-status-badge ${record.status}`}>
                              {record.status === 'present' ? '✓ حاضر' : '⏰ متأخر'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-scan-state">
                  <div className="empty-scan-icon">
                    <Users size={32} />
                  </div>
                  <h4>لا توجد تسجيلات حضور حتى الآن اليوم</h4>
                  <p>
                    ابدأ الحصر بواسطة الكاميرا أو أدخل رقم الطالب يدوياً ليتم إدراجه في السجل وحفظه دائماً.
                  </p>
                </div>
              )}
            </section>
          </section>
        )}

        {activeNav === 'reports' && (
          <section className="panel report-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">تقارير</span>
                <h3>تقرير الحضور اليومي</h3>
              </div>

              <button className="primary-button" onClick={exportAttendanceCsv}>
                <Download size={18} />
                تصدير CSV
              </button>
            </div>

            <div className="notice-box">{notice}</div>

            <div className="attendance-summary">
              <div className="mini-card present">
                <span>الحاضرون</span>
                <strong>{attendanceSummary.present}</strong>
              </div>
              <div className="mini-card late">
                <span>المتأخرون</span>
                <strong>{attendanceSummary.late}</strong>
              </div>
              <div className="mini-card absent">
                <span>الغائبون</span>
                <strong>{attendanceSummary.absence}</strong>
              </div>
            </div>
          </section>
        )}
      </main>

      {showPrintableCards && (
        <div className="actual-print-document" aria-hidden="true">
          <div className={`print-cards-grid cards-per-page-${cardsPerPage}`}>
            {filteredPrintableStudents.map((student) => (
              <article key={`actual-print-${student.id}`} className="print-card">
                <div className="print-card-header">
                  <span className="print-card-school">مدرسة الفزاري الثانوية</span>
                  <span className="print-card-id">{student.id}</span>
                </div>

                <div className="print-card-body">
                  <img src={student.qr} alt={`QR ${student.name}`} className="print-card-qr" />
                  <div className="print-card-meta">
                    <strong>{student.name}</strong>
                    <span>{gradeLabel(student.grade) || '—'} | {student.classroom || '—'}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
