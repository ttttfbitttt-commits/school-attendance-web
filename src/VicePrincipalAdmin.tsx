import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { KeyRound, Power, RefreshCw, ShieldCheck, UserPlus, UsersRound, X } from 'lucide-react'
import { api, type SchoolVicePrincipal, type VicePrincipalGradeOption } from './api'

const emptyForm = { name: '', identityNumber: '', phone: '', grade: '' }

export function VicePrincipalAdminCenter() {
  const [vicePrincipals, setVicePrincipals] = useState<SchoolVicePrincipal[]>([])
  const [gradeOptions, setGradeOptions] = useState<VicePrincipalGradeOption[]>([])
  const [defaultPassword, setDefaultPassword] = useState('12345678')
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<SchoolVicePrincipal | null>(null)
  const [grade, setGrade] = useState('')
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

  const availableGrades = useMemo(() => gradeOptions.filter(item => !item.vicePrincipalId || item.vicePrincipalId === editing?.vicePrincipalId), [gradeOptions, editing])
  const shown = useMemo(() => {
    const term = search.trim()
    return term ? vicePrincipals.filter(item => `${item.name} ${item.identityNumber} ${item.phone} ${item.grade}`.includes(term)) : vicePrincipals
  }, [search, vicePrincipals])

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('')
    try {
      await api.createVicePrincipal(form)
      setForm(emptyForm); setShowCreate(false)
      setNotice('تمت إضافة وكيل المدرسة. فعّل الحساب ليتمكن من تسجيل الدخول.')
      await load()
    } catch (reason) {
      const code = (reason as Error & { code?: string }).code
      setError(code === 'vice_principal_identity_exists' ? 'رقم السجل المدني مسجل لوكيل مدرسة بالفعل.' : code === 'vice_principal_grade_taken' ? 'هذه المرحلة مسندة لوكيل آخر.' : 'تعذر حفظ البيانات. تحقق من الاسم والسجل المدني والجوال والمرحلة.')
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
  const saveGrade = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing) return
    setBusy('grade'); setError('')
    try { await api.setVicePrincipalGrade(editing.vicePrincipalId, grade); setEditing(null); setNotice('تم تحديث المرحلة المسؤولة عنها.'); await load() }
    catch (reason) { setError((reason as Error & { code?: string }).code === 'vice_principal_grade_taken' ? 'هذه المرحلة مسندة لوكيل آخر.' : 'تعذر تحديث المرحلة.') }
    finally { setBusy('') }
  }

  return <section className="teacher-admin counselor-admin vice-principal-admin">
    <header className="teacher-section-head"><div><span>حسابات مستقلة</span><h3>وكلاء المدرسة</h3><p>أضف الوكيل وعيّن المرحلة التي يتابع إحالاتها وسجل سلوك طلابها ورسائل غيابهم وتأخرهم.</p></div><div className="teacher-report-actions"><button className="outline-button" onClick={() => void load()} disabled={busy === 'load'}><RefreshCw size={17} />تحديث</button><button className="primary-button" onClick={() => { setShowCreate(true); setError('') }}><UserPlus size={17} />إضافة وكيل مدرسة</button></div></header>
    <div className="teacher-overview-grid"><article><UsersRound size={21} /><div><span>الوكلاء</span><strong>{vicePrincipals.length}</strong></div></article><article><ShieldCheck size={21} /><div><span>حسابات مفعلة</span><strong>{vicePrincipals.filter(item => item.accountActive).length}</strong></div></article><article><KeyRound size={21} /><div><span>بانتظار التفعيل</span><strong>{vicePrincipals.filter(item => !item.accountCreated).length}</strong></div></article></div>
    <section className="teacher-accounts-panel"><div className="teacher-account-tools"><div><strong>إنشاء الحسابات</strong><small>كلمة المرور المؤقتة الموحّدة هي <b>{defaultPassword}</b>، ويغيّرها الوكيل عند أول دخول.</small></div></div>{notice && <p className="teacher-notice success">{notice}</p>}{error && <p className="teacher-notice error">{error}</p>}<input className="teacher-account-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو السجل المدني أو المرحلة" />
      <div className="teacher-account-list">{busy === 'load' ? <p className="teacher-empty">جارٍ تحميل السجلات…</p> : shown.length ? shown.map(item => <article key={item.vicePrincipalId}><UsersRound size={20} /><div><strong>{item.name}</strong><small>{item.identityNumber} · {item.phone || 'دون جوال'} · المرحلة: {item.grade || 'غير مسندة'}</small></div><span className={`teacher-account-badge ${item.accountActive ? 'active' : ''}`}>{item.accountActive ? 'الحساب مفعّل' : item.accountCreated ? 'بانتظار تغيير المرور' : 'غير منشأ'}</span><div className="teacher-account-actions"><button className="outline-button" onClick={() => { setEditing(item); setGrade(item.grade); setError('') }}>تغيير المرحلة</button>{!item.accountCreated ? <button className="primary-button" disabled={busy === `activate:${item.vicePrincipalId}`} onClick={() => void activate(item)}><KeyRound size={15} />تفعيل</button> : <><button className="outline-button" disabled={busy === `reset:${item.vicePrincipalId}`} onClick={() => void reset(item)}><RefreshCw size={15} />إعادة ضبط</button><button className="outline-button" disabled={busy === `status:${item.vicePrincipalId}`} onClick={() => void changeStatus(item)}><Power size={15} />{item.accountActive ? 'إيقاف' : 'تشغيل'}</button></>}</div></article>) : <p className="teacher-empty">لا يوجد وكلاء مدرسة مسجلون.</p>}</div></section>
    {showCreate && <div className="counselor-dialog-backdrop" onMouseDown={() => setShowCreate(false)}><form className="counselor-dialog" onSubmit={create} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setShowCreate(false)}><X size={18} /></button><span>وكلاء المدرسة</span><h3>إضافة وكيل مدرسة</h3><p>ينشأ الحساب بعد الضغط على «تفعيل» في السجل.</p><label>اسم الوكيل<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required /></label><label>رقم السجل المدني<input value={form.identityNumber} inputMode="numeric" onChange={event => setForm(current => ({ ...current, identityNumber: event.target.value.replace(/\D/g, '') }))} required /></label><label>رقم الجوال<input value={form.phone} inputMode="tel" onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} required /></label><label>المرحلة المسؤولة عنها<select value={form.grade} onChange={event => setForm(current => ({ ...current, grade: event.target.value }))} required><option value="">اختر المرحلة</option>{gradeOptions.filter(item => !item.vicePrincipalId).map(item => <option key={item.grade} value={item.grade}>{item.grade}</option>)}</select></label><div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setShowCreate(false)}>إلغاء</button><button className="primary-button" disabled={busy === 'create'}>{busy === 'create' ? 'جارٍ الحفظ…' : 'تأكيد الإضافة'}</button></div></form></div>}
    {editing && <div className="counselor-dialog-backdrop" onMouseDown={() => setEditing(null)}><form className="counselor-dialog" onSubmit={saveGrade} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setEditing(null)}><X size={18} /></button><span>وكلاء المدرسة</span><h3>تعيين المرحلة</h3><p>{editing.name}</p><label>المرحلة المسؤولة عنها<select value={grade} onChange={event => setGrade(event.target.value)} required><option value="">اختر المرحلة</option>{availableGrades.map(item => <option key={item.grade} value={item.grade}>{item.grade}</option>)}</select></label><div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setEditing(null)}>إلغاء</button><button className="primary-button" disabled={busy === 'grade'}>{busy === 'grade' ? 'جارٍ الحفظ…' : 'حفظ المرحلة'}</button></div></form></div>}
  </section>
}
