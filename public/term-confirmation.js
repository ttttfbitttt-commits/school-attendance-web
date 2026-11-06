const token = new URLSearchParams(window.location.search).get('token') || ''
const statusEl = document.getElementById('status')
const requestPanel = document.getElementById('request-panel')
const successPanel = document.getElementById('success-panel')
const schoolNameEl = document.getElementById('school-name')
const currentTermEl = document.getElementById('current-term')
const targetTermEl = document.getElementById('target-term')
const expiresAtEl = document.getElementById('expires-at')
const confirmButton = document.getElementById('confirm-button')
const cancelButton = document.getElementById('cancel-button')

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Intl.DateTimeFormat('ar-SA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(value))
  } catch {
    return value
  }
}

function showError(message) {
  statusEl.className = 'status error'
  statusEl.textContent = message
  requestPanel.hidden = true
  successPanel.hidden = true
}

async function loadRequest() {
  if (!token) {
    showError('رابط التأكيد غير موجود أو منتهي الصلاحية.')
    return
  }

  try {
    const response = await fetch(`/api/academic-terms/confirmation?token=${encodeURIComponent(token)}`)
    const payload = await response.json()
    if (!response.ok || !payload.request) {
      throw new Error(payload?.error || 'invalid_or_expired_term_confirmation')
    }

    const request = payload.request
    schoolNameEl.textContent = request.schoolName || '—'
    currentTermEl.textContent = `${request.currentAcademicYear || '—'} · ${request.currentSemester || '—'}`
    targetTermEl.textContent = `${request.academicYear || '—'} · ${request.semester || '—'}`
    expiresAtEl.textContent = formatDate(request.expiresAt)

    statusEl.className = 'status'
    statusEl.textContent = 'تم العثور على طلب فتح فصل جديد. يرجى مراجعة التفاصيل ثم تأكيده.'
    requestPanel.hidden = false
  } catch (error) {
    showError('رابط التحقق غير صالح أو انتهت صلاحيته. يرجى طلب رابط جديد من حساب المدرسة.')
  }
}

async function confirmRequest() {
  if (!token) {
    showError('لا يوجد رمز تأكيد صالح.')
    return
  }

  confirmButton.disabled = true
  statusEl.className = 'status'
  statusEl.textContent = 'جارٍ تأكيد الأرشفة…'

  try {
    const response = await fetch('/api/academic-terms/confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new Error(payload?.error || 'term_confirmation_failed')
    }

    requestPanel.hidden = true
    successPanel.hidden = false
    statusEl.className = 'status success'
    statusEl.textContent = 'تمت الموافقة على الأرشفة بنجاح، وتم فتح الفصل الجديد.'
  } catch (error) {
    confirmButton.disabled = false
    showError('تعذر إتمام التأكيد. قد يكون الرابط منتهي الصلاحية أو مستخدمًا بالفعل.')
  }
}

confirmButton.addEventListener('click', confirmRequest)
cancelButton.addEventListener('click', () => window.close())

loadRequest()
