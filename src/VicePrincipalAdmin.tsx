import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { KeyRound, Power, RefreshCw, ShieldCheck, Trash2, UserPlus, UsersRound, X } from 'lucide-react'
import { api, type SchoolVicePrincipal, type VicePrincipalGradeOption } from './api'

const emptyForm = { name: '', identityNumber: '', phone: '', grades: [] as string[] }

export function VicePrincipalAdminCenter() {
  const [vicePrincipals, setVicePrincipals] = useState<SchoolVicePrincipal[]>([])
  const [gradeOptions, setGradeOptions] = useState<VicePrincipalGradeOption[]>([])
  const [defaultPassword, setDefaultPassword] = useState('12345678')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<SchoolVicePrincipal | null>(null)
  const [selectedGrades, setSelectedGrades] = useState<string[]>([])
  const [transferGrades, setTransferGrades] = useState<string[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = async () => {
    setBusy('load')
    try {
      const result = await api.vicePrincipalAdminOverview()
      setVicePrincipals(result.vicePrincipals)
      setGradeOptions(result.grades)
      setDefaultPassword(result.defaultPassword)
    } catch { setError('تعذر تحميل سجلات وكلاء المدرسة.') }
    finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])

  const shown = useMemo(() => {
    const term = search.trim()
    return term ? vicePrincipals.filter(item => `${item.name} ${item.identityNumber} ${item.phone} ${item.assignedGrades.join(' ')}`.includes(term)) : vicePrincipals
  }, [search, vicePrincipals])

  const toggleGrade = (grade: string, values: string[], save: (values: string[]) => void) => {
    save(values.includes(grade) ? values.filter(value => value !== grade) : [...values, grade])
  }

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('')
    try {
      await api.createVicePrincipal(form)
      setForm(emptyForm); setShowCreate(false)
      setNotice('تمت إضافة وكيل المدرسة. فعّل الحساب ليتمكن من تسجيل الدخول.')
      await load()
    } catch (reason) {
      const code = (reason as Error & { code?: string }).code
      setError(code === 'vice_principal_identity_exists' ? 'رقم السجل المدني مسجل لوكيل مدرسة بالفعل.' : code === 'vice_principal_grade_taken' ? 'إحدى المراحل المختارة مسندة لوكيل آخر.' : 'تعذر حفظ البيانات. تحقق من الاسم والسجل المدني والجوال والمراحل.')
      setBusy('')
    }
  }
  const activate = async (item: SchoolVicePrincipal) => {
    setBusy(`activate:${item.vicePrincipalId}`); setError(''); setNotice('')
    try { const result = await api.activateVicePrincipalAccount(item.vicePrincipalId); setNotice(`تم تفعيل حساب ${item.name}. كلمة المرور المؤقتة: ${result.temporaryPassword}`); await load() }
    catch { setError('تعذر تفعيل الحساب.') }
    finally { setBusy('') }
  }
  const reset = async (item: SchoolVicePrincipal) => {
    setBusy(`reset:${item.vicePrincipalId}`); setError(''); setNotice('')
    try { const result = await api.resetVicePrincipalAccount(item.vicePrincipalId); setNotice(`تمت إعادة ضبط كلمة مرور ${item.name}: ${result.temporaryPassword}`); await load() }
    catch { setError('تعذر إعادة ضبط كلمة المرور.') }
    finally { setBusy('') }
  }
  const changeStatus = async (item: SchoolVicePrincipal) => {
    setBusy(`status:${item.vicePrincipalId}`); setError('')
    try { await api.setVicePrincipalAccountStatus(item.vicePrincipalId, !item.accountActive); setNotice(item.accountActive ? 'تم إيقاف الحساب.' : 'تم تشغيل الحساب.'); await load() }
    catch { setError('تعذر تعديل حالة الحساب.') }
    finally { setBusy('') }
  }
  const openGrades = (item: SchoolVicePrincipal) => {
    setError(''); setNotice(''); setEditing(item); setSelectedGrades(item.assignedGrades); setTransferGrades([])
  }
  const toggleTransfer = (grade: string) => {
    const included = selectedGrades.includes(grade)
    setSelectedGrades(current => included ? current.filter(value => value !== grade) : [...current, grade])
    setTransferGrades(current => included ? current.filter(value => value !== grade) : [...current, grade])
  }
  const saveGrades = async () => {
    if (!editing) return
    setBusy('grades'); setError(''); setNotice('')
    try {
      await api.setVicePrincipalGrades(editing.vicePrincipalId, selectedGrades, transferGrades)
      setEditing(null)
      setNotice(selectedGrades.length ? `تم تحديث مراحل ${editing.name}.` : `تم إلغاء جميع مراحل ${editing.name}.`)
      await load()
    } catch (reason) {
      const code = (reason as Error & { code?: string }).code
      setError(code === 'vice_principal_grade_taken' ? 'إحدى المراحل مسندة لوكيل آخر. استخدم زر النقل داخل المرحلة لنقلها مباشرة.' : 'تعذر حفظ مراحل الوكيل.')
      setBusy('')
    }
  }
  const remove = async (item: SchoolVicePrincipal) => {
    if (!window.confirm(`سيُحذف حساب الوكيل «${item.name}» وجميع مراحله، ولن يتمكن من الدخول. هل تريد المتابعة؟`)) return
    setBusy(`delete:${item.vicePrincipalId}`); setError(''); setNotice('')
    try { await api.deleteVicePrincipal(item.vicePrincipalId); setNotice(`تم حذف حساب ${item.name} وإلغاء مراحله.`); await load() }
    catch { setError('تعذر حذف حساب الوكيل.') }
    finally { setBusy('') }
  }

  const gradePicker = (values: string[], setValues: (values: string[]) => void, vicePrincipalId = '', transfer = false) => <div className="counselor-grade-picker" role="group" aria-label="المراحل المسؤولة">
    {gradeOptions.map(option => {
      const locked = Boolean(option.vicePrincipalId && option.vicePrincipalId !== vicePrincipalId)
      const owner = locked ? vicePrincipals.find(item => item.vicePrincipalId === option.vicePrincipalId)?.name : ''
      const beingTransferred = transferGrades.includes(option.grade)
      return <div key={option.grade} className={`counselor-grade-option ${locked ? 'locked' : ''}`}>
        <label><input type="checkbox" checked={values.includes(option.grade)} disabled={locked} onChange={() => toggleGrade(option.grade, values, setValues)} /><span>{option.grade}</span></label>
        {locked ? <><small>مسندة لـ {owner || 'وكيل آخر'}</small>{transfer && <button type="button" className="counselor-grade-transfer" onClick={() => toggleTransfer(option.grade)}>{beingTransferred ? 'إلغاء النقل' : 'نقلها لهذا الوكيل'}</button>}</> : null}
      </div>
    })}
    {!gradeOptions.length && <p className="teacher-empty">لا توجد مراحل في سجلات الطلاب لتعيينها.</p>}
  </div>

  return <section className="teacher-admin counselor-admin vice-principal-admin">
    <header className="teacher-section-head"><div><span>حسابات مستقلة</span><h3>وكلاء المدرسة</h3><p>يمكن إسناد مرحلة أو أكثر لكل وكيل، أو إلغاء المرحلة أو نقلها مباشرة لوكيل آخر.</p></div><div className="teacher-report-actions"><button className="outline-button" onClick={() => void load()} disabled={busy === 'load'}><RefreshCw size={17} />تحديث</button><button className="primary-button" onClick={() => { setShowCreate(true); setError('') }}><UserPlus size={17} />إضافة وكيل مدرسة</button></div></header>
    <div className="teacher-overview-grid"><article><UsersRound size={21} /><div><span>الوكلاء</span><strong>{vicePrincipals.length}</strong></div></article><article><ShieldCheck size={21} /><div><span>حسابات مفعلة</span><strong>{vicePrincipals.filter(item => item.accountActive).length}</strong></div></article><article><KeyRound size={21} /><div><span>بانتظار التفعيل</span><strong>{vicePrincipals.filter(item => !item.accountCreated).length}</strong></div></article></div>
    <section className="teacher-accounts-panel"><div className="teacher-account-tools"><div><strong>إنشاء الحسابات</strong><small>كلمة المرور المؤقتة الموحّدة هي <b>{defaultPassword}</b>، ويغيّرها الوكيل عند أول دخول.</small></div></div>{notice && <p className="teacher-notice success">{notice}</p>}{error && <p className="teacher-notice error">{error}</p>}<input className="teacher-account-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو السجل المدني أو المرحلة" />
      <div className="teacher-account-list">{busy === 'load' ? <p className="teacher-empty">جارٍ تحميل السجلات…</p> : shown.length ? shown.map(item => <article key={item.vicePrincipalId}><UsersRound size={20} /><div><strong>{item.name}</strong><small>{item.identityNumber} · {item.phone || 'دون جوال'} · المراحل: {item.assignedGrades.length ? item.assignedGrades.join('، ') : 'غير مسندة'}{item.temporaryPassword ? <> · كلمة المرور المؤقتة: <bdi>{item.temporaryPassword}</bdi></> : ''}</small></div><span className={`teacher-account-badge ${item.accountActive ? 'active' : ''}`}>{item.accountActive ? 'الحساب مفعّل' : item.accountCreated ? 'بانتظار تغيير المرور' : 'غير منشأ'}</span><div className="teacher-account-actions"><button className="outline-button" onClick={() => openGrades(item)} disabled={busy !== ''}>إدارة المراحل</button>{!item.accountCreated ? <button className="primary-button" disabled={busy === `activate:${item.vicePrincipalId}`} onClick={() => void activate(item)}><KeyRound size={15} />تفعيل</button> : <><button className="outline-button" disabled={busy === `reset:${item.vicePrincipalId}`} onClick={() => void reset(item)}><RefreshCw size={15} />إعادة ضبط</button><button className="outline-button" disabled={busy === `status:${item.vicePrincipalId}`} onClick={() => void changeStatus(item)}><Power size={15} />{item.accountActive ? 'إيقاف' : 'تشغيل'}</button></>}<button className="danger-button" disabled={busy !== ''} onClick={() => void remove(item)}><Trash2 size={14} />حذف</button></div></article>) : <p className="teacher-empty">لا يوجد وكلاء مدرسة مسجلون.</p>}</div></section>
    {showCreate && <div className="counselor-dialog-backdrop" onMouseDown={() => setShowCreate(false)}><form className="counselor-dialog counselor-grade-dialog" onSubmit={create} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setShowCreate(false)}><X size={18} /></button><span>وكلاء المدرسة</span><h3>إضافة وكيل مدرسة</h3><p>ينشأ الحساب بعد الضغط على «تفعيل» في السجل.</p><label>اسم الوكيل<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required /></label><label>رقم السجل المدني<input value={form.identityNumber} inputMode="numeric" onChange={event => setForm(current => ({ ...current, identityNumber: event.target.value.replace(/\D/g, '') }))} required /></label><label>رقم الجوال<input value={form.phone} inputMode="tel" onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} required /></label><section className="counselor-grade-section"><strong>المراحل المسؤولة</strong><p>اختر مرحلة واحدة أو أكثر. لا يمكن إسناد المرحلة إلا لوكيل واحد.</p>{gradePicker(form.grades, grades => setForm(current => ({ ...current, grades })))}</section><div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setShowCreate(false)}>إلغاء</button><button className="primary-button" disabled={busy === 'create' || !form.grades.length}>{busy === 'create' ? 'جارٍ الحفظ…' : 'تأكيد الإضافة'}</button></div></form></div>}
    {editing && <div className="counselor-dialog-backdrop" onMouseDown={() => setEditing(null)}><section className="counselor-dialog counselor-grade-dialog" onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setEditing(null)}><X size={18} /></button><span>وكلاء المدرسة</span><h3>إدارة المراحل</h3><p>{editing.name}. يمكنك إلغاء أي مرحلة، أو نقل المرحلة المحجوزة من وكيل آخر مباشرة.</p><section className="counselor-grade-section">{gradePicker(selectedGrades, setSelectedGrades, editing.vicePrincipalId, true)}</section><div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setEditing(null)} disabled={busy === 'grades'}>إلغاء</button><button className="primary-button" disabled={busy === 'grades'} onClick={() => void saveGrades()}>{busy === 'grades' ? 'جارٍ الحفظ…' : 'حفظ المراحل'}</button></div></section></div>}
  </section>
}
