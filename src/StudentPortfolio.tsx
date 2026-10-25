import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpenCheck, Check, FileText, FolderOpen, Image, Layers3, PenLine, Printer, RefreshCw, Save, Upload, Users } from 'lucide-react'
import { api, type StudentPortfolioCorrection, type StudentPortfolioEntries, type StudentPortfolioGroup, type TeacherPortfolioCorrectionSettings } from './api'
import { PortfolioFilePreview, type PortfolioPreviewFile } from './PortfolioFilePreview'
import { openPrintDocument } from './SchoolFeatures'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
const DEFAULT_CORRECTION_SETTINGS: TeacherPortfolioCorrectionSettings = { signatureMode: 'generated', signatureData: '', correctionColor: '#d62828' }

async function prepareSignatureImage(file: File) {
  const image = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / image.width, 800 / image.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('تعذر تجهيز صورة التوقيع.')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  image.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('تعذر تجهيز صورة التوقيع.')), 'image/jpeg', 0.88))
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

function portfolioReportHtml(entries: StudentPortfolioEntries) {
  const rows = entries.students.map((student, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(student.name)}</td><td dir="ltr">${escapeHtml(student.identityNumber)}</td><td>${student.slots.filter(slot => slot.fileUrl).length} من ${student.slots.length}</td><td>${student.slots.filter(slot => slot.fileUrl).map(slot => escapeHtml(slot.fileName || `المربع ${slot.slotNumber}`)).join('<br/>') || 'لا توجد ملفات مرفوعة'}</td></tr>`).join('')
  return `<section class="page"><h1>ملف إنجاز الطلاب</h1><p class="report-date">${escapeHtml(entries.subject)} · ${escapeHtml(entries.grade)} · الفصل ${escapeHtml(entries.classroom)}</p><p class="meta">المعلم: ${escapeHtml(entries.teacherName)} · عدد الطلاب: ${entries.students.length}</p><table><thead><tr><th>م</th><th>الطالب</th><th>رقم الهوية</th><th>الإنجازات</th><th>الملفات المرفوعة</th></tr></thead><tbody>${rows || '<tr><td colspan="5">لا يوجد طلاب في هذا الفصل.</td></tr>'}</tbody></table></section>`
}

export function StudentPortfolioBoard({ scope = 'school', schoolName = 'المدرسة' }: { scope?: 'school' | 'teacher' | 'activityLeader'; schoolName?: string }) {
  const [groups, setGroups] = useState<StudentPortfolioGroup[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedClassroom, setSelectedClassroom] = useState('')
  const [entries, setEntries] = useState<StudentPortfolioEntries | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<(PortfolioPreviewFile & { correction?: StudentPortfolioCorrection | null; studentId: string }) | null>(null)
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
      setGroups(result.groups)
      setSelectedClassroom(current => result.groups.some(group => `${group.grade}:${group.classroom}` === current) ? current : '')
      setSelectedId(current => result.groups.some(group => group.assignmentId === current) ? current : '')
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
  const chooseClassroom = (key: string) => { setSelectedClassroom(key); setSelectedId(''); setEntries(null) }
  const submittedFileCount = entries?.students.reduce((count, student) => count + student.slots.filter(slot => slot.fileUrl).length, 0) || 0
  const classroomFileCount = classSubjects.reduce((count, group) => count + group.submittedFiles, 0)

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
      setCorrectionSettings(current => ({ ...current, signatureMode: 'uploaded', signatureData }))
      setCorrectionMessage('تم تجهيز الصورة. احفظ الإعدادات لتثبيت التوقيع بعد إزالة الخلفية وقص الهوامش.')
    } catch {
      setCorrectionMessage('تعذر تجهيز الصورة. اختر صورة PNG أو JPG أو WebP واضحة للتوقيع.')
    } finally { setReadingSignature(false) }
  }

  const correctPortfolioFiles = async (studentId?: string, slotNumber?: number, assignmentIds?: string[]) => {
    if (!entries || scope !== 'teacher' || !correctionSettingsReady) return
    setCorrectingFiles(true)
    setCorrectionMessage('')
    try {
      const savedSettings = await api.saveTeacherPortfolioCorrectionSettings(correctionSettings)
      setCorrectionSettings(savedSettings)
      const result = await api.correctTeacherPortfolioFiles(entries.assignmentId, { note: correctionNote, studentId, slotNumber, assignmentIds })
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
      setPreview(current => {
        if (!current) return current
        const correction = corrections.get(`${entries.assignmentId}:${current.studentId}:${current.slotNumber}`)
        return correction ? { ...current, correction } : current
      })
      setCorrectionMessage(`تم تصحيح ${result.corrections.length} ملف.`)
    } catch {
      setCorrectionMessage('تعذر حفظ التصحيح. تأكد من اختيار توقيع محفوظ ومن صلاحية الملفات.')
    } finally { setCorrectingFiles(false) }
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
            <label><input type="radio" name="portfolio-signature-mode" disabled={!correctionSettingsReady} checked={correctionSettings.signatureMode === 'generated'} onChange={() => setCorrectionSettings(current => ({ ...current, signatureMode: 'generated' }))} /> توقيع بمظهر يدوي</label>
          </div>
          {correctionSettings.signatureMode === 'uploaded' ? <div className="portfolio-signature-upload">
            <label className="outline-button"><Upload size={16} />{readingSignature ? 'جارٍ تجهيز الصورة…' : 'رفع صورة التوقيع'}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={!correctionSettingsReady || readingSignature} onChange={event => { void updateSignatureImage(event.target.files?.[0]); event.currentTarget.value = '' }} /></label>
            {correctionSettings.signatureData ? <img src={correctionSettings.signatureData} alt="معاينة التوقيع" /> : <span>ارفع توقيعاً على ورقة بيضاء. ستُزال الخلفية وتُقص الحواف تلقائياً.</span>}
          </div> : <p className="portfolio-signature-help">سيُكتب اسم المعلم بخط عربي ذي مظهر يدوي؛ هذا أسلوب بصري وليس توقيعاً مرسوماً فعلياً.</p>}
          <div className="portfolio-correction-note"><label htmlFor="portfolio-correction-note">عبارة التصحيح (اختيارية)</label><textarea id="portfolio-correction-note" disabled={!correctionSettingsReady} value={correctionNote} maxLength={160} onChange={event => setCorrectionNote(event.target.value)} placeholder="مثال: أحسنت، بارك الله فيك" /></div>
          <div className="portfolio-correction-settings-actions"><button type="button" className="outline-button" onClick={() => void saveCorrectionSettings()} disabled={!correctionSettingsReady || savingCorrectionSettings || readingSignature}><Save size={16} />{savingCorrectionSettings ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}</button><button type="button" className="portfolio-correct-all" onClick={() => void correctPortfolioFiles(undefined, undefined, classSubjects.map(group => group.assignmentId))} disabled={!correctionSettingsReady || correctingFiles || !classroomFileCount || (correctionSettings.signatureMode === 'uploaded' && !correctionSettings.signatureData)}><PenLine size={16} />{correctingFiles ? 'جارٍ التصحيح…' : `تصحيح ملفات الفصل (${classroomFileCount})`}</button><button type="button" className="portfolio-correct-all portfolio-correct-subject" onClick={() => void correctPortfolioFiles()} disabled={!correctionSettingsReady || correctingFiles || !submittedFileCount || (correctionSettings.signatureMode === 'uploaded' && !correctionSettings.signatureData)}><PenLine size={16} />تصحيح ملفات المادة ({submittedFileCount})</button></div>
          {correctionMessage && <p className="portfolio-correction-message" role="status"><Check size={15} />{correctionMessage}</p>}
        </section>}
        <div className="student-portfolio-students">
          {entries.students.map(student => <article key={student.id}>
            <div className="student-portfolio-student-name"><b>{student.name}</b><span dir="ltr">{student.identityNumber}</span>{scope === 'teacher' && <button type="button" className="portfolio-correction-student" onClick={() => void correctPortfolioFiles(student.id)} disabled={!correctionSettingsReady || correctingFiles || !student.slots.some(slot => slot.fileUrl) || (correctionSettings.signatureMode === 'uploaded' && !correctionSettings.signatureData)}><PenLine size={14} />تصحيح ملفات الطالب</button>}</div>
            <div className="student-portfolio-slot-list">{student.slots.map(slot => <div className={`student-portfolio-slot ${slot.fileUrl ? 'filled' : ''}`} key={slot.slotNumber}>
              {slot.fileUrl ? <>{slot.fileType.startsWith('image/') ? <button type="button" className="student-portfolio-image-button" onClick={() => setPreview({ ...slot, studentId: student.id })}><img src={slot.fileUrl} alt={`إنجاز ${student.name} ${slot.slotNumber}`} /></button> : <button type="button" className="student-portfolio-file-link" onClick={() => setPreview({ ...slot, studentId: student.id })}><FileText size={20} /><span>{slot.fileName || 'فتح الملف'}</span></button>}{scope === 'teacher' && <button type="button" className="portfolio-correction-slot-action" onClick={() => void correctPortfolioFiles(student.id, slot.slotNumber)} disabled={!correctionSettingsReady || correctingFiles || (correctionSettings.signatureMode === 'uploaded' && !correctionSettings.signatureData)}><PenLine size={13} />{slot.correction ? 'تحديث التصحيح' : 'تصحيح'}</button>}{slot.correction && <small className="portfolio-corrected-label">تم التصحيح</small>}</> : <span>المربع {slot.slotNumber}<small>لم يُرفع ملف</small></span>}
            </div>)}</div>
          </article>)}
        </div>
      </section>}
    </>}
    {preview && <PortfolioFilePreview file={preview} correction={scope === 'teacher' ? preview.correction : null} signatureMode={correctionSettings.signatureMode} signatureData={correctionSettings.signatureData} schoolName={schoolName} onClose={() => setPreview(null)} />}
  </section>
}
