import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { KeyRound, Phone, Power, RefreshCw, ShieldCheck, UserPlus, UsersRound, X } from 'lucide-react'
import { api, type StudentCounselor } from './api'

const emptyForm = { name: '', identityNumber: '', phone: '' }

export function CounselorAdminCenter() {
  const [counselors, setCounselors] = useState<StudentCounselor[]>([])
  const [defaultPassword, setDefaultPassword] = useState('12345678')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const load = async () => {
    setBusy('load')
    try {
      const result = await api.counselorAdminOverview()
      setCounselors(result.counselors)
      setDefaultPassword(result.defaultPassword)
    } catch { setError('تعذر تحميل سجل المرشدين الطلابيين.') }
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
      setNotice('تمت إضافة المرشد إلى السجل. فعّل حسابه ليتمكن من تسجيل الدخول.')
      await load()
    } catch (reason) {
      setError(reason instanceof Error && reason.message === 'counselor_identity_exists' ? 'رقم الهوية مسجل لمرشد طلابي بالفعل.' : 'تعذر حفظ بيانات المرشد. تأكد من الاسم ورقم الهوية والجوال.')
      setBusy('')
    }
  }
  const activate = async (counselor: StudentCounselor) => {
    setBusy(`activate:${counselor.counselorId}`); setError(''); setNotice('')
    try {
      const result = await api.activateCounselorAccount(counselor.counselorId)
      setNotice(`تم تفعيل حساب ${counselor.name}. كلمة المرور المؤقتة: ${result.temporaryPassword}`)
      await load()
    } catch { setError('تعذر تفعيل حساب المرشد.') } finally { setBusy('') }
  }
  const reset = async (counselor: StudentCounselor) => {
    setBusy(`reset:${counselor.counselorId}`); setError(''); setNotice('')
    try {
      const result = await api.resetCounselorAccount(counselor.counselorId)
      setNotice(`تمت إعادة ضبط حساب ${counselor.name} إلى كلمة المرور المؤقتة: ${result.temporaryPassword}`)
      await load()
    } catch { setError('تعذر إعادة ضبط حساب المرشد.') } finally { setBusy('') }
  }
  const setStatus = async (counselor: StudentCounselor) => {
    setBusy(`status:${counselor.counselorId}`); setError('')
    try {
      await api.setCounselorAccountStatus(counselor.counselorId, !counselor.accountActive)
      setNotice(counselor.accountActive ? `تم إيقاف حساب ${counselor.name}.` : `تم تفعيل حساب ${counselor.name}.`)
      await load()
    } catch { setError('تعذر تغيير حالة الحساب.') } finally { setBusy('') }
  }

  const visible = useMemo(() => {
    const value = search.trim()
    return value ? counselors.filter(row => `${row.name} ${row.identityNumber} ${row.phone}`.includes(value)) : counselors
  }, [counselors, search])
  const activeAccounts = counselors.filter(row => row.accountCreated && row.accountActive).length
  const pendingAccounts = counselors.filter(row => !row.accountCreated).length

  return <section className="teacher-admin counselor-admin" dir="rtl">
    <header className="teacher-admin-head"><div><span>إدارة المدرسة / بوابة المرشد الطلابي</span><h2>المرشدون الطلابيون</h2><p>أضف المرشد برقم هويته وجواله، ثم فعّل حسابه المستقل. يغيّر المرشد كلمة المرور عند أول دخول.</p></div><UsersRound size={31} /></header>
    <div className="student-account-summary counselor-summary"><article><UsersRound size={19} /><span>المرشدون</span><b>{counselors.length}</b></article><article><ShieldCheck size={19} /><span>حسابات مفعلة</span><b>{activeAccounts}</b></article><article><KeyRound size={19} /><span>بانتظار التفعيل</span><b>{pendingAccounts}</b></article></div>
    <section className="teacher-admin-card counselor-admin-tools"><div><strong>إضافة مرشد طلابي</strong><p>كلمة المرور المؤقتة الموحدة عند تفعيل الحساب هي <b dir="ltr">{defaultPassword}</b>.</p></div><div><button type="button" className="outline-button" onClick={() => void load()} disabled={busy !== ''}><RefreshCw size={16} /> تحديث</button><button type="button" className="primary-button" onClick={() => { setError(''); setShowCreate(true) }} disabled={busy !== ''}><UserPlus size={17} /> إضافة مرشد طلابي</button></div></section>
    {notice && <p className="student-portal-notice success" role="status">{notice}</p>}{error && <p className="student-portal-notice error" role="alert">{error}</p>}
    <input className="student-account-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو رقم الهوية أو الجوال" />
    <div className="teacher-account-list counselor-account-list">{visible.map(counselor => <article key={counselor.counselorId}>
      <div className="teacher-account-avatar">{counselor.name.charAt(0)}</div><div><strong>{counselor.name}</strong><span dir="ltr">{counselor.identityNumber}</span><small><Phone size={12} /> {counselor.phone}</small></div>
      <span className={`teacher-account-badge ${counselor.accountCreated && counselor.accountActive ? 'ready' : ''}`}>{!counselor.accountCreated ? 'بانتظار التفعيل' : counselor.accountActive ? counselor.mustChangePassword ? 'بانتظار تغيير المرور' : 'نشط' : 'موقوف'}</span>
      <div className="teacher-account-actions">{!counselor.accountCreated ? <button type="button" className="primary-button" onClick={() => void activate(counselor)} disabled={busy !== ''}><KeyRound size={14} /> {busy === `activate:${counselor.counselorId}` ? 'جارٍ التفعيل…' : 'تفعيل الحساب'}</button> : <><button type="button" onClick={() => void reset(counselor)} disabled={busy !== ''}><RefreshCw size={14} /> إعادة ضبط</button><button type="button" onClick={() => void setStatus(counselor)} disabled={busy !== ''}><Power size={14} /> {counselor.accountActive ? 'إيقاف' : 'تفعيل'}</button></>}</div>
    </article>)}</div>
    {!visible.length && <p className="teacher-empty">{busy === 'load' ? 'جارٍ تحميل السجل…' : 'لا يوجد مرشدون مطابقون لهذا البحث.'}</p>}

    {showCreate && <div className="counselor-dialog-backdrop" role="presentation" onMouseDown={() => busy === '' && setShowCreate(false)}><form className="counselor-dialog" onSubmit={createCounselor} onMouseDown={event => event.stopPropagation()}>
      <header><div><span>بوابة المرشد الطلابي</span><h3>تسجيل مرشد طلابي</h3></div><button type="button" className="icon-button" onClick={() => busy === '' && setShowCreate(false)} aria-label="إغلاق"><X size={18} /></button></header>
      <p>أدخل بيانات المرشد كما ستظهر في حسابه.</p><label>الاسم الكامل<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} maxLength={180} required autoFocus /></label><label>رقم الهوية<input value={form.identityNumber} onChange={event => setForm(current => ({ ...current, identityNumber: event.target.value.replace(/\D/g, '') }))} inputMode="numeric" pattern="[0-9]*" minLength={6} maxLength={32} required /></label><label>رقم الجوال<input value={form.phone} onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} inputMode="tel" maxLength={48} required /></label>
      <footer><button type="button" className="outline-button" onClick={() => setShowCreate(false)} disabled={busy !== ''}>إلغاء</button><button type="submit" className="primary-button" disabled={busy !== ''}>{busy === 'create' ? 'جارٍ الحفظ…' : 'تأكيد الإضافة'}</button></footer>
    </form></div>}
  </section>
}
