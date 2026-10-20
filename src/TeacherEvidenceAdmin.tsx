import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BookOpenCheck, FileImage, Printer, RefreshCw, Search } from 'lucide-react'
import { api, type TeacherEvidenceAdminRecords, type TeacherEvidenceAdminTeacher, type TeacherEvidenceRecord } from './api'
import { openPrintDocument } from './SchoolFeatures'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character))

function evidenceReportHtml(teacher: TeacherEvidenceAdminRecords['teacher'], records: TeacherEvidenceRecord[]) {
  return records.map((record, index) => {
    const details = [
      ['الاستراتيجية المتبعة', record.strategy],
      ['تبادل الزيارات مع', record.visitTeacherName],
      ['بحضور وكيل المدرسة', record.vicePrincipalName],
      ['رائد النشاط', record.activityLeaderName],
      ['ملاحظات إضافية', record.notes],
    ].filter(([, value]) => value)
    const images = record.images.length
      ? `<div class="evidence-print-images">${record.images.map(image => `<figure><img src="${escapeHtml(image.fileUrl)}" alt="صورة شاهد ${image.slotNumber}" /></figure>`).join('')}</div>`
      : '<p class="evidence-print-empty">لم تُضف صور لهذا الشاهد.</p>'
    const styles = index === 0 ? '<style>.evidence-print-page{color:#143e60}.evidence-print-heading{padding:2mm 0 5mm;border-bottom:1mm solid #1980c8;text-align:center}.evidence-print-heading span{color:#1978b5;font-size:11px;font-weight:700}.evidence-print-heading h2{margin:2mm 0;color:#092f54;font-size:21px}.evidence-print-heading p{margin:0;color:#526b7d;font-size:13px}.evidence-print-images{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin:5mm 0}.evidence-print-images figure{height:72mm;margin:0;overflow:hidden;border:1px solid #d5e3ed;border-radius:3mm;background:#f8fbfd}.evidence-print-images img{display:block;width:100%;height:100%;object-fit:cover}.evidence-print-empty{margin:5mm 0;padding:5mm;border:1px dashed #c7d8e4;border-radius:3mm;color:#718697;text-align:center}.evidence-print-details{display:grid;grid-template-columns:1fr 1fr;gap:3mm;margin:0}.evidence-print-details>div{padding:3mm;border:1px solid #d7e4ec;border-radius:3mm}.evidence-print-details>div:last-child:nth-child(odd){grid-column:1/-1}.evidence-print-details dt{color:#4d7189;font-size:11px;font-weight:700}.evidence-print-details dd{margin:1.5mm 0 0;color:#153d5d;line-height:1.7;white-space:pre-wrap}.evidence-print-footer{margin:5mm 0 0;color:#718697;font-size:10px;text-align:center}</style>' : ''
    return `${styles}<section class="page evidence-print-page"><div class="evidence-print-heading"><span>شاهد تربوي ${index + 1}</span><h2>${escapeHtml(record.title)}</h2><p><strong>المعلم:</strong> ${escapeHtml(teacher.name)} &nbsp; | &nbsp; <strong>الصف والفصل:</strong> ${escapeHtml(record.grade)} · الفصل ${escapeHtml(record.classroom)}</p></div>${images}${details.length ? `<dl class="evidence-print-details">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}<p class="evidence-print-footer">تم إنشاء هذا التقرير من نظام الحصر</p></section>`
  }).join('')
}

export function TeacherEvidenceAdmin({ schoolName, loadTeachers = api.teacherAdminEvidence, loadRecords = api.teacherAdminEvidenceRecords }: {
  schoolName: string
  loadTeachers?: () => Promise<{ teachers: TeacherEvidenceAdminTeacher[] }>
  loadRecords?: (teacherId: string) => Promise<TeacherEvidenceAdminRecords>
}) {
  const [teachers, setTeachers] = useState<TeacherEvidenceAdminTeacher[]>([])
  const [selected, setSelected] = useState<TeacherEvidenceAdminRecords | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<'load' | 'report' | ''>('load')
  const [error, setError] = useState('')

  const load = async () => {
    setBusy('load')
    setError('')
    try {
      const result = await loadTeachers()
      setTeachers(result.teachers)
    } catch {
      setError('تعذر تحميل شواهد المعلمين. حدّث الصفحة ثم أعد المحاولة.')
    } finally {
      setBusy('')
    }
  }
  useEffect(() => { void load() }, [loadTeachers])

  const filteredTeachers = useMemo(() => {
    const query = search.trim()
    if (!query) return teachers
    return teachers.filter(teacher => `${teacher.name} ${teacher.identityNumber}`.includes(query))
  }, [teachers, search])

  const showTeacher = async (teacherId: string) => {
    setBusy('report')
    setError('')
    try {
      setSelected(await loadRecords(teacherId))
    } catch {
      setError('تعذر عرض شواهد هذا المعلم.')
    } finally {
      setBusy('')
    }
  }

  if (selected) {
    const records = selected.records
    return <section className="teacher-admin-card teacher-evidence-admin" dir="rtl">
      <div className="teacher-section-head teacher-evidence-admin-report-head">
        <div>
          <button type="button" className="outline-button" onClick={() => setSelected(null)}><ArrowRight size={16} /> العودة إلى قائمة المعلمين</button>
          <span>توثيق أداء المعلم</span>
          <h3>شواهد {selected.teacher.name}</h3>
          <p>هوية المعلم: {selected.teacher.identityNumber} · {records.length} {records.length === 1 ? 'شاهد محفوظ' : 'شواهد محفوظة'}</p>
        </div>
        <button type="button" className="primary-button" disabled={!records.length} onClick={() => openPrintDocument(`شواهد المعلم ${selected.teacher.name}`, evidenceReportHtml(selected.teacher, records), schoolName)}><Printer size={17} /> طباعة / حفظ PDF</button>
      </div>
      {!records.length ? <div className="teacher-empty teacher-evidence-admin-empty"><BookOpenCheck size={26} /><strong>لا توجد شواهد محفوظة لهذا المعلم حتى الآن.</strong><span>تظهر هنا الشواهد فور حفظها من بوابة المعلم.</span></div> : <div className="teacher-evidence-admin-records">{records.map(record => {
        const details = [
          ['الاستراتيجية المتبعة', record.strategy],
          ['تبادل الزيارات مع', record.visitTeacherName],
          ['بحضور وكيل المدرسة', record.vicePrincipalName],
          ['رائد النشاط', record.activityLeaderName],
          ['ملاحظات إضافية', record.notes],
        ].filter(([, value]) => value)
        return <article key={record.id}>
          <header><span>الشاهد {record.slotNumber}</span><h4>{record.title}</h4><p>{record.grade} · الفصل {record.classroom}</p></header>
          {record.images.length ? <div className="teacher-evidence-report-images">{record.images.map(image => <figure key={image.slotNumber}><img src={image.fileUrl} alt={`صورة شاهد ${image.slotNumber}`} /></figure>)}</div> : <p className="teacher-evidence-empty-images">لم تُضف صور لهذا الشاهد.</p>}
          {details.length > 0 && <dl className="teacher-evidence-report-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
        </article>
      })}</div>}
    </section>
  }

  return <section className="teacher-admin-card teacher-evidence-admin" dir="rtl">
    <div className="teacher-section-head">
      <div><span>توثيق أداء المعلمين</span><h3>شواهد المعلمين</h3><p>اختر المعلم لعرض شواهده المحفوظة وتصديرها في تقرير PDF.</p></div>
      <button type="button" className="outline-button" onClick={() => void load()} disabled={busy === 'load'}><RefreshCw size={16} /> تحديث</button>
    </div>
    {error && <p className="teacher-notice error">{error}</p>}
    <div className="teacher-admin-tools teacher-evidence-admin-tools"><label><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم المعلم أو رقم الهوية" /></label></div>
    {busy === 'load' ? <p className="teacher-empty">جارٍ تحميل أسماء المعلمين…</p> : !filteredTeachers.length ? <p className="teacher-empty">لا توجد أسماء مطابقة للبحث.</p> : <div className="teacher-evidence-admin-list">{filteredTeachers.map(teacher => <article key={teacher.teacherId}><div><strong>{teacher.name}</strong><span>هوية: {teacher.identityNumber}</span></div><b>{teacher.evidenceCount} {teacher.evidenceCount === 1 ? 'شاهد' : 'شواهد'}</b><button type="button" className="outline-button" disabled={busy === 'report'} onClick={() => void showTeacher(teacher.teacherId)}><FileImage size={16} /> عرض الشواهد</button></article>)}</div>}
  </section>
}
