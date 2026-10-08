import { useRef, useState } from 'react'
import { CheckCircle2, Download, FileText, ShieldAlert, Upload } from 'lucide-react'
import { api, type SchoolBackupSnapshot } from './api'
import './BackupRestoreCenter.css'

type Props = { schoolName: string }

const errorMessage = (error: unknown) => {
  const code = (error as Error & { code?: string })?.code || (error as Error)?.message
  const messages: Record<string, string> = {
    invalid_current_password: 'كلمة مرور حساب المدرسة غير صحيحة.',
    backup_password_requirements: 'كلمة مرور ملف النسخة يجب أن تكون 12 حرفًا على الأقل.',
    backup_file_too_large: 'ملف النسخة كبير جدًا ولا يمكن رفعه.',
    backup_content_too_large: 'محتوى النسخة أكبر من الحد المسموح.',
    invalid_backup_password_or_file: 'كلمة مرور النسخة غير صحيحة أو أن الملف تالف.',
    invalid_backup_file: 'صيغة ملف النسخة غير صحيحة.',
    unsupported_backup_file: 'هذا الملف ليس نسخة متوافقة مع النظام.',
    backup_school_mismatch: 'هذه النسخة تخص مدرسة أخرى ولا يمكن استعادتها هنا.',
    restore_confirmation_mismatch: 'اكتب اسم المدرسة كما يظهر في معاينة النسخة لتأكيد الاستعادة.',
  }
  return messages[code] || 'تعذر إتمام العملية. أعد المحاولة وتأكد من البيانات المدخلة.'
}

const formatDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function SnapshotSummary({ snapshot }: { snapshot: SchoolBackupSnapshot }) {
  const items = [
    ['الطلاب', snapshot.students],
    ['سجلات الحضور', snapshot.attendance],
    ['المعلمون', snapshot.teachers],
    ['الإداريون', snapshot.administrators],
    ['سجلات الحصص', snapshot.lessonRecords],
    ['درجات وكشوف المعلمين', snapshot.sheets],
    ['السجل السلوكي', snapshot.behavior],
    ['الإحالات', snapshot.referrals],
  ]
  return (
    <div className="backup-summary" aria-live="polite">
      <div className="backup-summary-heading">
        <CheckCircle2 size={19} />
        <div>
          <strong>تم التحقق من النسخة</strong>
          <span>{snapshot.schoolName} · {formatDate(snapshot.createdAt)}</span>
        </div>
      </div>
      <div className="backup-summary-grid">
        {items.map(([label, count]) => <div key={String(label)}><span>{label}</span><strong>{Number(count).toLocaleString('en-US')}</strong></div>)}
      </div>
      <p>إجمالي السجلات المحفوظة: <strong>{snapshot.totalRows.toLocaleString('en-US')}</strong></p>
    </div>
  )
}

export function BackupRestoreCenter({ schoolName }: Props) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [backupPassword, setBackupPassword] = useState('')
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState('')
  const [exporting, setExporting] = useState(false)
  const [archive, setArchive] = useState('')
  const [archiveName, setArchiveName] = useState('')
  const [restoreCurrentPassword, setRestoreCurrentPassword] = useState('')
  const [restorePassword, setRestorePassword] = useState('')
  const [preview, setPreview] = useState<SchoolBackupSnapshot | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const createBackup = async () => {
    setError('')
    setNotice('')
    if (backupPassword !== backupPasswordConfirm) { setError('تأكيد كلمة مرور النسخة غير مطابق.'); return }
    if (backupPassword.length < 12) { setError('كلمة مرور ملف النسخة يجب أن تكون 12 حرفًا على الأقل.'); return }
    if (!currentPassword) { setError('اكتب كلمة مرور حساب المدرسة أولًا.'); return }
    setExporting(true)
    try {
      const result = await api.downloadSchoolBackup(currentPassword, backupPassword)
      const url = URL.createObjectURL(result.blob)
      const link = document.createElement('a')
      link.href = url
      link.download = result.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setCurrentPassword('')
      setBackupPassword('')
      setBackupPasswordConfirm('')
      setNotice('تم تنزيل النسخة المشفرة. احفظ الملف وكلمة مروره في مكان آمن وسري.')
    } catch (requestError) { setError(errorMessage(requestError)) }
    finally { setExporting(false) }
  }

  const selectArchive = async (file?: File) => {
    setError('')
    setNotice('')
    setPreview(null)
    setConfirmation('')
    if (!file) return
    if (file.size > 42 * 1024 * 1024) { setError('ملف النسخة أكبر من الحجم المسموح به.'); return }
    try {
      const content = await file.text()
      if (!content.trim()) throw new Error('invalid_backup_file')
      setArchive(content)
      setArchiveName(file.name)
      setNotice('تم اختيار الملف. اكتب كلمتي المرور ثم اضغط «فحص النسخة».')
    } catch (readError) { setError(errorMessage(readError)) }
  }

  const previewBackup = async () => {
    setError('')
    setNotice('')
    if (!archive) { setError('اختر ملف النسخة أولًا.'); return }
    if (!restoreCurrentPassword || !restorePassword) { setError('اكتب كلمة مرور حساب المدرسة وكلمة مرور النسخة.'); return }
    setPreviewing(true)
    try {
      const result = await api.previewSchoolBackup(restoreCurrentPassword, restorePassword, archive)
      setPreview(result.snapshot)
      setNotice('تطابق الملف مع هذه المدرسة. راجع الأعداد ثم اكتب اسم المدرسة للتأكيد النهائي.')
    } catch (requestError) { setPreview(null); setError(errorMessage(requestError)) }
    finally { setPreviewing(false) }
  }

  const restoreBackup = async () => {
    setError('')
    setNotice('')
    if (!preview || confirmation.trim() !== preview.schoolName) { setError('اكتب اسم المدرسة كما يظهر في معاينة النسخة.'); return }
    setRestoring(true)
    try {
      await api.restoreSchoolBackup(restoreCurrentPassword, restorePassword, archive, confirmation.trim())
      setNotice('تمت الاستعادة بنجاح. سيتم تسجيل خروج جميع الحسابات ثم العودة إلى شاشة الدخول.')
      window.setTimeout(() => { void api.logout().finally(() => window.location.reload()) }, 1600)
    } catch (requestError) { setError(errorMessage(requestError)); setRestoring(false) }
  }

  return (
    <section className="backup-page" dir="rtl">
      <header className="backup-hero">
        <div className="backup-hero-icon"><ShieldAlert size={29} /></div>
        <div>
          <span>إدارة المدرسة</span>
          <h2>النسخ الاحتياطي والاستعادة</h2>
          <p>نسخة مشفّرة تشمل بيانات المدرسة وسجلاتها، مع استعادة مقيدة بهذه المدرسة فقط.</p>
        </div>
      </header>

      <div className="backup-warning">
        <ShieldAlert size={21} />
        <div><strong>بيانات خاصة وسرية</strong><span>احفظ ملف النسخة وكلمة مروره في مكان آمن. يحتوي الملف على بيانات الطلاب والمعلمين والإداريين والسجلات والتقارير.</span></div>
      </div>

      {notice && <div className="backup-notice success" role="status">{notice}</div>}
      {error && <div className="backup-notice error" role="alert">{error}</div>}

      <div className="backup-grid">
        <article className="backup-card">
          <div className="backup-card-title"><Download size={22} /><div><h3>إنشاء نسخة احتياطية</h3><p>يُنزّل الملف مباشرة إلى جهازك ولا يُحتفظ به في الخادم.</p></div></div>
          <label>كلمة مرور حساب المدرسة<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label>كلمة مرور ملف النسخة<input type="password" value={backupPassword} onChange={event => setBackupPassword(event.target.value)} autoComplete="new-password" placeholder="12 حرفًا على الأقل" /></label>
          <label>تأكيد كلمة مرور ملف النسخة<input type="password" value={backupPasswordConfirm} onChange={event => setBackupPasswordConfirm(event.target.value)} autoComplete="new-password" /></label>
          <button className="backup-primary" type="button" disabled={exporting} onClick={createBackup}><Download size={18} />{exporting ? 'جارٍ تجهيز النسخة…' : 'تنزيل النسخة الاحتياطية'}</button>
          <small>تتضمن الطلاب والمعلمين والإداريين والجداول والفصول والحضور والغياب والتقارير وكشوف المعلمين والسجل السلوكي والإحالات.</small>
        </article>

        <article className="backup-card restore-card">
          <div className="backup-card-title"><Upload size={22} /><div><h3>استعادة نسخة سابقة</h3><p>تستبدل بيانات <strong>{schoolName}</strong> ببيانات النسخة بعد فحصها.</p></div></div>
          <input ref={fileInput} className="backup-file-input" type="file" accept=".7asrbackup,application/json" onChange={event => { void selectArchive(event.target.files?.[0]) }} />
          <button className="backup-file-button" type="button" onClick={() => fileInput.current?.click()}><FileText size={18} />{archiveName || 'اختر ملف النسخة الاحتياطية'}</button>
          <label>كلمة مرور حساب المدرسة<input type="password" value={restoreCurrentPassword} onChange={event => setRestoreCurrentPassword(event.target.value)} autoComplete="current-password" /></label>
          <label>كلمة مرور ملف النسخة<input type="password" value={restorePassword} onChange={event => setRestorePassword(event.target.value)} autoComplete="current-password" /></label>
          <button className="backup-secondary" type="button" disabled={previewing || !archive} onClick={previewBackup}>{previewing ? 'جارٍ فحص النسخة…' : 'فحص النسخة قبل الاستعادة'}</button>
        </article>
      </div>

      {preview && <article className="backup-confirm-card">
        <SnapshotSummary snapshot={preview} />
        <div className="restore-danger">
          <ShieldAlert size={20} />
          <p>عند التأكيد ستُستبدل بيانات هذه المدرسة كاملة ببيانات النسخة. ستنتهي جلسات جميع الحسابات، ثم يلزم تسجيل الدخول مجددًا.</p>
        </div>
        <label>للتأكيد اكتب اسم المدرسة: <strong>{preview.schoolName}</strong><input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder={preview.schoolName} disabled={restoring} /></label>
        <button className="backup-restore-button" type="button" disabled={restoring || confirmation.trim() !== preview.schoolName} onClick={restoreBackup}>{restoring ? 'جارٍ استعادة البيانات…' : 'تأكيد الاستعادة الكاملة'}</button>
      </article>}
    </section>
  )
}
