import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { KeyRound, Power, RefreshCw, ShieldCheck, Sparkles, UserPlus, UsersRound, X } from 'lucide-react'
import { api, type SchoolActivityLeader } from './api'

const emptyForm = { name: '', identityNumber: '', phone: '' }

export function ActivityLeaderAdminCenter() {
  const [leaders, setLeaders] = useState<SchoolActivityLeader[]>([])
  const [defaultPassword, setDefaultPassword] = useState('12345678')
  const [form, setForm] = useState(emptyForm)
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')

  const load = async () => {
    setBusy('load'); setError('')
    try { const result = await api.activityLeaderAdminOverview(); setLeaders(result.leaders); setDefaultPassword(result.defaultPassword) }
    catch { setError('تعذر تحميل سجلات رواد النشاط.') } finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])
  const shown = useMemo(() => {
    const term = search.trim()
    return term ? leaders.filter(item => `${item.name} ${item.identityNumber} ${item.phone}`.includes(term)) : leaders
  }, [leaders, search])
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy('create'); setError(''); setNotice('')
    try { await api.createActivityLeader(form); setForm(emptyForm); setShowCreate(false); setNotice('تمت إضافة رائد النشاط. فعّل الحساب ليتمكن من تسجيل الدخول.'); await load() }
    catch (reason) { setError((reason as Error & { code?: string }).code === 'activity_leader_identity_exists' ? 'رقم السجل المدني مسجل لرائد نشاط بالفعل.' : 'تعذر حفظ البيانات. تحقق من الاسم والسجل المدني والجوال.') }
    finally { setBusy('') }
  }
  const activate = async (item: SchoolActivityLeader) => {
    setBusy(`activate:${item.activityLeaderId}`); setError(''); setNotice('')
    try { const result = await api.activateActivityLeaderAccount(item.activityLeaderId); setNotice(`تم تفعيل حساب ${item.name}. كلمة المرور المؤقتة: ${result.temporaryPassword}`); await load() }
    catch { setError('تعذر تفعيل الحساب.') } finally { setBusy('') }
  }
  const reset = async (item: SchoolActivityLeader) => {
    setBusy(`reset:${item.activityLeaderId}`); setError(''); setNotice('')
    try { const result = await api.resetActivityLeaderAccount(item.activityLeaderId); setNotice(`تمت إعادة ضبط كلمة مرور ${item.name}: ${result.temporaryPassword}`); await load() }
    catch { setError('تعذر إعادة ضبط كلمة المرور.') } finally { setBusy('') }
  }
  const changeStatus = async (item: SchoolActivityLeader) => {
    setBusy(`status:${item.activityLeaderId}`); setError(''); setNotice('')
    try { await api.setActivityLeaderAccountStatus(item.activityLeaderId, !item.accountActive); setNotice(item.accountActive ? 'تم إيقاف الحساب.' : 'تم تشغيل الحساب.'); await load() }
    catch { setError('تعذر تعديل حالة الحساب.') } finally { setBusy('') }
  }

  return <section className="teacher-admin counselor-admin vice-principal-admin" dir="rtl">
    <header className="teacher-section-head"><div><span>حسابات مستقلة</span><h3>رائد النشاط</h3><p>أضف رائد النشاط ثم فعّل حسابه. لن تظهر له أي بيانات أو صلاحيات في هذه المرحلة.</p></div><div className="teacher-report-actions"><button className="outline-button" onClick={() => void load()} disabled={busy === 'load'}><RefreshCw size={17} />تحديث</button><button className="primary-button" onClick={() => { setShowCreate(true); setError('') }}><UserPlus size={17} />إضافة رائد نشاط</button></div></header>
    <div className="teacher-overview-grid"><article><UsersRound size={21} /><div><span>رواد النشاط</span><strong>{leaders.length}</strong></div></article><article><ShieldCheck size={21} /><div><span>حسابات مفعلة</span><strong>{leaders.filter(item => item.accountActive).length}</strong></div></article><article><KeyRound size={21} /><div><span>بانتظار التفعيل</span><strong>{leaders.filter(item => !item.accountCreated).length}</strong></div></article></div>
    <section className="teacher-accounts-panel"><div className="teacher-account-tools"><div><strong>إنشاء الحسابات</strong><small>كلمة المرور المؤقتة الموحدة هي <b>{defaultPassword}</b>، ويغيرها رائد النشاط عند أول دخول.</small></div></div>{notice && <p className="teacher-notice success">{notice}</p>}{error && <p className="teacher-notice error">{error}</p>}<input className="teacher-account-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو السجل المدني أو الجوال" />
      <div className="teacher-account-list">{busy === 'load' ? <p className="teacher-empty">جارٍ تحميل السجلات…</p> : shown.length ? shown.map(item => <article key={item.activityLeaderId}><Sparkles size={20} /><div><strong>{item.name}</strong><small>{item.identityNumber} · {item.phone || 'دون جوال'}</small></div><span className={`teacher-account-badge ${item.accountActive ? 'active' : ''}`}>{item.accountActive ? 'الحساب مفعّل' : item.accountCreated ? 'بانتظار تغيير المرور' : 'غير منشأ'}</span><div className="teacher-account-actions">{!item.accountCreated ? <button className="primary-button" disabled={busy === `activate:${item.activityLeaderId}`} onClick={() => void activate(item)}><KeyRound size={15} />تفعيل</button> : <><button className="outline-button" disabled={busy === `reset:${item.activityLeaderId}`} onClick={() => void reset(item)}><RefreshCw size={15} />إعادة ضبط</button><button className="outline-button" disabled={busy === `status:${item.activityLeaderId}`} onClick={() => void changeStatus(item)}><Power size={15} />{item.accountActive ? 'إيقاف' : 'تشغيل'}</button></>}</div></article>) : <p className="teacher-empty">لا يوجد رواد نشاط مسجلون.</p>}</div></section>
    {showCreate && <div className="counselor-dialog-backdrop" onMouseDown={() => setShowCreate(false)}><form className="counselor-dialog" onSubmit={create} onMouseDown={event => event.stopPropagation()}><button type="button" className="counselor-dialog-close" onClick={() => setShowCreate(false)}><X size={18} /></button><span>رائد النشاط</span><h3>إضافة رائد نشاط</h3><p>ينشأ الحساب بعد الضغط على «تفعيل» في السجل.</p><label>اسم رائد النشاط<input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} required /></label><label>رقم السجل المدني<input value={form.identityNumber} inputMode="numeric" onChange={event => setForm(current => ({ ...current, identityNumber: event.target.value.replace(/\D/g, '') }))} required /></label><label>رقم الجوال<input value={form.phone} inputMode="tel" onChange={event => setForm(current => ({ ...current, phone: event.target.value }))} required /></label><div className="counselor-dialog-actions"><button type="button" className="outline-button" onClick={() => setShowCreate(false)}>إلغاء</button><button className="primary-button" disabled={busy === 'create'}>{busy === 'create' ? 'جارٍ الحفظ…' : 'تأكيد الإضافة'}</button></div></form></div>}
  </section>
}
