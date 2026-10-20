import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { KeyRound, Phone, Power, RefreshCw, ShieldCheck, UserPlus, UsersRound, X } from 'lucide-react'
import { api, type CounselorGradeOption, type StudentCounselor } from './api'

const emptyForm = { name: '', identityNumber: '', phone: '', grades: [] as string[] }

export function CounselorAdminCenter() {
  const [counselors, setCounselors] = useState<StudentCounselor[]>([])
  const [gradeOptions, setGradeOptions] = useState<CounselorGradeOption[]>([])
  const [defaultPassword, setDefaultPassword] = useState('12345678')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [editingGrades, setEditingGrades] = useState<StudentCounselor | null>(null)
  const [selectedGrades, setSelectedGrades] = useState<string[]>([])
  const [form, setForm] = useState(emptyForm)

  const load = async () => {
    setBusy('load')
    try {
      const result = await api.counselorAdminOverview()
      setCounselors(result.counselors)
      setGradeOptions(result.grades)
      setDefaultPassword(result.defaultPassword)
    } catch { setError('تعذر تحميل سجل الموجّهين الطلابيين.') }
    finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])

  const createCounselor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy('create'); setError(''); setNotice('')
    try {
      await api.createStudentCounselor(form)
      setShowCreate(false)
      setForm(emptyForm)
      setNotice('تمت إضافة الموجّه إلى السجل. فعّل حسابه ليتمكن من تسجيل الدخول.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error && reason.message === 'counselor_identity_exists' ? 'رقم الهوية مسجل لموجّه طلابي بالفعل.' : 'تعذر حفظ بيانات الموجّه. تأكد من الاسم ورقم الهوية والجوال.')
      setBusy('')
    }
  }
  const activate = async (counselor: StudentCounselor) => {
    setBusy(`activate:${counselor.counselorId}`); setError(''); setNotice('')
    try {
      const result = await api.activateCounselorAccount(counselor.counselorId)
      setNotice(`تم تفعيل حساب ${counselor.name}. كلمة المرور المؤقتة: ${result.temporaryPassword}`)
      await load()
    } catch { setError('تعذر تفعيل حساب الموجّه.') } finally { setBusy('') }
  }
  const reset = async (counselor: StudentCounselor) => {
    setBusy(`reset:${counselor.counselorId}`); setError(''); setNotice('')
    try {
      const result = await api.resetCounselorAccount(counselor.counselorId)
      setNotice(`تمت إعادة ضبط حساب ${counselor.name} إلى كلمة المرور المؤقتة: ${result.temporaryPassword}`)
      await load()
    } catch { setError('تعذر إعادة ضبط حساب الموجّه.') } finally { setBusy('') }
  }
  const setStatus = async (counselor: StudentCounselor) => {
    setBusy(`status:${counselor.counselorId}`); setError('')
    try {
      await api.setCounselorAccountStatus(counselor.counselorId, !counselor.accountActive)
      setNotice(counselor.accountActive ? `تم إيقاف حساب ${counselor.name}.` : `تم تفعيل حساب ${counselor.name}.`)
      await load()
    } catch { setError('تعذر تغيير حالة الحساب.') } finally { setBusy('') }
  }
  const toggleGrade = (grade: string, isLocked: boolean) => {
    if (isLocked) return
    setSelectedGrades(current => current.includes(grade) ? current.filter(value => value !== grade) : [...current, grade])
  }
  const openGrades = (counselor: StudentCounselor) => {
    setError(''); setNotice(''); setEditingGrades(counselor); setSelectedGrades(counselor.assignedGrades)
  }
  const saveGrades = async () => {
    if (!editingGrades || !selectedGrades.length) { setError('اختر مرحلة واحدة على الأقل للموجّه.'); return }
    setBusy(`grades:${editingGrades.counselorId}`); setError(''); setNotice('')
    try {
      await api.setCounselorGrades(editingGrades.counselorId, selectedGrades)
      setEditingGrades(null)
      setNotice(`تم تعيين مراحل ${editingGrades.name}.`)
      await load()
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : ''
      setError(code === 'counselor_grade_taken' ? 'إحدى المراحل المختارة معيّنة لموجّه آخر.' : 'تعذر حفظ مراحل الموجّه. تأكد من الاختيارات ثم أعد المحاولة.')
      setBusy('')
    }
  }

  const visible = useMemo(() => {
    const value = search.trim()
    return value ? counselors.filter(row => `${row.name} ${row.identityNumber} ${row.phone}`.includes(value)) : counselors
  }, [counselors, search])
  const activeAccounts = counselors.filter(row => row.accountCreated && row.accountActive).length
  const pendingAccounts = counselors.filter(row => !row.accountCreated).length
  const renderGradePicker = (values: string[], onToggle: (grade: string, locked: boolean) => void, counselorId = '') => <div className="counselor-grade-picker" role="group" aria-label="المراحل المسؤولة">
    {gradeOptions.map(option => {
      const locked = Boolean(option.counselorId && option.counselorId !== counselorId)
      const checked = values.includes(option.grade)
      const owner = locked ? counselors.find(counselor => counselor.counselorId === option.counselorId)?.name : ''
      return <label key={option.grade} className={`counselor-grade-option ${locked ? 'locked' : ''}`}>
        <input type="checkbox" checked={checked} disabled={locked} onChange={() => onToggle(option.grade, locked)} />
        <span>{option.grade}</span>{locked && <small>مُعيّنة لـ {owner || 'موجّه آخر'}</small>}
      </label>
    })}
    {!gradeOptions.length && <p className="teacher-empty">لا توجد مراحل في سجلات الطلاب لتعيينها.</p>}
  </div>

  return <section className="teacher-admin counselor-admin" dir="rtl">
    <header className="teacher-admin-head"><div><span>إدارة المدرسة / بوابة الموجّه الطلابي</span><h2>الموجّهون الطلابيون</h2><p>أضف الموجّه برقم هويته وجواله، ثم فعّل حسابه المستقل. يغيّر الموجّه كلمة المرور عند أول دخول.</p></div><UsersRound size={31} /></header>
    <div className="student-account-summary counselor-summary"><article><UsersRound size={19} /><span>الموجّهون</span><b>{counselors.length}</b></article><article><ShieldCheck size={19} /><span>حسابات مفعلة</span><b>{activeAccounts}</b></article><article><KeyRound size={19} /><span>بانتظار التفعيل</span><b>{pendingAccounts}</b></article></div>
    <section className="teacher-admin-card counselor-admin-tools"><div><strong>إضافة موجّه طلابي</strong><p>كلمة المرور المؤقتة الموحدة عند تفعيل الحساب هي <b dir="ltr">{defaultPassword}</b>.</p></div><div><button type="button" className="outline-button" onClick={() => void load()} disabled={busy !== ''}><RefreshCw size={16} /> تحديث</button><button type="button" className="primary-button" onClick={() => { setError(''); setShowCreate(true) }} disabled={busy !== ''}><UserPlus size={17} /> إضافة موجّه طلابي</button></div></section>
    {notice && <p className="student-portal-notice success" role="status">{notice}</p>}{error && <p className="student-portal-notice error" role="alert">{error}</p>}
    <input className="student-account-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو رقم الهوية أو الجوال" />
    <div className="teacher-account-list counselor-account-list">{visible.map(counselor => <article key={counselor.counselorId}>
      <div className="teacher-account-avatar">{counselor.name.charAt(0)}</div><div><strong>{counselor.name}</strong><span dir="ltr">{counselor.identityNumber}</span><small><Phone size={12} /> {counselor.phone}</small><small className="counselor-assignment-summary">المراحل: {counselor.assignedGrades.length ? counselor.assignedGrades.join('، ') : 'لم تُعيَّن بعد'}</small></div>
      <span className={`teacher-account-badge ${counselor.accountCreated && counselor.accountActive ? 'ready' : ''}`}>{!counselor.accountCreated ? 'بانتظار التفعيل' : counselor.accountActive ? counselor.mustChangePassword ? 'بانتظار تغيير المرور' : 'نشط' : 'موقوف'}</span>
      <div className="teacher-account-actions"><button type="button" onClick={() => openGrades(counselor)} disabled={busy !== ''}>تعيين المراحل</button>{!counselor.accountCreated ? <button type="button" className="primary-button" onClick={() => void activate(counselor)} disabled={busy !== ''}><KeyRound size={14} /> {busy === `activate:${counselor.counselorId}` ? 'جارٍ التفعيل…' : 'تفعيل الحساب'}</button> : <><button type="button" onClick={() => void reset(counselor)} disabled={busy !== ''}><RefreshCw size={14} /> إعادة ضبط</button><button type="button" onClick={() => void setStatus(counselor)} disabled={busy !== ''}><Power size={14} /> {counselor.accountActive ? 'إيقاف' : 'تفعيل'}</button></>}</div>
    </article>)}</div>
    {!visible.length && <p className="teacher-empty">{busy === 'load' ? 'جارٍ تحميل السجل…' : 'لا يوجد موجّهون مطابقون لهذا البحث.'}</p>}

    {showCreate && <div className="counselor-dialog-backdrop" role="presentation" onMouseDown={() => busy === '' && setShowCreate(false)}><form className="counselor-dialog" onSubmit={createCounselor} onMouseDown={event => event.stopPropagation()}>
      <header><div><span>بوابة الموجّه الطلابي</span><h3>تسجيل موجّه طلابي</h3></div><button type="button" className="icon-button" onClick={() => busy === '' && setShowCreate(false)} aria-label="إغلاق"><X size={18} /></button></header>
      <p>أدخل بيانات الموجّه كما ستظهر في حسابه.</p><label>الاسم الكامل<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} maxLength={180} required autoFocus /></label><label>رقم الهوية<input value={form.identityNumber} onChange={event => setForm(current => ({ ...current, identityNumber: event.target.value.replace(/\D/g, '') }))} inputMode="numeric" pattern="[0-9]*" minLength={6} maxLength={32} required /></label><label>رقم الجوال<input value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} inputMode="tel" maxLength={48} required /></label>
      <section className="counselor-grade-section"><strong>المراحل المسؤولة</strong><p>اختر مرحلة واحدة أو أكثر. المرحلة لا يمكن إسنادها إلا لموجّه واحد.</p>{renderGradePicker(form.grades, (grade, locked) => { if (!locked) setForm(current => ({ ...current, grades: current.grades.includes(grade) ? current.grades.filter(value => value !== grade) : [...current.grades, grade] })) })}</section><footer><button type="button" className="outline-button" onClick={() => setShowCreate(false)} disabled={busy !== ''}>إلغاء</button><button type="submit" className="primary-button" disabled={busy !== '' || !form.grades.length}>{busy === 'create' ? 'جارٍ الحفظ…' : 'تأكيد الإضافة'}</button></footer>
    </form></div>}
    {editingGrades && <div className="counselor-dialog-backdrop" role="presentation" onMouseDown={() => busy === '' && setEditingGrades(null)}><section className="counselor-dialog counselor-grade-dialog" onMouseDown={event => event.stopPropagation()}>
      <header><div><span>بوابة الموجّه الطلابي</span><h3>تعيين المراحل</h3></div><button type="button" className="icon-button" onClick={() => busy === '' && setEditingGrades(null)} aria-label="إغلاق"><X size={18} /></button></header>
      <p>اختر المراحل التي سيتعامل معها {editingGrades.name}. لا يمكن إسناد المرحلة نفسها لأكثر من موجّه.</p>
      <section className="counselor-grade-section">{renderGradePicker(selectedGrades, toggleGrade, editingGrades.counselorId)}</section>
      <footer><button type="button" className="outline-button" onClick={() => setEditingGrades(null)} disabled={busy !== ''}>إلغاء</button><button type="button" className="primary-button" onClick={() => void saveGrades()} disabled={busy !== '' || !selectedGrades.length}>{busy === `grades:${editingGrades.counselorId}` ? 'جارٍ الحفظ…' : 'حفظ التعيين'}</button></footer>
    </section></div>}
  </section>
}