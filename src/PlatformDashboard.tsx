import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Activity, Database, ExternalLink, KeyRound, LockKeyhole, LogOut, PauseCircle, PlayCircle, RefreshCw, School, Search, Users } from 'lucide-react'
import { api, type PlatformSchoolUsage } from './api'
import './PlatformDashboard.css'

const numberFormat = new Intl.NumberFormat('ar-SA')
const statusLabels: Record<PlatformSchoolUsage['usage']['status'], string> = {
  active: 'مفعّلة: استخدام خلال 90 يومًا',
  used_before: 'غير نشطة منذ 90 يومًا',
  login_only: 'دخول فقط، دون سجلات تشغيل',
  not_started: 'لم يسجل دخول أو استخدام',
}

function formatNumber(value: number) {
  return numberFormat.format(value)
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${formatNumber(bytes)} بايت`
  const units = ['ك.ب', 'م.ب', 'ج.ب', 'ت.ب']
  let size = bytes / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium' }).format(date)
}

function PlatformSchoolRow({ school, deleting, updating, opening, onEdit, onDelete, onStatus, onOpen }: {
  school: PlatformSchoolUsage
  deleting: boolean
  updating: boolean
  opening: boolean
  onEdit: (school: PlatformSchoolUsage) => void
  onDelete: (school: PlatformSchoolUsage) => void
  onStatus: (school: PlatformSchoolUsage) => void
  onOpen: (school: PlatformSchoolUsage) => void
}) {
  const statusClass = `platform-usage-status ${school.usage.status}`
  return (
    <tr>
      <td className="platform-school-name">
        <strong>{school.name}</strong>
        <small>تاريخ التفعيل: {formatDate(school.activatedAt)}</small>
        <span className={`platform-school-state ${school.platformStatus}`}>{school.platformStatus === 'suspended' ? 'الحساب موقوف' : 'الحساب مفعّل'}</span>
        {school.platformStatus === 'suspended' && <small>الإيقاف: {formatDate(school.suspendedAt)}</small>}
      </td>
      <td>
        <strong>{school.activatedBy.name}</strong>
        {school.activatedBy.email && <small dir="ltr">{school.activatedBy.email}</small>}
        {school.registeredEmails.filter(email => email !== school.activatedBy.email).map(email =>
          <small key={email} dir="ltr">{email}</small>,
        )}
      </td>
      <td>
        <strong>{formatNumber(school.teacherCount)} معلم</strong>
        <small>حساب دخول مفعّل: {formatNumber(school.teacherAccounts)}</small>
        {school.teachers.length > 0 && <details className="platform-teacher-details">
          <summary>عرض أسماء المعلمين</summary>
          <ul>{school.teachers.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>
        </details>}
      </td>
      <td>
        <strong>{formatNumber(school.studentCount)} طالب</strong>
        <small>حسابات طلاب مفعّلة: {formatNumber(school.studentAccounts)}</small>
      </td>
      <td>
        <span className={statusClass}>{statusLabels[school.usage.status]}</span>
        <small>سجلات التشغيل آخر 30 يومًا: {formatNumber(school.usage.records30Days)}</small>
        <small>سجلات التشغيل آخر 90 يومًا: {formatNumber(school.usage.records90Days)}</small>
        <small>إجمالي سجلات النظام الفعلية: {formatNumber(school.usage.totalRecords)}</small>
        <small>سجلات الحضور الكلية: {formatNumber(school.attendanceCount)}</small>
        <small>حضور: {formatNumber(school.usage.attendance30Days)} · غياب: {formatNumber(school.usage.absences30Days)} · رسائل: {formatNumber(school.usage.messages30Days)}</small>
        <small>آخر استخدام فعلي: {formatDate(school.usage.lastActualUse)}</small>
      </td>
      <td>
        <strong>{formatNumber(school.loginCount30Days)} دخول</strong>
        <small>آخر دخول: {formatDate(school.lastLoginDate)}</small>
      </td>
      <td>
        <strong>{formatBytes(school.storage.totalBytes)}</strong>
        <small>بيانات السجلات: {formatBytes(school.storage.recordsBytes)}</small>
        <small>ملفات الإنجاز: {formatBytes(school.storage.portfolioBytes)} ({formatNumber(school.storage.portfolioFiles)} ملف)</small>
      </td>
      <td>
        <div className="platform-action-list">
          <button className="secondary-button" type="button" disabled={opening || school.platformStatus === 'suspended'} onClick={() => onOpen(school)}>
            <ExternalLink size={15} /> {opening ? 'جارٍ الفتح...' : 'دخول إلى نظام المدرسة'}
          </button>
          <button className="secondary-button" type="button" disabled={updating} onClick={() => onEdit(school)}>
            <KeyRound size={15} /> {updating ? 'جارٍ الحفظ...' : 'تعديل بيانات المدرسة'}
          </button>
          <button className={school.platformStatus === 'suspended' ? 'secondary-button' : 'platform-suspend-button'} type="button" disabled={updating} onClick={() => onStatus(school)}>
            {school.platformStatus === 'suspended' ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
            {updating ? 'جارٍ الحفظ...' : school.platformStatus === 'suspended' ? 'إعادة التفعيل' : 'إيقاف الحساب'}
          </button>
          <button className="platform-delete-button" type="button" disabled={deleting} onClick={() => onDelete(school)}>
            {deleting ? 'جارٍ إرسال الطلب...' : 'طلب حذف المدرسة'}
          </button>
        </div>
      </td>
    </tr>
  )
}

export function PlatformDashboard() {
  const [schools, setSchools] = useState<PlatformSchoolUsage[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deletingSchoolId, setDeletingSchoolId] = useState('')
  const [updatingSchoolId, setUpdatingSchoolId] = useState('')
  const [openingSchoolId, setOpeningSchoolId] = useState('')
  const [schoolPendingDeletion, setSchoolPendingDeletion] = useState<PlatformSchoolUsage | null>(null)
  const [editingSchool, setEditingSchool] = useState<PlatformSchoolUsage | null>(null)
  const [schoolEditDraft, setSchoolEditDraft] = useState({ schoolName: '', principalName: '', generalEducationAdministration: '', educationOffice: '', academicYear: '', semester: '' })
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deletionNotice, setDeletionNotice] = useState('')

  const loadSchools = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.platformSchools()
      if (!Array.isArray(result.schools)) throw new Error('invalid_platform_school_list')
      setSchools(result.schools)
    } catch {
      setError('تعذر تحميل بيانات المدارس. تحقق من الاتصال والصلاحية، ثم أعد المحاولة.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    api.platformSchools()
      .then(result => {
        if (!Array.isArray(result.schools)) throw new Error('invalid_platform_school_list')
        if (mounted) setSchools(result.schools)
      })
      .catch(() => {
        if (mounted) setError('تعذر تحميل بيانات المدارس. تحقق من الاتصال والصلاحية، ثم أعد المحاولة.')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [])

  const filteredSchools = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar')
    if (!query) return schools
    return schools.filter(school =>
      [school.name, school.activatedBy.name, school.activatedBy.email, ...school.registeredEmails, ...school.teachers]
        .join(' ')
        .toLocaleLowerCase('ar')
        .includes(query),
    )
  }, [schools, search])

  const requestSchoolEdit = (school: PlatformSchoolUsage) => {
    setError('')
    setDeletionNotice('')
    setEditingSchool(school)
    setSchoolEditDraft({
      schoolName: school.name,
      principalName: school.activatedBy.name || '',
      generalEducationAdministration: '',
      educationOffice: '',
      academicYear: '',
      semester: '',
    })
  }

  const cancelSchoolEdit = () => {
    setEditingSchool(null)
    setSchoolEditDraft({ schoolName: '', principalName: '', generalEducationAdministration: '', educationOffice: '', academicYear: '', semester: '' })
    setError('')
  }

  const saveSchoolEdit = async () => {
    if (!editingSchool) return
    setError('')
    setUpdatingSchoolId(editingSchool.id)
    try {
      const profile = {
        schoolName: schoolEditDraft.schoolName.trim(),
        principalName: schoolEditDraft.principalName.trim(),
        generalEducationAdministration: schoolEditDraft.generalEducationAdministration.trim(),
        educationOffice: schoolEditDraft.educationOffice.trim(),
        academicYear: schoolEditDraft.academicYear.trim(),
        semester: schoolEditDraft.semester.trim(),
      }

      if (!profile.schoolName || !profile.principalName) {
        setError('يجب تعبئة اسم المدرسة واسم المدير قبل الحفظ.')
        return
      }

      const result = await api.updatePlatformSchoolProfile(editingSchool.id, profile)
      setSchools(current => current.map(currentSchool => currentSchool.id === editingSchool.id
        ? { ...currentSchool, name: result.school.schoolName, activatedBy: { ...currentSchool.activatedBy, name: result.school.principalName || currentSchool.activatedBy.name } }
        : currentSchool))
      setDeletionNotice('تم تحديث بيانات المدرسة بنجاح.')
      setEditingSchool(null)
    } catch {
      setError('تعذر تحديث بيانات المدرسة. تأكد من صلاحية المشرف ثم أعد المحاولة.')
    } finally {
      setUpdatingSchoolId('')
    }
  }

  const requestSchoolDeletion = (school: PlatformSchoolUsage) => {
    setError('')
    setDeletionNotice('')
    setDeleteConfirmation('')
    setSchoolPendingDeletion(school)
  }

  const cancelSchoolDeletion = () => {
    if (deletingSchoolId) return
    setSchoolPendingDeletion(null)
    setDeleteConfirmation('')
  }

  const removeSchool = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const school = schoolPendingDeletion
    if (!school || deletingSchoolId) return
    if (deleteConfirmation !== school.name) {
      setError('اكتب اسم المدرسة مطابقًا تمامًا لتأكيد الحذف.')
      return
    }
    setDeletingSchoolId(school.id)
    setError('')
    try {
      const result = await api.requestPlatformSchoolDeletion(school.id, deleteConfirmation)
      setSchoolPendingDeletion(null)
      setDeleteConfirmation('')
      setDeletionNotice(`أُرسل رابط تأكيد حذف «${school.name}» إلى بريد المشرف ${result.confirmationEmail}. لن تُحذف المدرسة إلا بعد فتح الرابط وتأكيد الحذف النهائي.`)
    } catch (reason) {
      const apiError = reason as Error & { code?: string }
      setError(apiError.code === 'school_name_confirmation_mismatch'
          ? 'لم يطابق اسم التأكيد؛ لم يُرسل طلب الحذف.'
          : apiError.code === 'email_verification_not_configured' || apiError.code === 'email_send_failed'
            ? 'تعذر إرسال رسالة التأكيد إلى البريد؛ لم تُحذف أي بيانات.'
            : 'تعذر إرسال طلب الحذف. لم تُحذف أي بيانات؛ أعد المحاولة أو راجع إعداد البريد.')
    } finally {
      setDeletingSchoolId('')
    }
  }

  const changeSchoolStatus = async (school: PlatformSchoolUsage) => {
    const suspend = school.platformStatus !== 'suspended'
    const question = suspend
      ? `هل تريد إيقاف حساب ${school.name}؟ سيتم تسجيل خروج جميع مستخدمي المدرسة فورًا، وتبقى البيانات محفوظة.`
      : `هل تريد إعادة تفعيل حساب ${school.name}؟`
    if (!window.confirm(question)) return
    setUpdatingSchoolId(school.id)
    setError('')
    try {
      await api.updatePlatformSchoolStatus(school.id, suspend ? 'suspended' : 'active')
      await loadSchools()
    } catch {
      setError('تعذر تغيير حالة حساب المدرسة. لم يتغير شيء.')
    } finally {
      setUpdatingSchoolId('')
    }
  }

  const openSchool = async (school: PlatformSchoolUsage) => {
    setOpeningSchoolId(school.id)
    setError('')
    try {
      await api.openPlatformSchool(school.id)
      window.location.assign('/')
    } catch (reason) {
      const apiError = reason as Error & { code?: string }
      setError(apiError.code === 'school_suspended'
        ? 'لا يمكن فتح مدرسة موقوفة. أعد تفعيلها أولًا.'
        : 'تعذر فتح جلسة الإشراف لهذه المدرسة.')
      setOpeningSchoolId('')
    }
  }

  const summary = useMemo(() => ({
    schools: schools.length,
    enabled: schools.filter(school => school.platformStatus === 'active').length,
    suspended: schools.filter(school => school.platformStatus === 'suspended').length,
    active: schools.filter(school => school.usage.status === 'active').length,
    loginOnly: schools.filter(school => school.usage.status === 'login_only').length,
    students: schools.reduce((total, school) => total + school.studentCount, 0),
    storage: schools.reduce((total, school) => total + school.storage.totalBytes, 0),
  }), [schools])

  return (
    <section className="platform-dashboard" dir="rtl">
      <div className="platform-dashboard-intro">
        <div>
          <span className="platform-dashboard-kicker">إشراف مركزي</span>
          <h2>المدارس والتفعيل والاستخدام</h2>
          <p>عرض المدارس التي أكملت التسجيل، ومن فعّلها، وأعداد المعلمين والطلاب، ومؤشرات الدخول والتشغيل.</p>
        </div>
        <button className="secondary-button" type="button" onClick={() => void loadSchools()} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'platform-refreshing' : ''} />
          {loading ? 'جارٍ التحديث...' : 'تحديث البيانات'}
        </button>
      </div>

      <div className="platform-summary-grid">
        <article className="platform-summary-card">
          <School size={21} />
          <span>مدارس مفعّلة</span>
          <strong>{formatNumber(summary.enabled)}</strong>
        </article>
        <article className="platform-summary-card">
          <PauseCircle size={21} />
          <span>مدارس موقوفة</span>
          <strong>{formatNumber(summary.suspended)}</strong>
        </article>
        <article className="platform-summary-card">
          <Activity size={21} />
          <span>استخدام فعلي خلال 90 يومًا</span>
          <strong>{formatNumber(summary.active)}</strong>
        </article>
        <article className="platform-summary-card">
          <Users size={21} />
          <span>مدارس دخول فقط</span>
          <strong>{formatNumber(summary.loginOnly)}</strong>
        </article>
        <article className="platform-summary-card">
          <Users size={21} />
          <span>إجمالي الطلاب النشطين</span>
          <strong>{formatNumber(summary.students)}</strong>
        </article>
        <article className="platform-summary-card">
          <Database size={21} />
          <span>حجم البيانات المقدّر</span>
          <strong>{formatBytes(summary.storage)}</strong>
        </article>
      </div>

      <div className="platform-schools-panel">
        <div className="platform-schools-toolbar">
          <div>
            <h3>تفاصيل المدارس</h3>
            <p>{formatNumber(filteredSchools.length)} مدرسة</p>
          </div>
          <label className="platform-search">
            <Search size={18} />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث باسم المدرسة أو المدير أو المعلم" />
          </label>
        </div>

        {error && <div className="platform-error" role="alert">{error}</div>}
        {deletionNotice && <div className="platform-password-notice platform-password-success" role="status">{deletionNotice}</div>}
        {loading && schools.length === 0
          ? <p className="platform-empty">جارٍ تحميل بيانات المدارس...</p>
          : !error && filteredSchools.length === 0
            ? <p className="platform-empty">{schools.length ? 'لا توجد نتائج مطابقة للبحث.' : 'لا توجد مدارس مفعّلة حتى الآن.'}</p>
            : <div className="platform-table-scroll">
              <table className="platform-schools-table">
                <thead>
                  <tr>
                    <th>المدرسة والتفعيل</th>
                    <th>من فعّل النظام</th>
                    <th>المعلمون</th>
                    <th>الطلاب</th>
                    <th>الاستخدام الفعلي</th>
                    <th>الدخول</th>
                    <th>مساحة البيانات</th>
                    <th>إجراء المشرف</th>
                  </tr>
                </thead>
                <tbody>{filteredSchools.map(school => <PlatformSchoolRow key={school.id} school={school} deleting={deletingSchoolId === school.id} updating={updatingSchoolId === school.id} opening={openingSchoolId === school.id} onEdit={requestSchoolEdit} onDelete={requestSchoolDeletion} onStatus={school => void changeSchoolStatus(school)} onOpen={school => void openSchool(school)} />)}</tbody>
              </table>
            </div>}

        <p className="platform-storage-note">
          <Database size={15} />
          إيقاف الحساب يسجل خروج مستخدمي المدرسة ويحفظ بياناتها. طلب الحذف يتطلب كتابة اسم المدرسة ثم تأكيدًا ثانيًا يصل إلى بريد المشرف، ولا يمكن التراجع عنه بعد التأكيد.
        </p>
        <p className="platform-usage-note">
          تصنّف المدرسة غير نشطة إذا لم تُسجّل أي استخدام فعلي خلال آخر 90 يومًا، سواء استخدمت النظام سابقًا أو لم تستخدمه مطلقًا. يشمل الاستخدام الحضور والغياب والرسائل والحصص والسلوك والإحالات وملفات الإنجاز. أعداد الدخول اليومية تبدأ بعد نشر الميزة.
        </p>
      </div>
      {editingSchool && <div className="platform-delete-backdrop" role="presentation" onMouseDown={event => {
        if (event.target === event.currentTarget) cancelSchoolEdit()
      }}>
        <section className="platform-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="platform-edit-title" aria-describedby="platform-edit-description">
          <h3 id="platform-edit-title">تعديل بيانات المدرسة</h3>
          <p id="platform-edit-description">
            يمكنك تعديل اسم المدرسة واسم مديرها من هنا مباشرة، مع حفظ التعديلات على بيانات المؤسسة في قاعدة البيانات.
          </p>
          <div className="platform-edit-form">
            <label>
              <span>اسم المدرسة</span>
              <input value={schoolEditDraft.schoolName} onChange={event => setSchoolEditDraft(current => ({ ...current, schoolName: event.target.value }))} />
            </label>
            <label>
              <span>اسم مدير المدرسة</span>
              <input value={schoolEditDraft.principalName} onChange={event => setSchoolEditDraft(current => ({ ...current, principalName: event.target.value }))} />
            </label>
            <label>
              <span>الإدارة العامة</span>
              <input value={schoolEditDraft.generalEducationAdministration} onChange={event => setSchoolEditDraft(current => ({ ...current, generalEducationAdministration: event.target.value }))} />
            </label>
            <label>
              <span>المكتب / المنطقة</span>
              <input value={schoolEditDraft.educationOffice} onChange={event => setSchoolEditDraft(current => ({ ...current, educationOffice: event.target.value }))} />
            </label>
            <label>
              <span>العام الدراسي</span>
              <input value={schoolEditDraft.academicYear} onChange={event => setSchoolEditDraft(current => ({ ...current, academicYear: event.target.value }))} />
            </label>
            <label>
              <span>الفصل الدراسي</span>
              <input value={schoolEditDraft.semester} onChange={event => setSchoolEditDraft(current => ({ ...current, semester: event.target.value }))} />
            </label>
            {error && <div className="platform-error" role="alert">{error}</div>}
            <div className="platform-delete-dialog-actions">
              <button type="button" className="secondary-button" onClick={cancelSchoolEdit} disabled={Boolean(updatingSchoolId)}>إلغاء</button>
              <button className="platform-delete-button" type="button" onClick={() => void saveSchoolEdit()} disabled={Boolean(updatingSchoolId)}>
                {updatingSchoolId ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          </div>
        </section>
      </div>}
      {schoolPendingDeletion && <div className="platform-delete-backdrop" role="presentation" onMouseDown={event => {
        if (event.target === event.currentTarget) cancelSchoolDeletion()
      }}>
        <section className="platform-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="platform-delete-title" aria-describedby="platform-delete-description">
          <h3 id="platform-delete-title">طلب حذف المدرسة</h3>
          <p id="platform-delete-description">
            لن تُحذف بيانات <strong>{schoolPendingDeletion.name}</strong> الآن. بعد مطابقة الاسم سيُرسل رابط إلى بريد المشرف لتأكيد الحذف النهائي، ولا يمكن التراجع بعد ذلك.
          </p>
          <form onSubmit={event => void removeSchool(event)}>
            <label htmlFor="platform-delete-confirmation">اكتب اسم المدرسة للتأكيد</label>
            <input
              id="platform-delete-confirmation"
              autoComplete="off"
              value={deleteConfirmation}
              onChange={event => setDeleteConfirmation(event.target.value)}
              disabled={Boolean(deletingSchoolId)}
              autoFocus
            />
            {error && <div className="platform-error" role="alert">{error}</div>}
            <div className="platform-delete-dialog-actions">
              <button type="button" className="secondary-button" onClick={cancelSchoolDeletion} disabled={Boolean(deletingSchoolId)}>إلغاء</button>
              <button className="platform-delete-button" type="submit" disabled={Boolean(deletingSchoolId) || deleteConfirmation !== schoolPendingDeletion.name}>
                {deletingSchoolId ? 'جارٍ إرسال الطلب...' : 'إرسال رابط التأكيد'}
              </button>
            </div>
          </form>
        </section>
      </div>}
    </section>
  )
}

export function PlatformSchoolDeletionConfirmation() {
  const [schoolName, setSchoolName] = useState('')
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState('')
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', [])

  useEffect(() => {
    if (!token) {
      setError('رابط تأكيد الحذف غير صالح أو انتهت صلاحيته.')
      setLoading(false)
      return
    }
    let mounted = true
    api.platformSchoolDeletionConfirmation(token)
      .then(result => {
        if (mounted) setSchoolName(result.schoolName)
      })
      .catch(() => {
        if (mounted) setError('رابط تأكيد الحذف غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من بوابة المشرف.')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => { mounted = false }
  }, [token])

  const confirmDeletion = async () => {
    if (!token || confirming || completed) return
    setConfirming(true)
    setError('')
    try {
      const result = await api.confirmPlatformSchoolDeletion(token)
      setSchoolName(result.schoolName)
      setCompleted(true)
    } catch {
      setError('تعذر تأكيد الحذف؛ ربما انتهت صلاحية الرابط أو استُخدم سابقًا. لم تُحذف أي بيانات جديدة.')
    } finally {
      setConfirming(false)
    }
  }

  return <main className="auth-page" dir="rtl">
    <section className="auth-card">
      <div className="auth-icon"><School size={30} /></div>
      <span className="platform-dashboard-kicker">تأكيد عبر بريد المشرف</span>
      {loading
        ? <><h1>جارٍ التحقق من الطلب</h1><p>نراجع صلاحية رابط تأكيد الحذف.</p></>
        : completed
          ? <><h1>تم حذف المدرسة</h1><p>تم حذف مدرسة <strong>{schoolName}</strong> وجميع بياناتها نهائيًا من النظام.</p><a className="auth-submit" href="/supervisor">العودة إلى بوابة المشرف</a></>
          : error
            ? <><h1>تعذر تأكيد الحذف</h1><div className="auth-error" role="alert">{error}</div><a className="auth-back" href="/supervisor">العودة إلى بوابة المشرف</a></>
            : <><h1>تأكيد الحذف النهائي</h1><p>أنت على وشك حذف مدرسة <strong>{schoolName}</strong> وجميع بياناتها وسجلاتها نهائيًا. لا يمكن التراجع عن هذا الإجراء.</p><button className="platform-delete-button" type="button" onClick={() => void confirmDeletion()} disabled={confirming}>{confirming ? 'جارٍ الحذف النهائي...' : 'تأكيد الحذف النهائي'}</button><a className="auth-back" href="/supervisor">إلغاء والعودة إلى بوابة المشرف</a></>}
    </section>
  </main>
}

export function PlatformPortal() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [passwordNotice, setPasswordNotice] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  useEffect(() => {
    api.platformMe()
      .then(result => setAuthenticated(result.authenticated === true))
      .catch(() => setAuthenticated(false))
      .finally(() => setCheckingSession(false))
  }, [])

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await api.platformLogin(username, password)
      setAuthenticated(true)
      setPassword('')
    } catch (reason) {
      const apiError = reason as Error & { code?: string }
      setError(apiError.code === 'platform_login_not_configured'
        ? 'حساب المشرف غير مُعدّ على الخادم بعد.'
        : apiError.code === 'too_many_login_attempts'
          ? 'تم إيقاف المحاولات مؤقتًا. انتظر قليلًا ثم حاول مرة أخرى.'
          : 'اسم المستخدم أو كلمة المرور غير صحيحة.')
    } finally {
      setSubmitting(false)
    }
  }

  const logout = async () => {
    try {
      await api.platformLogout()
    } finally {
      setAuthenticated(false)
      setPassword('')
    }
  }

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPasswordNotice('')
    if (newPassword.length < 10) { setPasswordNotice('يجب أن تتكون كلمة المرور الجديدة من 10 رموز على الأقل.'); return }
    if (newPassword !== passwordConfirmation) { setPasswordNotice('تأكيد كلمة المرور غير مطابق.'); return }
    setPasswordSaving(true)
    try {
      await api.changePlatformPassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordConfirmation('')
      setPasswordPanelOpen(false)
      setPasswordNotice('تم تغيير كلمة مرور المشرف العام بنجاح.')
    } catch (reason) {
      const apiError = reason as Error & { code?: string }
      setPasswordNotice(apiError.code === 'current_password_invalid' ? 'كلمة المرور الحالية غير صحيحة.' : 'تعذر تغيير كلمة المرور. أعد المحاولة.')
    } finally {
      setPasswordSaving(false)
    }
  }

  if (checkingSession) return <main className="auth-page" dir="rtl"><p>جارٍ التحقق من جلسة المشرف...</p></main>

  if (!authenticated) return <main className="auth-page" dir="rtl">
    <section className="auth-card">
      <div className="auth-icon"><LockKeyhole size={30} /></div>
      <span className="platform-dashboard-kicker">دخول مستقل عن المدارس</span>
      <h1>إشراف نظام الحصر المدرسي</h1>
      <p>هذه بوابة المشرف لإدارة ومتابعة المدارس المسجلة. لا تستخدم حساب مدير المدرسة هنا.</p>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form onSubmit={login} autoComplete="on">
        <label>اسم مستخدم المشرف<input name="username" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} required /></label>
        <label><LockKeyhole size={16} /> كلمة مرور المشرف<input name="password" type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        <button className="platform-password-visibility" type="button" aria-pressed={passwordVisible} onClick={() => setPasswordVisible(visible => !visible)}>
          {passwordVisible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        </button>
        <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'جارٍ التحقق...' : 'دخول المشرف'}</button>
      </form>
      <a className="auth-back" href="/">العودة إلى نظام المدارس</a>
    </section>
  </main>

  return <main className="platform-portal" dir="rtl">
    <header className="platform-portal-header">
      <div><strong>إشراف نظام الحصر المدرسي</strong><span>بوابة المشرف المستقلة</span></div>
      <div className="platform-header-actions">
        <button type="button" className="secondary-button" onClick={() => { setPasswordPanelOpen(open => !open); setPasswordNotice('') }}><KeyRound size={16} /> تغيير كلمة المرور</button>
        <button type="button" className="secondary-button" onClick={() => void logout()}><LogOut size={16} /> تسجيل خروج المشرف</button>
      </div>
    </header>
    {passwordPanelOpen && <section className="platform-password-panel" aria-label="تغيير كلمة مرور المشرف">
      <header><KeyRound size={22} /><div><h2>تغيير كلمة المرور</h2><p>استخدم كلمة مرور من 10 رموز على الأقل، ولا تشاركها مع أي مستخدم.</p></div></header>
      <form onSubmit={event => void changePassword(event)}>
        <label>كلمة المرور الحالية<input type="password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
        <label>كلمة المرور الجديدة<input type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} autoComplete="new-password" minLength={10} required /></label>
        <label>تأكيد كلمة المرور الجديدة<input type="password" value={passwordConfirmation} onChange={event => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={10} required /></label>
        {passwordNotice && <p className="platform-password-notice" role="status">{passwordNotice}</p>}
        <div><button type="button" className="secondary-button" onClick={() => setPasswordPanelOpen(false)} disabled={passwordSaving}>إلغاء</button><button className="primary-button" type="submit" disabled={passwordSaving}>{passwordSaving ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور'}</button></div>
      </form>
    </section>}
    {!passwordPanelOpen && passwordNotice && <p className="platform-password-notice platform-password-success" role="status">{passwordNotice}</p>}
    <PlatformDashboard />
  </main>
}
