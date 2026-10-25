import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpenCheck, Check, FileText, FolderOpen, Image, Layers3, PenLine, Printer, RefreshCw, Save, Upload, Users } from 'lucide-react'
import { api, type StudentPortfolioCorrection, type StudentPortfolioEntries, type StudentPortfolioGroup, type TeacherPortfolioCorrectionSettings } from './api'
import { PortfolioFilePreview, type PortfolioPreviewFile } from './PortfolioFilePreview'
import { openPrintDocument } from './SchoolFeatures'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
const DEFAULT_CORRECTION_SETTINGS: TeacherPortfolioCorrectionSettings = { signatureMode: 'uploaded', signatureData: '', signatureIsDefault: true, correctionColor: '#d62828' }

async function prepareSignatureImage(file: File) {
  const image = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / image.width, 800 / image.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('تعذر تجهيز صورة التوقيع.')
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  image.close()
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  let left = canvas.width
  let top = canvas.height
  let right = -1
  let bottom = -1
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4
      const darkness = 255 - (imageData.data[offset] + imageData.data[offset + 1] + imageData.data[offset + 2]) / 3
      const alpha = Math.round(imageData.data[offset + 3] * Math.max(0, Math.min(1, (darkness - 38) / 50)))
      imageData.data[offset + 3] = alpha
      if (alpha > 16) {
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x)
        bottom = Math.max(bottom, y)
      }
    }
  }
  if (right < left || bottom < top) throw new Error('لم يتم العثور على توقيع واضح في الصورة.')
  const trimmed = document.createElement('canvas')
  trimmed.width = right - left + 1
  trimmed.height = bottom - top + 1
  const trimmedContext = trimmed.getContext('2d')
  if (!trimmedContext) throw new Error('تعذر تجهيز صورة التوقيع.')
  context.putImageData(imageData, 0, 0)
  trimmedContext.drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height)
  const blob = await new Promise<Blob>((resolve, reject) => trimmed.toBlob(value => value ? resolve(value) : reject(new Error('تعذر تجهيز صورة التوقيع.')), 'image/png'))
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('تعذر قراءة صورة التوقيع.'))
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('تعذر قراءة صورة التوقيع.'))
    reader.readAsDataURL(blob)
  })
}

const gradeRank = (grade: string) => {
  const normalized = String(grade || '').trim().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  if (/(^|\s)(اول|الاول)(\s|$)/.test(normalized)) return 1
  if (/(^|\s)(ثاني|الثاني)(\s|$)/.test(normalized)) return 2
  if (/(^|\s)(ثالث|الثالث)(\s|$)/.test(normalized)) return 3
  if (/(^|\s)(رابع|الرابع)(\s|$)/.test(normalized)) return 4
  if (/(^|\s)(خامس|الخامس)(\s|$)/.test(normalized)) return 5
  if (/(^|\s)(سادس|السادس)(\s|$)/.test(normalized)) return 6
  return 99
}

const compareClassrooms = (left: { grade: string; classroom: string }, right: { grade: string; classroom: string }) =>
  gradeRank(left.grade) - gradeRank(right.grade)
  || left.grade.localeCompare(right.grade, 'ar', { numeric: true, sensitivity: 'base' })
  || left.classroom.localeCompare(right.classroom, 'ar', { numeric: true, sensitivity: 'base' })

function portfolioTeacherNameParts(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0] || name
}

function portfolioHijriDateParts(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Riyadh',
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  return [String(parts.day || ''), String(parts.month || ''), String(parts.year || '')]
}

function portfolioSignatureSvg(color: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="56" viewBox="0 0 180 56"><path d="M 6 33 C 31 30, 47 35, 69 32 C 55 27, 52 15, 64 11 C 77 7, 105 11, 111 19 C 117 28, 99 33, 83 28 C 76 26, 71 20, 74 16 C 79 22, 85 37, 93 38 C 102 39, 108 22, 118 23 C 127 23, 121 34, 132 36 C 143 38, 154 30, 174 32" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><path d="M 23 43 C 67 39, 111 47, 158 40" fill="none" stroke="${color}" stroke-width="1.1" stroke-linecap="round" opacity="0.9"/></svg>`
}

async function loadPortfolioCanvasImage(source: string) {
  const image = new window.Image()
  image.decoding = 'async'
  image.src = source
  try {
    await image.decode()
    return await createImageBitmap(image)
  } catch {
    throw new Error('تعذر تحميل إحدى صور الفصل أو التوقيع.')
  }
}

async function portfolioImageWithCorrection(file: StudentPortfolioEntries['students'][number]['slots'][number], correction: StudentPortfolioCorrection | null | undefined, signatureMode: 'uploaded' | 'generated', signatureData: string) {
  const image = await loadPortfolioCanvasImage(file.fileUrl)
  try {
    const landscape = image.width > image.height
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('تعذر تجهيز صفحة PDF.')
    context.drawImage(image, 0, 0)

    if (correction) {
      const stampScale = Math.min(image.width * 0.3 / 260, image.height * 0.65 / 82, 1.25)
      const padding = 10 * stampScale
      const stampWidth = 260 * stampScale
      const stampHeight = 82 * stampScale
      const stampX = 12 * stampScale
      const stampY = image.height - stampHeight - 14 * stampScale
      context.save()
      context.strokeStyle = correction.color
      context.globalAlpha = 0.42
      context.lineWidth = Math.max(1, 1.2 * stampScale)
      context.strokeRect(stampX, stampY, stampWidth, stampHeight)
      context.restore()

      context.save()
      context.fillStyle = correction.color
      context.font = `bold ${Math.max(10, 16 * stampScale)}px Tahoma, Arial, sans-serif`
      context.textAlign = 'left'
      context.direction = 'rtl'
      if (correction.note) context.fillText(correction.note, stampX + padding, stampY + 19 * stampScale, stampWidth - padding * 2)
      context.fillText(portfolioTeacherNameParts(correction.teacherName), stampX + padding, stampY + 38 * stampScale, stampWidth - padding * 2)
      context.restore()

      const signatureImage = signatureMode === 'uploaded' && signatureData
        ? await loadPortfolioCanvasImage(signatureData)
        : await createImageBitmap(new Blob([portfolioSignatureSvg(correction.color)], { type: 'image/svg+xml' }))
      try {
        const signatureCanvas = document.createElement('canvas')
        signatureCanvas.width = Math.max(1, Math.round(132 * stampScale))
        signatureCanvas.height = Math.max(1, Math.round(34 * stampScale))
        const signatureContext = signatureCanvas.getContext('2d')
        if (!signatureContext) throw new Error('تعذر تجهيز صورة التوقيع.')
        const signatureFit = Math.min(signatureCanvas.width / signatureImage.width, signatureCanvas.height / signatureImage.height)
        const signatureWidth = signatureImage.width * signatureFit
        const signatureHeight = signatureImage.height * signatureFit
        signatureContext.drawImage(signatureImage, (signatureCanvas.width - signatureWidth) / 2, (signatureCanvas.height - signatureHeight) / 2, signatureWidth, signatureHeight)
        if (signatureMode === 'uploaded' && signatureData) {
          signatureContext.globalCompositeOperation = 'source-in'
          signatureContext.fillStyle = correction.color
          signatureContext.fillRect(0, 0, signatureCanvas.width, signatureCanvas.height)
        }
        context.save()
        context.globalAlpha = 0.72
        context.drawImage(signatureCanvas, stampX + padding, stampY + 41 * stampScale)
        context.restore()
      } finally {
        signatureImage.close()
      }

      context.save()
      context.fillStyle = correction.color
      context.textAlign = 'right'
      context.direction = 'ltr'
      context.font = `bold ${Math.max(9, 12 * stampScale)}px Tahoma, Arial, sans-serif`
      let dateX = stampX + stampWidth - padding
      const [day, month, year] = portfolioHijriDateParts(correction.correctedAt)
      for (const segment of [day, '/', month, '/', year, 'هـ']) {
        context.fillText(segment, dateX, stampY + stampHeight - 7 * stampScale, stampWidth - padding * 2)
        dateX -= context.measureText(segment).width + 2 * stampScale
      }
      context.restore()
    }

    const imageType = file.fileType === 'image/png' ? 'image/png' : 'image/jpeg'
    const data = imageType === 'image/png' ? canvas.toDataURL(imageType) : canvas.toDataURL(imageType, 0.96)
    return { data, imageType, landscape, width: canvas.width, height: canvas.height }
  } finally {
    image.close()
  }
}

function portfolioReportHtml(entries: StudentPortfolioEntries) {
  const rows = entries.students.map((student, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(student.name)}</td><td dir="ltr">${escapeHtml(student.identityNumber)}</td><td>${student.slots.filter(slot => slot.fileUrl).length} من ${student.slots.length}</td><td>${student.slots.filter(slot => slot.fileUrl).map(slot => escapeHtml(slot.fileName || `المربع ${slot.slotNumber}`)).join('<br/>') || 'لا توجد ملفات مرفوعة'}</td></tr>`).join('')
  return `<section class="page"><h1>ملف إنجاز الطلاب</h1><p class="report-date">${escapeHtml(entries.subject)} · ${escapeHtml(entries.grade)} · الفصل ${escapeHtml(entries.classroom)}</p><p class="meta">المعلم: ${escapeHtml(entries.teacherName)} · عدد الطلاب: ${entries.students.length}</p><table><thead><tr><th>م</th><th>الطالب</th><th>رقم الهوية</th><th>الإنجازات</th><th>الملفات المرفوعة</th></tr></thead><tbody>${rows || '<tr><td colspan="5">لا يوجد طلاب في هذا الفصل.</td></tr>'}</tbody></table></section>`
}

export function StudentPortfolioBoard({ scope = 'school', schoolName = 'المدرسة' }: { scope?: 'school' | 'teacher' | 'activityLeader'; schoolName?: string }) {
  const [groups, setGroups] = useState<StudentPortfolioGroup[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedClassroom, setSelectedClassroom] = useState('')
  const [entries, setEntries] = useState<StudentPortfolioEntries | null>(null)
  const [classEntries, setClassEntries] = useState<StudentPortfolioEntries[] | null>(null)
  const [classEntriesLoading, setClassEntriesLoading] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<(PortfolioPreviewFile & { correction?: StudentPortfolioCorrection | null; assignmentId: string; studentId: string; slotNumber: number }) | null>(null)
  const [correctionSettings, setCorrectionSettings] = useState<TeacherPortfolioCorrectionSettings>(DEFAULT_CORRECTION_SETTINGS)
  const [correctionNote, setCorrectionNote] = useState('')
  const [correctionMessage, setCorrectionMessage] = useState('')
  const [savingCorrectionSettings, setSavingCorrectionSettings] = useState(false)
  const [correctingFiles, setCorrectingFiles] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [readingSignature, setReadingSignature] = useState(false)
  const [correctionSettingsReady, setCorrectionSettingsReady] = useState(scope !== 'teacher')

  const loadGroups = async () => {
    setBusy(true)
    setError('')
    try {
      const result = scope === 'teacher' ? await api.teacherPortfolioGroups() : scope === 'activityLeader' ? await api.activityLeaderPortfolioGroups() : await api.schoolPortfolioGroups()
      const nextClassroom = result.groups.some(group => `${group.grade}:${group.classroom}` === selectedClassroom) ? selectedClassroom : ''
      setGroups(result.groups)
      setSelectedClassroom(nextClassroom)
      setSelectedId(current => result.groups.some(group => group.assignmentId === current) ? current : '')
      setClassEntries(null)
      setClassEntriesLoading(scope === 'teacher' && Boolean(nextClassroom))
    } catch {
      setError('تعذر تحميل مواد ملف الإنجاز الآن.')
    } finally { setBusy(false) }
  }

  useEffect(() => { void loadGroups() }, [scope])
  useEffect(() => {
    if (scope !== 'teacher') { setCorrectionSettingsReady(true); return }
    let active = true
    setCorrectionSettingsReady(false)
    api.teacherPortfolioCorrectionSettings()
      .then(settings => {
        if (!active) return
        setCorrectionSettings(settings)
        setCorrectionSettingsReady(true)
      })
      .catch(() => { if (active) setCorrectionMessage('تعذر تحميل إعدادات التوقيع والتصحيح.') })
    return () => { active = false }
  }, [scope])
  useEffect(() => {
    if (!selectedId) { setEntries(null); return }
    let active = true
    setEntries(null)
    setError('')
    const loadEntries = async () => {
      try {
        const result = scope === 'teacher' ? await api.teacherPortfolioEntries(selectedId) : scope === 'activityLeader' ? await api.activityLeaderPortfolioEntries(selectedId) : await api.schoolPortfolioEntries(selectedId)
        if (active) setEntries(result)
      } catch { if (active) setError('تعذر فتح طلاب هذه المادة.') }
    }
    void loadEntries()
    return () => { active = false }
  }, [selectedId, scope])

  const classrooms = useMemo(() => {
    const byClassroom = new Map<string, { key: string; grade: string; classroom: string; students: number; files: number; subjects: number }>()
    for (const group of groups) {
      const key = `${group.grade}:${group.classroom}`
      const current = byClassroom.get(key) || { key, grade: group.grade, classroom: group.classroom, students: group.studentCount, files: 0, subjects: 0 }
      current.students = Math.max(current.students, group.studentCount)
      current.files += group.submittedFiles
      current.subjects += 1
      byClassroom.set(key, current)
    }
    return [...byClassroom.values()].sort(compareClassrooms)
  }, [groups])
  const classSubjects = useMemo(() => groups
    .filter(group => `${group.grade}:${group.classroom}` === selectedClassroom)
    .sort((left, right) => left.subject.localeCompare(right.subject, 'ar', { numeric: true, sensitivity: 'base' }) || left.teacherName.localeCompare(right.teacherName, 'ar', { numeric: true, sensitivity: 'base' })), [groups, selectedClassroom])
  const chooseClassroom = (key: string) => {
    setSelectedClassroom(key)
    setSelectedId('')
    setEntries(null)
    setClassEntries(null)
    setClassEntriesLoading(scope === 'teacher' && Boolean(key))
  }
  const classroomFileCount = classSubjects.reduce((count, group) => count + group.submittedFiles, 0)

  useEffect(() => {
    if (scope !== 'teacher' || !selectedClassroom || !classSubjects.length) return
    let active = true
    Promise.all(classSubjects.map(group => api.teacherPortfolioEntries(group.assignmentId)))
      .then(result => { if (active) setClassEntries(result) })
      .catch(() => { if (active) setCorrectionMessage('تعذر تحميل ملفات الفصل لتجهيز التصدير.') })
      .finally(() => { if (active) setClassEntriesLoading(false) })
    return () => { active = false }
  }, [scope, selectedClassroom, classSubjects])

  const saveCorrectionSettings = async () => {
    setSavingCorrectionSettings(true)
    setCorrectionMessage('')
    try {
      const saved = await api.saveTeacherPortfolioCorrectionSettings(correctionSettings)
      setCorrectionSettings(saved)
      setCorrectionMessage('تم حفظ إعدادات التصحيح والتوقيع.')
    } catch {
      setCorrectionMessage('تعذر حفظ الإعدادات. تأكد من رفع صورة التوقيع عند اختيار التوقيع المرفوع.')
    } finally { setSavingCorrectionSettings(false) }
  }

  const updateSignatureImage = async (file?: File) => {
    if (!file) return
    setReadingSignature(true)
    setCorrectionMessage('')
    try {
      const signatureData = await prepareSignatureImage(file)
      setCorrectionSettings(current => ({ ...current, signatureMode: 'uploaded', signatureData, signatureIsDefault: false }))
      setCorrectionMessage('تم تفريغ الخلفية البيضاء وقص الهوامش. احفظ الإعدادات لتثبيت التوقيع.')
    } catch {
      setCorrectionMessage('تعذر تجهيز الصورة. اختر صورة PNG أو JPG أو WebP واضحة للتوقيع.')
    } finally { setReadingSignature(false) }
  }

  const correctPortfolioFiles = async (studentId?: string, slotNumber?: number, assignmentIds?: string[]) => {
    const targetAssignmentIds = assignmentIds?.length ? assignmentIds : entries ? [entries.assignmentId] : []
    if (!targetAssignmentIds.length || scope !== 'teacher' || !correctionSettingsReady) return
    setCorrectingFiles(true)
    setCorrectionMessage('')
    try {
      const savedSettings = await api.saveTeacherPortfolioCorrectionSettings(correctionSettings)
      setCorrectionSettings(savedSettings)
      const result = await api.correctTeacherPortfolioFiles(targetAssignmentIds[0], { note: correctionNote, studentId, slotNumber, assignmentIds: targetAssignmentIds })
      const corrections = new Map(result.corrections.map(correction => [`${correction.assignmentId}:${correction.studentId}:${correction.slotNumber}`, correction]))
      setEntries(current => current ? {
        ...current,
        students: current.students.map(student => ({
          ...student,
          slots: student.slots.map(slot => {
            const correction = corrections.get(`${current.assignmentId}:${student.id}:${slot.slotNumber}`)
            return correction ? { ...slot, correction } : slot
          }),
        })),
      } : current)
      setClassEntries(current => current?.map(classEntry => ({
        ...classEntry,
        students: classEntry.students.map(student => ({
          ...student,
          slots: student.slots.map(slot => {
            const correction = corrections.get(`${classEntry.assignmentId}:${student.id}:${slot.slotNumber}`)
            return correction ? { ...slot, correction } : slot
          }),
        })),
      })) || current)
      setPreview(current => {
        if (!current || !targetAssignmentIds.includes(current.assignmentId)) return current
        const correction = corrections.get(`${current.assignmentId}:${current.studentId}:${current.slotNumber}`)
        return correction ? { ...current, correction } : current
      })
      setCorrectionMessage(`تم تصحيح ${result.corrections.length} ملف.`)
    } catch {
      setCorrectionMessage('تعذر حفظ التصحيح. تأكد من اختيار توقيع محفوظ ومن صلاحية الملفات.')
    } finally { setCorrectingFiles(false) }
  }

  const clearPortfolioCorrections = async (studentId?: string, slotNumber?: number, assignmentIds?: string[]) => {
    const targetAssignmentIds = assignmentIds?.length ? assignmentIds : entries ? [entries.assignmentId] : []
    if (!targetAssignmentIds.length || scope !== 'teacher' || !correctionSettingsReady) return
    setCorrectingFiles(true)
    setCorrectionMessage('')
    try {
      const result = await api.cancelTeacherPortfolioCorrections(targetAssignmentIds[0], { studentId, slotNumber, assignmentIds: targetAssignmentIds })
      setEntries(current => current ? {
        ...current,
        students: current.students.map(student => ({
          ...student,
          slots: student.slots.map(slot => (targetAssignmentIds.includes(current.assignmentId) && slot.correction && (studentId === undefined || student.id === studentId) && (slotNumber === undefined || slot.slotNumber === slotNumber)) ? { ...slot, correction: null } : slot),
        })),
      } : current)
      setClassEntries(current => current?.map(classEntry => ({
        ...classEntry,
        students: classEntry.students.map(student => ({
          ...student,
          slots: student.slots.map(slot => (targetAssignmentIds.includes(classEntry.assignmentId) && slot.correction && (studentId === undefined || student.id === studentId) && (slotNumber === undefined || slot.slotNumber === slotNumber)) ? { ...slot, correction: null } : slot),
        })),
      })) || current)
      setPreview(current => {
        if (!current || !targetAssignmentIds.includes(current.assignmentId) || (studentId !== undefined && current.studentId !== studentId) || (slotNumber !== undefined && current.slotNumber !== slotNumber)) return current
        return { ...current, correction: null }
      })
      setCorrectionMessage(`تم إلغاء التصحيح عن ${result.cleared} ملف${result.cleared === 1 ? '' : 'ات'}.`)
    } catch {
      setCorrectionMessage('تعذر إلغاء التصحيح. حاول مرة أخرى.')
    } finally { setCorrectingFiles(false) }
  }

  const classImageCount = classEntries?.reduce((count, classEntry) => count + classEntry.students.reduce((studentCount, student) =>
    studentCount + student.slots.filter(slot => slot.fileUrl && slot.fileType.startsWith('image/')).length, 0), 0) || 0

  const exportCurrentClassPdf = async () => {
    if (!classEntries?.length || exportingPdf) return
    setExportingPdf(true)
    setCorrectionMessage('')
    try {
      const { jsPDF } = await import('jspdf')
      const files = classEntries.flatMap(classEntry => classEntry.students.flatMap(student => student.slots
        .filter(slot => slot.fileUrl && slot.fileType.startsWith('image/'))
        .map(slot => ({ slot, correction: slot.correction }))))
      if (!files.length) throw new Error('لا توجد صور مرفوعة في هذا الفصل.')

      let pdf: InstanceType<typeof jsPDF> | null = null
      for (const [index, file] of files.entries()) {
        const page = await portfolioImageWithCorrection(file.slot, file.correction, correctionSettings.signatureMode, correctionSettings.signatureData)
        const orientation = page.landscape ? 'landscape' : 'portrait'
        if (!pdf) pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true })
        else pdf.addPage('a4', orientation)
        const pageWidth = page.landscape ? 297 : 210
        const pageHeight = page.landscape ? 210 : 297
        const margin = 3
        const sourceAspectRatio = page.width / page.height
        const maxWidth = pageWidth - margin * 2
        const maxHeight = pageHeight - margin * 2
        const imageWidth = Math.min(maxWidth, maxHeight * sourceAspectRatio)
        const imageHeight = imageWidth / sourceAspectRatio
        pdf.addImage(page.data, page.imageType === 'image/png' ? 'PNG' : 'JPEG', (pageWidth - imageWidth) / 2, (pageHeight - imageHeight) / 2, imageWidth, imageHeight, `portfolio-page-${index}`, 'FAST')
      }
      if (!pdf) throw new Error('تعذر إنشاء ملف PDF.')
      if (pdf.getNumberOfPages() !== files.length) throw new Error('عدد صفحات PDF لا يطابق عدد الصور.')
      pdf.save('portfolio-class.pdf')
      setCorrectionMessage(`تم تصدير ${files.length} صورة، كل صورة في صفحة مستقلة.`)
    } catch (error) {
      setCorrectionMessage(error instanceof Error ? `تعذر تصدير PDF: ${error.message}` : 'تعذر تصدير PDF. حاول مرة أخرى.')
    } finally {
      setExportingPdf(false)
    }
  }

  return <section className="student-portfolio-admin" dir="rtl">
    <div className="student-portfolio-head">
      <div><span>{scope === 'teacher' ? 'ملفات طلاب فصولك' : 'ملفات جميع الطلاب'}</span><h2>ملف الإنجاز</h2><p>{scope === 'teacher' ? 'تعرض هذه الصفحة المواد والفصول المسندة إليك فقط.' : 'اختر الفصل، ثم المادة، ثم راجع ملفات الطلاب.'}</p></div>
      <button type="button" className="outline-button" onClick={() => void loadGroups()} disabled={busy}><RefreshCw size={16} /> تحديث</button>
    </div>
    {error && <p className="student-portal-notice error">{error}</p>}
    {busy ? <p className="teacher-empty">جارٍ تحميل ملف الإنجاز…</p> : !groups.length ? <div className="student-portfolio-empty"><BookOpenCheck size={34} /><strong>لا توجد مواد مرتبطة بطلاب بعد</strong><p>أكمل استيراد الجدول وربط الفصل بالطلاب لتظهر المواد هنا.</p></div> : <>
      {!selectedClassroom ? <div className="student-portfolio-classroom-grid">{classrooms.map(classroom => <button type="button" key={classroom.key} onClick={() => chooseClassroom(classroom.key)}><Layers3 size={25} /><strong>{classroom.grade}</strong><span>الفصل {classroom.classroom}</span><small><Users size={13} /> {classroom.students} طالب · <Image size={13} /> {classroom.files} ملف</small><em>{classroom.subjects} مواد <ArrowRight size={15} /></em></button>)}</div> : <>
        <div className="student-portfolio-classroom-bar"><button type="button" className="outline-button" onClick={() => chooseClassroom('')}><ArrowRight size={16} /> الفصول</button><div><span>{classSubjects[0]?.grade}</span><strong>الفصل {classSubjects[0]?.classroom}</strong></div></div>
        {scope === 'teacher' && <div className="student-portfolio-class-actions"><div className="student-portfolio-class-actions-head"><span>إجراءات الفصل</span></div><div className="student-portfolio-class-actions-row"><button type="button" className="portfolio-correct-all" onClick={() => void correctPortfolioFiles(undefined, undefined, classSubjects.map(group => group.assignmentId))} disabled={!correctionSettingsReady || correctingFiles || !classroomFileCount || (correctionSettings.signatureMode === 'uploaded' && !correctionSettings.signatureData)}><PenLine size={16} />{correctingFiles ? 'جارٍ التصحيح…' : `تصحيح جميع ملفات الفصل (${classroomFileCount})`}</button><button type="button" className="outline-button" onClick={() => void clearPortfolioCorrections(undefined, undefined, classSubjects.map(group => group.assignmentId))} disabled={!correctionSettingsReady || correctingFiles || !classroomFileCount}><PenLine size={16} />إلغاء التصحيح</button><button type="button" className="outline-button" onClick={() => void exportCurrentClassPdf()} disabled={!correctionSettingsReady || correctingFiles || !classEntries?.length || classEntriesLoading || !classImageCount || exportingPdf}><Printer size={16} />{classEntriesLoading ? 'جارٍ تجهيز الفصل…' : exportingPdf ? 'جارٍ إنشاء PDF…' : `تصدير PDF (${classImageCount})`}</button></div>{correctionMessage && <p className="portfolio-correction-message" role="status"><Check size={15} />{correctionMessage}</p>}</div>}
        <div className="student-portfolio-group-grid">
          {classSubjects.map(group => <button type="button" key={group.assignmentId} className={selectedId === group.assignmentId ? 'active' : ''} onClick={() => setSelectedId(group.assignmentId)}>
            <FolderOpen size={23} /><strong>{group.subject}</strong><span>{group.teacherName}</span><small>{group.grade} · الفصل {group.classroom}</small><em><Users size={13} /> {group.studentCount} طالب · <Image size={13} /> {group.submittedFiles} ملف</em>
          </button>)}
        </div>
      </>}
      {selectedId && !entries && <p className="teacher-empty">جارٍ تحميل طلاب المادة…</p>}
      {entries && <section className="student-portfolio-entries">
        <header><div><span>{entries.grade} · الفصل {entries.classroom}</span><h3>{entries.subject}</h3><p>المعلم: {entries.teacherName}</p></div><div className="teacher-report-actions"><strong>{entries.students.length} طالبًا</strong>{scope === 'activityLeader' && <button type="button" className="outline-button" onClick={() => openPrintDocument(`ملف إنجاز الطلاب - ${entries.subject}`, portfolioReportHtml(entries), schoolName, 'landscape')}><Printer size={16} />طباعة / حفظ PDF</button>}</div></header>
        {scope === 'teacher' && <section className="portfolio-correction-settings" aria-label="إعدادات التصحيح">
          <div className="portfolio-correction-settings-head"><div><h3>إعدادات التوقيع والتصحيح</h3><p>سيُحفظ توقيعك ولون التصحيح لاستخدامهما في ملفات فصولك.</p></div><label className="portfolio-correction-color">لون التصحيح<input type="color" disabled={!correctionSettingsReady} value={correctionSettings.correctionColor} onChange={event => setCorrectionSettings(current => ({ ...current, correctionColor: event.target.value }))} /></label></div>
          <div className="portfolio-signature-modes">
            <label><input type="radio" name="portfolio-signature-mode" disabled={!correctionSettingsReady} checked={correctionSettings.signatureMode === 'uploaded'} onChange={() => setCorrectionSettings(current => ({ ...current, signatureMode: 'uploaded' }))} /> توقيعي المرفوع</label>
            <label><input type="radio" name="portfolio-signature-mode" disabled={!correctionSettingsReady} checked={correctionSettings.signatureMode === 'generated'} onChange={() => setCorrectionSettings(current => ({ ...current, signatureMode: 'generated' }))} /> توقيع مزخرف بالأحرف (الافتراضي)</label>
          </div>
          {correctionSettings.signatureMode === 'uploaded' ? <div className="portfolio-signature-upload">
            <label className="outline-button"><Upload size={16} />{readingSignature ? 'جارٍ تجهيز الصورة…' : 'رفع صورة التوقيع'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!correctionSettingsReady || readingSignature} onChange={event => { void updateSignatureImage(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
            {correctionSettings.signatureData ? <img src={correctionSettings.signatureData} alt="معاينة التوقيع" /> : <span>ارفع توقيعاً على ورقة بيضاء. ستُزال الخلفية وتُقص الحواف تلقائياً.</span>}
          </div> : <p className="portfolio-signature-help">تظهر زخرفة عامة مشتركة لا تمثل توقيع شخص بعينه. يمكنك رفع توقيعك الحقيقي ليحل محلها.</p>}
          <div className="portfolio-correction-note"><label htmlFor="portfolio-correction-note">عبارة التصحيح (اختيارية)</label><textarea id="portfolio-correction-note" disabled={!correctionSettingsReady} value={correctionNote} maxLength={160} onChange={event => setCorrectionNote(event.target.value)} placeholder="مثال: أحسنت، بارك الله فيك" /></div>
          <div className="portfolio-correction-settings-actions"><button type="button" className="outline-button" onClick={() => void saveCorrectionSettings()} disabled={!correctionSettingsReady || savingCorrectionSettings || readingSignature}><Save size={16} />{savingCorrectionSettings ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button></div>
        </section>}
        <div className="student-portfolio-students">
          {entries.students.map(student => <article key={student.id}>
            <div className="student-portfolio-student-name"><b>{student.name}</b><span dir="ltr">{student.identityNumber}</span>{scope === 'teacher' && <button type="button" className="portfolio-correction-student" onClick={() => void correctPortfolioFiles(student.id)} disabled={!correctionSettingsReady || correctingFiles || !student.slots.some(slot => slot.fileUrl) || (correctionSettings.signatureMode === 'uploaded' && !correctionSettings.signatureData)}><PenLine size={14} />تصحيح ملفات الطالب</button>}</div>
            <div className="student-portfolio-slot-list">{student.slots.map(slot => <div className={`student-portfolio-slot ${slot.fileUrl ? 'filled' : ''}`} key={slot.slotNumber}>
              {slot.fileUrl ? <>{slot.fileType.startsWith('image/') ? <button type="button" className="student-portfolio-image-button" onClick={() => setPreview({ ...slot, assignmentId: entries.assignmentId, studentId: student.id })}><img src={slot.fileUrl} alt={`إنجاز ${student.name} ${slot.slotNumber}`} /></button> : <button type="button" className="student-portfolio-file-link" onClick={() => setPreview({ ...slot, assignmentId: entries.assignmentId, studentId: student.id })}><FileText size={20} /><span>{slot.fileName || 'فتح الملف'}</span></button>}{scope === 'teacher' && <button type="button" className="portfolio-correction-slot-action" onClick={() => void correctPortfolioFiles(student.id, slot.slotNumber)} disabled={!correctionSettingsReady || correctingFiles || (correctionSettings.signatureMode === 'uploaded' && !correctionSettings.signatureData)}><PenLine size={13} />{slot.correction ? 'تحديث التصحيح' : 'تصحيح'}</button>}{slot.correction && <small className="portfolio-corrected-label">تم التصحيح</small>}</> : <span>المربع {slot.slotNumber}<small>لم يُرفع ملف</small></span>}
            </div>)}</div>
          </article>)}
        </div>
      </section>}
    </>}
    {preview && <PortfolioFilePreview file={preview} correction={scope === 'teacher' ? preview.correction : null} signatureMode={correctionSettings.signatureMode} signatureData={correctionSettings.signatureData} schoolName={schoolName} onClose={() => setPreview(null)} />}
  </section>
}
