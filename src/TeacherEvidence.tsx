import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Image as ImageIcon, Plus, Printer, RefreshCw, Save, Trash2 } from 'lucide-react'
import { api, type TeacherEvidenceOverview, type TeacherEvidenceRecord } from './api'

type EvidenceView = 'cards' | 'form' | 'report'
type EvidenceDraft = { grade: string; classroom: string; title: string; strategy: string; visitTeacherId: string; vicePrincipalId: string; activityLeaderName: string; notes: string }
type DraftImage = { url: string; data?: string; existing: boolean }

const emptyDraft = (): EvidenceDraft => ({ grade: '', classroom: '', title: '', strategy: '', visitTeacherId: '', vicePrincipalId: '', activityLeaderName: '', notes: '' })
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))
const imageBytes = (data: string) => Math.max(0, Math.floor((data.length - data.indexOf(',') - 1) * .75))

async function compressedImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('invalid_image')
  const sourceUrl = URL.createObjectURL(file)
  try {
    const source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('invalid_image'))
      image.src = sourceUrl
    })
    let width = Math.min(source.naturalWidth || 1, 1600)
    let height = Math.max(1, Math.round((source.naturalHeight || 1) * (width / (source.naturalWidth || 1))))
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('canvas_unavailable')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      context.drawImage(source, 0, 0, width, height)
      const data = canvas.toDataURL('image/jpeg', Math.max(.58, .8 - attempt * .07))
      if (imageBytes(data) <= 900_000 || attempt === 3) {
        if (imageBytes(data) > 1_000_000) throw new Error('image_too_large')
        return data
      }
      width = Math.max(720, Math.round(width * .78))
      height = Math.max(540, Math.round(height * .78))
    }
    throw new Error('image_too_large')
  } finally { URL.revokeObjectURL(sourceUrl) }
}

export function TeacherEvidence({ schoolName, teacherName, onPrint }: { schoolName: string; teacherName: string; onPrint: (html: string) => void }) {
  const [overview, setOverview] = useState<TeacherEvidenceOverview | null>(null)
  const [view, setView] = useState<EvidenceView>('cards')
  const [slotNumber, setSlotNumber] = useState(1)
  const [activeRecord, setActiveRecord] = useState<TeacherEvidenceRecord | null>(null)
  const [draft, setDraft] = useState<EvidenceDraft>(emptyDraft())
  const [images, setImages] = useState<Record<number, DraftImage>>({})
  const [deletedSlots, setDeletedSlots] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<'load' | 'save' | ''>('load')
  const [error, setError] = useState('')

  const load = async () => {
    setBusy('load')
    setError('')
    try { setOverview(await api.teacherEvidence()) } catch { setError('تعذر تحميل الشواهد. حدّث الصفحة ثم أعد المحاولة.') } finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])

  const recordBySlot = useMemo(() => new Map((overview?.records || []).map(record => [record.slotNumber, record])), [overview])
  const classrooms = useMemo(() => overview?.options.classes.find(item => item.grade === draft.grade)?.classrooms || [], [overview, draft.grade])
  const update = (key: keyof EvidenceDraft, value: string) => setDraft(current => ({ ...current, [key]: value }))
  const openForm = (slot: number, record: TeacherEvidenceRecord | null) => {
    setSlotNumber(slot)
    setActiveRecord(record)
    setDraft(record ? {
      grade: record.grade, classroom: record.classroom, title: record.title, strategy: record.strategy,
      visitTeacherId: record.visitTeacherId || '', vicePrincipalId: record.vicePrincipalId || '',
      activityLeaderName: record.activityLeaderName || '', notes: record.notes || '',
    } : emptyDraft())
    setImages(record ? Object.fromEntries(record.images.map(image => [image.slotNumber, { url: image.fileUrl, existing: true }])) : {})
    setDeletedSlots(new Set())
    setError('')
    setView('form')
  }
  const chooseImage = async (imageSlot: number, file?: File) => {
    if (!file) return
    try {
      const data = await compressedImage(file)
      setImages(current => ({ ...current, [imageSlot]: { url: data, data, existing: false } }))
      setDeletedSlots(current => { const next = new Set(current); next.delete(imageSlot); return next })
      setError('')
    } catch {
      setError('تعذر تجهيز الصورة. اختر صورة واضحة بحجم أصغر من 1 ميجابايت بعد الضغط.')
    }
  }
  const removeImage = (imageSlot: number) => {
    const item = images[imageSlot]
    setImages(current => { const next = { ...current }; delete next[imageSlot]; return next })
    if (item?.existing) setDeletedSlots(current => new Set(current).add(imageSlot))
  }
  const save = async () => {
    if (!draft.grade || !draft.classroom || !draft.title.trim()) { setError('اختر الصف والفصل واكتب عنوان الدرس أو النشاط أولًا.'); return }
    setBusy('save')
    setError('')
    try {
      const result = await api.saveTeacherEvidence({
        slotNumber, ...draft,
        images: Object.entries(images).flatMap(([key, image]) => image.data ? [{ slotNumber: Number(key), image: image.data }] : []),
        deleteSlots: [...deletedSlots],
      })
      setOverview(current => current ? { ...current, records: [...current.records.filter(record => record.slotNumber !== result.record.slotNumber), result.record].sort((first, second) => first.slotNumber - second.slotNumber) } : current)
      setActiveRecord(result.record)
      setView('report')
    } catch {
      setError('تعذر حفظ الشاهد. تحقق من الاتصال وأن الصور لا تتجاوز الحجم المسموح.')
    } finally { setBusy('') }
  }
  const printEvidence = (record: TeacherEvidenceRecord) => {
    const details = [
      ['الاستراتيجية المتبعة', record.strategy],
      ['تبادل الزيارات مع', record.visitTeacherName],
      ['بحضور وكيل المدرسة', record.vicePrincipalName],
      ['رائد النشاط', record.activityLeaderName],
      ['ملاحظات إضافية', record.notes],
    ].filter(([, value]) => value)
    onPrint(`<section class="teacher-evidence-print"><header><span>بوابة المعلم · شاهد تربوي</span><h1>${escapeHtml(record.title)}</h1><p>${escapeHtml(schoolName)}</p></header><div class="teacher-evidence-print-meta"><div><span>المعلم</span><strong>${escapeHtml(teacherName)}</strong></div><div><span>الصف والفصل</span><strong>${escapeHtml(record.grade)} · الفصل ${escapeHtml(record.classroom)}</strong></div></div>${record.images.length ? `<div class="teacher-evidence-print-images">${record.images.map(image => `<figure><img src="${escapeHtml(image.fileUrl)}" alt="صورة شاهد ${image.slotNumber}" /></figure>`).join('')}</div>` : '<p class="teacher-evidence-print-empty">لم تُضف صور لهذا الشاهد.</p>'}${details.length ? `<dl class="teacher-evidence-print-details">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}<footer>تم إنشاء هذا الشاهد من نظام الحصر</footer></section>`)
  }

  if (busy === 'load') return <section className="teacher-card teacher-evidence"><p className="teacher-empty">جارٍ تحميل الشواهد…</p></section>
  if (!overview) return <section className="teacher-card teacher-evidence"><div className="teacher-section-head"><div><span>توثيق الأداء</span><h2>الشواهد</h2></div><button type="button" className="outline-button" onClick={() => void load()}><RefreshCw size={16} /> تحديث</button></div><p className="teacher-notice error">{error || 'تعذر تحميل الشواهد.'}</p></section>

  if (view === 'cards') return <section className="teacher-card teacher-evidence" dir="rtl"><div className="teacher-section-head"><div><span>توثيق الأداء</span><h2>الشواهد</h2><p>أضف حتى أربعة شواهد مصورة، ثم اعرض كل شاهد في تقرير جاهز للطباعة.</p></div><button type="button" className="outline-button" onClick={() => void load()}><RefreshCw size={16} /> تحديث</button></div>{error && <p className="teacher-notice error">{error}</p>}<div className="teacher-evidence-card-grid">{[1, 2, 3, 4].map(slot => { const record = recordBySlot.get(slot); return <button type="button" className={`teacher-evidence-card ${record ? 'saved' : ''}`} key={slot} onClick={() => record ? (setActiveRecord(record), setView('report')) : openForm(slot, null)}>{record ? <><ImageIcon size={27} /><span>الشاهد {slot}</span><strong>{record.title}</strong><small>{record.grade} · الفصل {record.classroom}</small></> : <><Plus size={29} /><span>الشاهد {slot}</span><strong>إضافة شاهد</strong><small>أضف الصور وبيانات الدرس أو النشاط</small></>}</button> })}</div></section>

  if (view === 'form') return <section className="teacher-card teacher-evidence" dir="rtl"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={() => setView('cards')}><ArrowRight size={16} /> العودة إلى الشواهد</button><span>{activeRecord ? 'تعديل شاهد' : 'شاهد جديد'}</span><h2>{activeRecord ? activeRecord.title : `إضافة الشاهد ${slotNumber}`}</h2><p>أضف الصور ثم بيانات التوثيق. تُضغط الصور تلقائيًا قبل الحفظ.</p></div><ImageIcon size={30} /></div>{error && <p className="teacher-notice error">{error}</p>}<div className="teacher-evidence-image-grid">{[1, 2, 3, 4].map(imageSlot => { const image = images[imageSlot]; return <div className={`teacher-evidence-image-slot ${image ? 'filled' : ''}`} key={imageSlot}>{image ? <><img src={image.url} alt={`صورة الشاهد ${imageSlot}`} /><button type="button" className="teacher-evidence-remove-image" onClick={() => removeImage(imageSlot)} aria-label={`حذف الصورة ${imageSlot}`}><Trash2 size={16} /></button></> : <label><ImageIcon size={24} /><strong>الصورة {imageSlot}</strong><small>اضغط لاختيار صورة</small><input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => { void chooseImage(imageSlot, event.target.files?.[0]); event.currentTarget.value = '' }} /></label>}</div> })}</div><div className="teacher-evidence-form-grid"><label><span>الصف أو المرحلة</span><select value={draft.grade} onChange={event => { update('grade', event.target.value); update('classroom', '') }}><option value="">اختر الصف</option>{overview.options.classes.map(item => <option key={item.grade} value={item.grade}>{item.grade}</option>)}</select></label><label><span>الفصل</span><select value={draft.classroom} disabled={!draft.grade} onChange={event => update('classroom', event.target.value)}><option value="">اختر الفصل</option>{classrooms.map(classroom => <option key={classroom} value={classroom}>{classroom}</option>)}</select></label><label className="wide"><span>عنوان الدرس أو النشاط</span><input value={draft.title} maxLength={240} onChange={event => update('title', event.target.value)} placeholder="مثال: التعلم التعاوني في درس ..." /></label><label className="wide"><span>الاستراتيجية المتبعة</span><textarea value={draft.strategy} maxLength={1200} onChange={event => update('strategy', event.target.value)} placeholder="اكتب الاستراتيجية أو أسلوب التنفيذ" /></label><label className="wide"><span>تبادل الزيارات مع معلم</span><select value={draft.visitTeacherId} onChange={event => update('visitTeacherId', event.target.value)}><option value="">لا يوجد</option>{overview.options.teachers.map(teacher => <option key={teacher.teacherId} value={teacher.teacherId}>{teacher.name}</option>)}</select></label><label><span>بحضور وكيل المدرسة</span><select value={draft.vicePrincipalId} onChange={event => update('vicePrincipalId', event.target.value)}><option value="">لا يوجد</option>{overview.options.vicePrincipals.map(vicePrincipal => <option key={vicePrincipal.vicePrincipalId} value={vicePrincipal.vicePrincipalId}>{vicePrincipal.name}</option>)}</select></label><label><span>رائد النشاط</span><input value={draft.activityLeaderName} maxLength={200} onChange={event => update('activityLeaderName', event.target.value)} placeholder="يُربط بحسابه لاحقًا" /></label><label className="wide"><span>ملاحظات إضافية</span><textarea value={draft.notes} maxLength={4000} onChange={event => update('notes', event.target.value)} placeholder="اكتب أي معلومة إضافية ترغب بإظهارها في التقرير" /></label></div><div className="teacher-evidence-form-actions"><button type="button" className="outline-button" onClick={() => setView('cards')}>إلغاء</button><button type="button" className="primary-button" disabled={busy === 'save'} onClick={() => void save()}><Save size={17} /> {busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ الشاهد'}</button></div></section>

  if (!activeRecord) return null
  const details = [['الاستراتيجية المتبعة', activeRecord.strategy], ['تبادل الزيارات مع', activeRecord.visitTeacherName], ['بحضور وكيل المدرسة', activeRecord.vicePrincipalName], ['رائد النشاط', activeRecord.activityLeaderName], ['ملاحظات إضافية', activeRecord.notes]].filter(([, value]) => value)
  return <section className="teacher-card teacher-evidence teacher-evidence-report" dir="rtl"><div className="teacher-section-head"><div><button type="button" className="outline-button" onClick={() => setView('cards')}><ArrowRight size={16} /> العودة إلى الشواهد</button><span>شاهد تربوي</span><h2>{activeRecord.title}</h2><p>{activeRecord.grade} · الفصل {activeRecord.classroom}</p></div><div className="teacher-evidence-report-actions"><button type="button" className="outline-button" onClick={() => openForm(activeRecord.slotNumber, activeRecord)}>تعديل</button><button type="button" className="primary-button" onClick={() => printEvidence(activeRecord)}><Printer size={17} /> PDF</button></div></div><div className="teacher-evidence-report-meta"><div><span>المعلم</span><strong>{teacherName}</strong></div><div><span>الصف والفصل</span><strong>{activeRecord.grade} · الفصل {activeRecord.classroom}</strong></div></div>{activeRecord.images.length ? <div className="teacher-evidence-report-images">{activeRecord.images.map(image => <figure key={image.slotNumber}><img src={image.fileUrl} alt={`صورة شاهد ${image.slotNumber}`} /></figure>)}</div> : <p className="teacher-evidence-empty-images">لم تُضف صور لهذا الشاهد.</p>}{details.length > 0 && <dl className="teacher-evidence-report-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</section>
}
