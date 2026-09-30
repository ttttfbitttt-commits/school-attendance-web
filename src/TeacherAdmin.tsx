import { useEffect, useMemo, useState } from 'react'
import { FileDown, KeyRound, Printer, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react'
import { api, type TeacherAdminOverview, type TeacherLessonReport, type TeacherNote } from './api'
import { downloadWorkbook, openPrintDocument } from './SchoolFeatures'

const notes: TeacherNote[] = ['هرب', 'نائم', 'لم يحل الواجب', 'لم يشارك', 'مشارك فعال']
const dayNames = ['', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character))
const periodLabel = (period: number) => `الحصة ${['', 'الأولى', 'الثانية', 'الثالثة', 'الرابعة', 'الخامسة', 'السادسة', 'السابعة', 'الثامنة', 'التاسعة', 'العاشرة'][period] || period}`

function reportsHtml(reports: TeacherLessonReport[]) {
  return reports.map(report => `<section class="page"><div class="heading"><strong>المعلم:</strong> ${escapeHtml(report.teacherName)}<br/>
    <strong>اليوم والتاريخ:</strong> ${escapeHtml(dayNames[report.weekday])} ${escapeHtml(report.date)} &nbsp; | &nbsp;
    <strong>الصف والفصل:</strong> ${escapeHtml(report.grade)} - ${escapeHtml(report.classroomValue)} &nbsp; | &nbsp; ${escapeHtml(periodLabel(report.periodNumber))}</div>
    <table><thead><tr><th>الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead><tbody>${report.records.map(row => `<tr><td>${escapeHtml(row.name)}</td><td>${row.status === 'present' ? 'حاضر' : 'غائب'}</td><td>${escapeHtml(row.note || '—')}</td></tr>`).join('')}</tbody></table>
    <p style="margin-top:28px">توقيع المعلم: ........................................................</p></section>`).join('')
}

export function TeacherAdminCenter({ schoolName }: { schoolName: string }) {
  const [tab, setTab] = useState<'accounts' | 'reports'>('accounts')
  const [overview, setOverview] = useState<TeacherAdminOverview | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [credentials, setCredentials] = useState<Array<{ teacherId: string; name: string; identityNumber: string; temporaryPassword: string }>>([])
  const [options, setOptions] = useState<Array<{ grade: string; classroom: string; count: number }>>([])
  const [mappingChoice, setMappingChoice] = useState<Record<string, string>>({})
  const [reportDate, setReportDate] = useState(today())
  const [reportTeacher, setReportTeacher] = useState('')
  const [reportNote, setReportNote] = useState('')
  const [reports, setReports] = useState<TeacherLessonReport[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = async () => {
    setBusy('overview')
    try {
      const [next, mappings] = await Promise.all([api.teacherAdminOverview(), api.teacherMappingOptions()])
      setOverview(next)
      setOptions(mappings.options)
    } catch { setError('تعذر تحميل بيانات المعلمين. تأكد من استيراد بيانات المعلمين وجدول الفصول في سير الحصص.') } finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])

  const teachers = useMemo(() => (overview?.teachers || []).filter(teacher => `${teacher.name} ${teacher.identityNumber}`.includes(search.trim())).slice(0, 30), [overview, search])
  const unresolvedMappings = useMemo(() => (overview?.classroomMappings || []).filter(mapping => !mapping.grade || !mapping.classroomValue), [overview])

  const toggle = (teacherId: string) => setSelected(current => current.includes(teacherId) ? current.filter(id => id !== teacherId) : [...current, teacherId])
  const generate = async () => {
    const ids = selected.length ? selected : (overview?.teachers || []).filter(teacher => !teacher.accountCreated).map(teacher => teacher.teacherId)
    if (!ids.length) { setNotice('كل المعلمين الظاهرين لديهم حسابات دخول بالفعل.'); return }
    setBusy('generate'); setError(''); setNotice('')
    try {
      const result = await api.generateTeacherAccounts(ids)
      setCredentials(result.credentials)
      setSelected([])
      setNotice(`تم إنشاء ${result.created} حسابًا. سلّم كلمة المرور المؤقتة للمعلم مرة واحدة فقط.`)
      await load()
    } catch { setError('تعذر إنشاء الحسابات. تحقق من استيراد بيانات المعلمين أولًا.') } finally { setBusy('') }
  }
  const reset = async (teacherId: string, name: string) => {
    setBusy(`reset-${teacherId}`); setError('')
    try {
      const result = await api.resetTeacherAccount(teacherId)
      setCredentials([{ teacherId, name, identityNumber: overview?.teachers.find(teacher => teacher.teacherId === teacherId)?.identityNumber || '', temporaryPassword: result.temporaryPassword }])
      setNotice('تم إيقاف الجلسات السابقة وإنشاء كلمة مرور مؤقتة جديدة.')
      await load()
    } catch { setError('تعذر إعادة ضبط الحساب.') } finally { setBusy('') }
  }
  const setStatus = async (teacherId: string, active: boolean) => {
    setBusy(`status-${teacherId}`)
    try { await api.setTeacherAccountStatus(teacherId, active); await load() } catch { setError('تعذر تحديث حالة الحساب.') } finally { setBusy('') }
  }
  const saveMapping = async (classroomId: string) => {
    const choice = mappingChoice[classroomId]
    const option = options.find(value => `${value.grade}|||${value.classroom}` === choice)
    if (!option) { setError('اختر صفًا وفصلًا من بيانات الطلاب أولًا.'); return }
    setBusy(`map-${classroomId}`)
    try { await api.saveTeacherClassroomMapping({ classroomId, grade: option.grade, classroom: option.classroom }); setNotice('تم ربط طلاب الفصل وحفظه.'); await load() } catch { setError('تعذر حفظ ربط الفصل.') } finally { setBusy('') }
  }
  const loadReports = async () => {
    setBusy('reports'); setError('')
    try { setReports((await api.teacherAdminReports({ date: reportDate, teacherId: reportTeacher, note: reportNote })).reports) } catch { setError('تعذر تحميل التقارير.') } finally { setBusy('') }
  }
  const exportReports = () => downloadWorkbook(`تقارير-المعلمين-${reportDate}`, [
    ['المعلم', 'التاريخ', 'الحصة', 'الصف والفصل', 'الطالب', 'الحالة', 'الملاحظة'],
    ...reports.flatMap(report => report.records.map(row => [report.teacherName, report.date, periodLabel(report.periodNumber), `${report.grade} - ${report.classroomValue}`, row.name, row.status === 'present' ? 'حاضر' : 'غائب', row.note || '—'])),
  ], 'تقارير المعلمين', schoolName, 'تقارير متابعة المعلمين')

  return <section className="teacher-admin" dir="rtl">
    <div className="teacher-admin-head"><div><span>إدارة المدرسة / المعلمون</span><h2>المعلمون</h2><p>الحسابات مرتبطة ببيانات المعلمين والجداول التي استوردتها في «سير الحصص».</p></div><UsersRound size={31} /></div>
    <div className="teacher-admin-tabs"><button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>حسابات الدخول</button><button className={tab === 'reports' ? 'active' : ''} onClick={() => setTab('reports')}>تقارير المعلمين</button></div>
    {notice && <div className="teacher-notice success">{notice}</div>}{error && <div className="teacher-notice error">{error}</div>}

    {tab === 'accounts' && <>
      <section className="teacher-admin-card">
        <div className="teacher-section-head"><div><span>حسابات مستقلة</span><h3>توليد دخول المعلمين</h3></div><button className="primary-button" onClick={() => void generate()} disabled={busy === 'generate'}><KeyRound size={17} /> {busy === 'generate' ? 'جارٍ الإنشاء…' : selected.length ? `توليد ${selected.length} حساب` : 'توليد الحسابات غير المنشأة'}</button></div>
        <p className="teacher-help">الدخول برقم الهوية وكلمة مرور مؤقتة مختلفة لكل معلم. يغيّرها المعلم عند أول دخول.</p>
        <div className="teacher-admin-tools"><label><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو رقم الهوية" /></label><button className="outline-button" onClick={() => void load()}><RefreshCw size={16} /> تحديث</button></div>
        {busy === 'overview' ? <p className="teacher-empty">جارٍ التحميل…</p> : <div className="teacher-account-list">{teachers.map(teacher => <article key={teacher.teacherId}>
          <label className="teacher-check"><input type="checkbox" checked={selected.includes(teacher.teacherId)} onChange={() => toggle(teacher.teacherId)} /></label>
          <div><strong>{teacher.name}</strong><span>هوية: {teacher.identityNumber} · {teacher.assignments} حصة مرتبطة</span></div>
          <span className={`teacher-account-badge ${teacher.accountCreated ? teacher.accountActive ? 'active' : 'disabled' : 'pending'}`}>{teacher.accountCreated ? teacher.accountActive ? 'مفعل' : 'موقوف' : 'غير منشأ'}</span>
          <div className="teacher-account-actions">{teacher.accountCreated && <><button onClick={() => void reset(teacher.teacherId, teacher.name)} disabled={busy === `reset-${teacher.teacherId}`}>إعادة ضبط</button><button onClick={() => void setStatus(teacher.teacherId, !teacher.accountActive)} disabled={busy === `status-${teacher.teacherId}`}>{teacher.accountActive ? 'إيقاف' : 'تفعيل'}</button></>}</div>
        </article>)}</div>}
      </section>

      {credentials.length > 0 && <section className="teacher-credentials"><div><ShieldCheck size={22} /><div><h3>بيانات دخول تسلّم مرة واحدة</h3><p>لا تحفظ كلمة المرور في الشاشة بعد إغلاق هذا التنبيه.</p></div><button onClick={() => setCredentials([])}>إخفاء</button></div><div>{credentials.map(credential => <p key={credential.teacherId}><strong>{credential.name}</strong> — رقم الهوية: <b dir="ltr">{credential.identityNumber}</b> — كلمة المرور المؤقتة: <b dir="ltr">{credential.temporaryPassword}</b></p>)}</div></section>}

      {unresolvedMappings.length > 0 && <section className="teacher-admin-card teacher-mapping-card"><div className="teacher-section-head"><div><span>يلزم مرة واحدة</span><h3>مطابقة طلاب الفصول</h3></div></div><p className="teacher-help">لم يتم التعرف تلقائيًا على صف وفصل بعض جداول الحصص. اختر المجموعة الصحيحة ليظهر للمعلم طلاب فصله فقط.</p><div className="teacher-mapping-list">{unresolvedMappings.map(mapping => <article key={mapping.classroomId}><strong>{mapping.classroom}</strong><select value={mappingChoice[mapping.classroomId] || ''} onChange={event => setMappingChoice(current => ({ ...current, [mapping.classroomId]: event.target.value }))}><option value="">اختر الصف والفصل</option>{options.map(option => <option key={`${option.grade}-${option.classroom}`} value={`${option.grade}|||${option.classroom}`}>{option.grade} — الفصل {option.classroom} ({option.count} طالب)</option>)}</select><button className="primary-button" onClick={() => void saveMapping(mapping.classroomId)} disabled={busy === `map-${mapping.classroomId}`}>حفظ الربط</button></article>)}</div></section>}
    </>}

    {tab === 'reports' && <section className="teacher-admin-card">
      <div className="teacher-section-head"><div><span>مستقلة عن سجل الحضور</span><h3>تقارير متابعة المعلمين</h3></div><div className="teacher-report-actions"><button className="outline-button" onClick={() => { if (reports.length) openPrintDocument('تقارير متابعة المعلمين', reportsHtml(reports), schoolName) }} disabled={!reports.length}><Printer size={17} /> PDF</button><button className="outline-button" onClick={exportReports} disabled={!reports.length}><FileDown size={17} /> Excel</button></div></div>
      <div className="teacher-report-filters"><label>التاريخ<input type="date" value={reportDate} onChange={event => setReportDate(event.target.value)} /></label><label>المعلم<select value={reportTeacher} onChange={event => setReportTeacher(event.target.value)}><option value="">كل المعلمين</option>{(overview?.teachers || []).map(teacher => <option key={teacher.teacherId} value={teacher.teacherId}>{teacher.name}</option>)}</select></label><label>الملاحظة<select value={reportNote} onChange={event => setReportNote(event.target.value)}><option value="">كل الملاحظات</option>{notes.map(note => <option key={note} value={note}>{note}</option>)}</select></label><button className="primary-button" onClick={() => void loadReports()} disabled={busy === 'reports'}>{busy === 'reports' ? 'جارٍ العرض…' : 'عرض التقارير'}</button></div>
      {!reports.length ? <p className="teacher-empty">اختر عوامل التقرير ثم اضغط «عرض التقارير».</p> : <div className="teacher-report-list">{reports.slice(0, 50).map(report => <article key={report.id}><div><strong>{report.teacherName} · {periodLabel(report.periodNumber)} · {report.classroom}</strong><span>{report.date} · {report.presentCount} حاضر · {report.absentCount} غائب</span></div><button onClick={() => openPrintDocument('كشف متابعة طلاب الفصل', reportsHtml([report]), schoolName)} title="طباعة التقرير"><Printer size={17} /></button></article>)}</div>}
    </section>}
  </section>
}
