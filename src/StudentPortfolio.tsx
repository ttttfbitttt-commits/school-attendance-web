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

function portfolioDateHtml(value: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura-nu-arab', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Riyadh',
  }).formatToParts(new Date(value)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const day = String(parts.day || '')
  const month = String(parts.month || '')
  const year = String(parts.year || '')
  return `<time dir="rtl" class="portfolio-correction-date"><bdi dir="ltr">${escapeHtml(day)}</bdi><i>/</i><bdi dir="ltr">${escapeHtml(month)}</bdi><i>/</i><bdi dir="ltr">${escapeHtml(year)}</bdi><span>هـ</span></time>`
}

function portfolioSignatureSvg() {
  return `<svg class="signature generated" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 56" role="img" aria-label="توقيع مجمّع" preserveAspectRatio="xMinYMid meet"><path d="M 6 33 C 31 30, 47 35, 69 32 C 55 27, 52 15, 64 11 C 77 7, 105 11, 111 19 C 117 28, 99 33, 83 28 C 76 26, 71 20, 74 16 C 79 22, 85 37, 93 38 C 102 39, 108 22, 118 23 C 127 23, 121 34, 132 36 C 143 38, 154 30, 174 32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/><path d="M 23 43 C 67 39, 111 47, 158 40" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.9"/></svg>`
}

function portfolioCorrectionStampHtml(correction: StudentPortfolioCorrection, signatureMode: 'uploaded' | 'generated', signatureData: string) {
  const teacher = portfolioTeacherNameParts(correction.teacherName)
  const signature = signatureMode === 'uploaded' && signatureData
    ? `<span class="portfolio-export-signature uploaded" role="img" aria-label="توقيع المعلم" style="-webkit-mask-image:url(&quot;${escapeHtml(signatureData)}&quot;);mask-image:url(&quot;${escapeHtml(signatureData)}&quot;)"></span>`
    : portfolioSignatureSvg()
  const note = correction.note ? `<span>${escapeHtml(correction.note)}</span>` : ''
  return `<div class="portfolio-export-stamp" style="color:${escapeHtml(correction.color)}">${note}<strong>${escapeHtml(teacher)}</strong>${signature}${portfolioDateHtml(correction.correctedAt)}</div>`
}

function portfolioReportHtml(entries: StudentPortfolioEntries) {
  const rows = entries.students.map((student, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(student.name)}</td><td dir="ltr">${escapeHtml(student.identityNumber)}</td><td>${student.slots.filter(slot => slot.fileUrl).length} من ${student.slots.length}</td><td>${student.slots.filter(slot => slot.fileUrl).map(slot => escapeHtml(slot.fileName || `المربع ${slot.slotNumber}`)).join('<br/>') || 'لا توجد ملفات مرفوعة'}</td></tr>`).join('')
  return `<section class="page"><h1>ملف إنجاز الطلاب</h1><p class="report-date">${escapeHtml(entries.subject)} · ${escapeHtml(entries.grade)} · الفصل ${escapeHtml(entries.classroom)}</p><p class="meta">المعلم: ${escapeHtml(entries.teacherName)} · عدد الطلاب: ${entries.students.length}</p><table><thead><tr><th>م</th><th>الطالب</th><th>رقم الهوية</th><th>الإنجازات</th><th>الملفات المرفوعة</th></tr></thead><tbody>${rows || '<tr><td colspan="5">لا يوجد طلاب في هذا الفصل.</td></tr>'}</tbody></table></section>`
}

function portfolioClassPdfHtml(entriesList: StudentPortfolioEntries[], signatureMode: 'uploaded' | 'generated', signatureData: string) {
  const classEntries = entriesList[0]
  if (!classEntries) return ''
  const cards = entriesList.flatMap(entries => entries.students.flatMap(student => student.slots
    .filter(slot => slot.fileUrl && slot.fileType.startsWith('image/'))
    .map(slot => {
      const stamp = slot.correction ? portfolioCorrectionStampHtml(slot.correction, signatureMode, signatureData) : ''
      return `<section class="page"><h1>ملف إنجاز الطالب</h1><div class="portfolio-export-page"><header class="portfolio-export-header"><strong>${escapeHtml(student.name)}</strong><span>رقم الهوية: ${escapeHtml(student.identityNumber)}</span><span>${escapeHtml(entries.subject)} · المربع ${slot.slotNumber}</span></header><div class="portfolio-export-image-wrap"><img src="${escapeHtml(slot.fileUrl)}" alt="${escapeHtml(`${student.name} - ${entries.subject} - ${slot.slotNumber}`)}" />${stamp}</div></div></section>`
    }))).join('')
  const imageCount = entriesList.reduce((count, entries) => count + entries.students.reduce((studentCount, student) =>
    studentCount + student.slots.filter(slot => slot.fileUrl && slot.fileType.startsWith('image/')).length, 0), 0)
  const studentCount = new Set(entriesList.flatMap(entries => entries.students.map(student => student.id))).size
  const subjects = [...new Set(entriesList.map(entries => entries.subject))].join('، ')
  return `<section class="page"><h1>ملف إنجاز الفصل</h1><div class="portfolio-export-summary"><p>${escapeHtml(subjects)}</p><p>${escapeHtml(classEntries.grade)} · الفصل ${escapeHtml(classEntries.classroom)}</p><p>عدد الطلاب: ${studentCount} · عدد الصور: ${imageCount}</p></div>${cards || '<section class="page"><h1>لا توجد صور</h1><p class="report-date">لا توجد صور مرفوعة في هذا الفصل حتى الآن.</p></section>'}</section>`
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

  const exportCurrentClassPdf = () => {
    if (!classEntries?.length) return
    const html = portfolioClassPdfHtml(classEntries, correctionSettings.signatureMode, correctionSettings.signatureData)
    const firstEntry = classEntries[0]
    if (!openPrintDocument(`ملف إنجاز الفصل ${firstEntry.classroom}`, html, schoolName, 'portrait')) {
      setCorrectionMessage('تعذر فتح نافذة التصدير. اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.')
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
        {scope === 'teacher' && <div className="student-portfolio-class-actions"><div className="student-portfolio-class-actions-head"><span>إجراءات الفصل</span></div><div className="student-portfolio-class-actions-row"><button type="button" className="portfolio-correct-all" onClick={() => void correctPortfolioFiles(undefined, undefined, classSubjects.map(group => group.assignmentId))} disabled={!correctionSettingsReady || correctingFiles || !classroomFileCount || (correctionSettings.signatureMode === 'uploaded' && !correctionSettings.signatureData)}><PenLine size={16} />{correctingFiles ? 'جارٍ التصحيح…' : `تصحيح جميع ملفات الفصل (${classroomFileCount})`}</button><button type="button" className="outline-button" onClick={() => void clearPortfolioCorrections(undefined, undefined, classSubjects.map(group => group.assignmentId))} disabled={!correctionSettingsReady || correctingFiles || !classroomFileCount}><PenLine size={16} />إلغاء التصحيح</button><button type="button" className="outline-button" onClick={exportCurrentClassPdf} disabled={!classEntries?.length || classEntriesLoading}><Printer size={16} />{classEntriesLoading ? 'جارٍ تجهيز الفصل…' : 'تصدير PDF'}</button></div>{correctionMessage && <p className="portfolio-correction-message" role="status"><Check size={15} />{correctionMessage}</p>}</div>}
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
