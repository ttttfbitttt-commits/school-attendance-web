import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { FileDown, FileUp, KeyRound, LockKeyhole, Printer, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react'
import { api, type AdministrativeStaff } from './api'
import { downloadWorkbook, openPrintDocument } from './SchoolFeatures'

type Credential = { administratorId: string; name: string; identityNumber: string; temporaryPassword: string }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character] || character))
const normalizedHeader = (value: unknown) => String(value ?? '').trim().replace(/[\s_\-]+/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي')
const identity = (value: unknown) => String(value ?? '').replace(/\D/g, '')

function locate(headers: string[], words: string[]) { return headers.findIndex(header => words.some(word => header.includes(word))) }
function credentialsHtml(credentials: Credential[], schoolName: string) {
  return `<section class="page" dir="rtl"><h1>${escapeHtml(schoolName)}</h1><h2>بيانات دخول الإداريين</h2><p>تُسلّم لكل إداري بياناته الخاصة، ثم يغيّر كلمة المرور بعد دخوله لأول مرة.</p><table><thead><tr><th>الاسم</th><th>رقم الهوية</th><th>كلمة المرور المؤقتة</th></tr></thead><tbody>${credentials.map(row => `<tr><td>${escapeHtml(row.name)}</td><td dir="ltr">${escapeHtml(row.identityNumber)}</td><td dir="ltr">${escapeHtml(row.temporaryPassword)}</td></tr>`).join('')}</tbody></table></section>`
}

export function AdministratorAdminCenter({ schoolName }: { schoolName: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'accounts' | 'credentials'>('accounts')
  const [staff, setStaff] = useState<AdministrativeStaff[]>([])
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    setBusy('load'); setError('')
    try { const result = await api.administratorAdminOverview(); setStaff(result.staff) }
    catch { setError('تعذر تحميل سجل الإداريين.') }
    finally { setBusy('') }
  }
  async function loadCredentials() {
    setBusy('credentials'); setError('')
    try { const result = await api.administratorCredentials(); setCredentials(result.credentials); setTab('credentials') }
    catch { setError('تعذر قراءة بيانات الدخول المؤقتة.') }
    finally { setBusy('') }
  }
  useEffect(() => { void load() }, [])
  const visible = useMemo(() => staff.filter(row => `${row.name} ${row.identityNumber} ${row.phone}`.includes(search.trim())).slice(0, 60), [staff, search])
  const toggle = (id: string) => setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id])

  async function importFiles(files: FileList | null) {
    if (!files?.length) return
    setBusy('import'); setError(''); setNotice('')
    try {
      const all: Array<{ name: string; identityNumber: string; phone: string }> = []
      for (const file of Array.from(files)) {
        const buffer = await file.arrayBuffer(); const workbook = XLSX.read(buffer, { type: 'array' }); const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
        if (!rows.length) continue
        const headers = (rows[0] || []).map(normalizedHeader)
        const nameIndex = locate(headers, ['الاسم', 'اسمالموظف', 'الموظف'])
        const identityIndex = locate(headers, ['رقمالهويه', 'الهوية', 'السجلالمدني', 'الرقمالمدني'])
        const phoneIndex = locate(headers, ['الجوال', 'رقمالجوال', 'الهاتف', 'رقمالهاتف', 'التواصل'])
        if (nameIndex < 0 || identityIndex < 0) continue
        rows.slice(1).forEach(row => all.push({ name: String(row[nameIndex] ?? '').trim(), identityNumber: identity(row[identityIndex]), phone: String(phoneIndex >= 0 ? row[phoneIndex] ?? '' : '').trim() }))
      }
      if (!all.length) throw new Error('invalid')
      const result = await api.importAdministrators(all)
      setNotice(`تمت إضافة ${result.added} إداريًا. تم تجاوز ${result.skipped} اسمًا مطابقًا${result.conflicts ? `، وترك ${result.conflicts} سجلًا لمراجعة تعارض رقم الهوية` : ''}.`)
      await load()
    } catch { setError('لم أجد أعمدة واضحة للاسم ورقم الهوية في الملفات. تأكد من العناوين ثم أعد الرفع.') }
    finally { setBusy(''); if (input.current) input.current.value = '' }
  }
  async function generate() {
    const ids = selected.length ? selected : staff.filter(row => !row.accountCreated && row.active).map(row => row.administratorId)
    if (!ids.length) { setNotice('كل الإداريين النشطين لديهم حسابات دخول بالفعل.'); return }
    setBusy('generate'); setError('')
    try {
      const result = await api.generateAdministratorAccounts(ids); setCredentials(result.credentials); setSelected([]); setTab('credentials')
      setNotice(`تم إنشاء ${result.created} حسابًا وحفظ كلمات المرور المؤقتة للطباعة والتصدير.`); await load()
    } catch { setError('تعذر إنشاء الحسابات. تأكد من صحة أرقام الهوية.') }
    finally { setBusy('') }
  }
  async function reset(row: AdministrativeStaff) {
    setBusy(`reset-${row.administratorId}`); setError('')
    try { const result = await api.resetAdministratorAccount(row.administratorId); setCredentials([{ administratorId: row.administratorId, name: row.name, identityNumber: row.identityNumber, temporaryPassword: result.temporaryPassword }]); setTab('credentials'); setNotice('تمت إعادة إصدار كلمة مرور مؤقتة وإيقاف الجلسات السابقة.'); await load() }
    catch { setError('تعذر إعادة إصدار كلمة المرور.') }
    finally { setBusy('') }
  }
  async function setStatus(row: AdministrativeStaff) {
    setBusy(`status-${row.administratorId}`); setError('')
    try { await api.setAdministratorAccountStatus(row.administratorId, !row.accountActive); await load() }
    catch { setError('تعذر تغيير حالة الحساب.') }
    finally { setBusy('') }
  }
  const exportCredentials = () => downloadWorkbook('بيانات دخول الإداريين', [['الاسم', 'رقم الهوية', 'كلمة المرور المؤقتة'], ...credentials.map(row => [row.name, row.identityNumber, row.temporaryPassword])], 'بيانات الدخول', schoolName, 'بيانات دخول الإداريين')

  return <section className="teacher-admin administrator-admin" dir="rtl">
    <header className="teacher-admin-head"><div><span>حسابات مستقلة وآمنة</span><h2>الإداريون</h2><p>ارفع ملفًا أو عدة ملفات؛ لا يُحذف السجل السابق. يُتجاوز الاسم المطابق وتُضاف الأسماء الجديدة فقط.</p></div><UsersRound size={31} /></header>
    <div className="teacher-admin-tabs"><button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}>إدارة الحسابات</button><button className={tab === 'credentials' ? 'active' : ''} onClick={() => void loadCredentials()}>بيانات الدخول</button></div>
    {notice && <p className="feature-notice success">{notice}</p>}{error && <p className="feature-notice error">{error}</p>}
    {tab === 'accounts' && <section className="teacher-admin-card">
      <div className="teacher-section-head"><div><span>استيراد تراكمي</span><h3>سجل الإداريين</h3></div><button className="outline-button" onClick={() => void load()} disabled={!!busy}><RefreshCw size={16} /> تحديث</button></div>
      <div className="administrator-actions"><input ref={input} type="file" accept=".xlsx,.xls,.csv" multiple hidden onChange={event => void importFiles(event.target.files)} /><button className="primary-button" onClick={() => input.current?.click()} disabled={!!busy}><FileUp size={17} /> {busy === 'import' ? 'جارٍ الاستيراد…' : 'رفع ملفات الإداريين'}</button><button className="primary-button" onClick={() => void generate()} disabled={!!busy}><KeyRound size={17} /> {busy === 'generate' ? 'جارٍ التوليد…' : 'توليد الحسابات غير المنشأة'}</button></div>
      <div className="teacher-admin-tools"><label><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالاسم أو رقم الهوية أو الجوال" /></label><span>{staff.length} إداريًا</span></div>
      <div className="teacher-account-list">{visible.map(row => <article key={row.administratorId}><label className="teacher-check"><input type="checkbox" checked={selected.includes(row.administratorId)} onChange={() => toggle(row.administratorId)} /></label><div><strong>{row.name}</strong><span>هوية: {row.identityNumber}{row.phone ? ` · جوال: ${row.phone}` : ''}</span></div><b className={`teacher-account-badge ${row.accountCreated && row.accountActive ? 'active' : row.accountCreated ? 'disabled' : 'pending'}`}>{row.accountCreated ? row.accountActive ? 'مفعل' : 'موقوف' : 'بلا حساب'}</b><div className="teacher-account-actions">{row.accountCreated && <><button onClick={() => void reset(row)} disabled={!!busy}>إعادة ضبط</button><button onClick={() => void setStatus(row)} disabled={!!busy}>{row.accountActive ? 'إيقاف' : 'تفعيل'}</button></>}</div></article>)}</div>
      {!visible.length && <p className="teacher-empty">{busy === 'load' ? 'جارٍ التحميل…' : 'لم يُستورد أي إداري بعد.'}</p>}
    </section>}
    {tab === 'credentials' && <section className="teacher-credentials"><div><ShieldCheck size={22} /><div><h3>بيانات دخول تسلّم مرة واحدة</h3><p>تبقى كلمات المرور المؤقتة متاحة حتى يغيّرها الإداري من حسابه.</p></div></div>{credentials.length ? <><div className="teacher-report-actions"><button className="primary-button" onClick={exportCredentials}><FileDown size={16} /> Excel</button><button className="outline-button" onClick={() => openPrintDocument('بيانات دخول الإداريين', credentialsHtml(credentials, schoolName), schoolName)}><Printer size={16} /> PDF / طباعة</button></div><div className="teacher-credentials-table"><table><thead><tr><th>الاسم</th><th>رقم الهوية</th><th>كلمة المرور</th></tr></thead><tbody>{credentials.map(row => <tr key={row.administratorId}><td>{row.name}</td><td dir="ltr">{row.identityNumber}</td><td dir="ltr">{row.temporaryPassword}</td></tr>)}</tbody></table></div></> : <p className="teacher-empty">لا توجد كلمات مرور مؤقتة متاحة. أنشئ الحسابات أو أعد إصدار كلمة المرور من إدارة الحسابات.</p>}</section>}
  </section>
}
