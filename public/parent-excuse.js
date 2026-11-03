const token = new URLSearchParams(location.search).get('token') || ''
const loading = document.querySelector('#loading')
const requestPanel = document.querySelector('#request')
const completePanel = document.querySelector('#completed')
const errorPanel = document.querySelector('#form-error')
const canvas = document.querySelector('#signature')
const clearButton = document.querySelector('#clear-signature')
const submitButton = document.querySelector('#submit')
let context = null
let signing = false
let hasInk = false

function showError(message) {
  loading.textContent = message
  loading.hidden = false
  requestPanel.hidden = true
}

function clearSignature() {
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  hasInk = false
}

function point(event) {
  const bounds = canvas.getBoundingClientRect()
  return { x: (event.clientX - bounds.left) * (canvas.width / bounds.width), y: (event.clientY - bounds.top) * (canvas.height / bounds.height) }
}

function prepareCanvas() {
  const bounds = canvas.getBoundingClientRect()
  const ratio = Math.max(window.devicePixelRatio || 1, 1)
  canvas.width = Math.max(2, Math.floor(bounds.width * ratio))
  canvas.height = Math.max(2, Math.floor(bounds.height * ratio))
  context = canvas.getContext('2d')
  context.strokeStyle = '#1268c4'
  context.lineWidth = 5 * ratio
  context.lineCap = 'round'
  context.lineJoin = 'round'
  clearSignature()
  canvas.addEventListener('pointerdown', event => {
    signing = true; hasInk = true; canvas.setPointerCapture(event.pointerId)
    const p = point(event); context.beginPath(); context.moveTo(p.x, p.y)
  })
  canvas.addEventListener('pointermove', event => {
    if (!signing) return
    const p = point(event); context.lineTo(p.x, p.y); context.stroke()
  })
  const stop = () => { signing = false }
  canvas.addEventListener('pointerup', stop)
  canvas.addEventListener('pointercancel', stop)
  clearButton.addEventListener('click', clearSignature)
}

function setText(id, value) { document.querySelector(id).textContent = value || '—' }

function showCompleted(status) {
  completePanel.hidden = false
  completePanel.innerHTML = `<strong>${status === 'approved' ? 'تمت الموافقة على الاستئذان' : 'تم رفض الاستئذان'}</strong><span>${status === 'approved' ? 'شكرًا لك. وصل قرارك وتوقيعك إلى سجل المدرسة.' : 'شكرًا لك. وصل قرارك وتوقيعك إلى سجل المدرسة.'}</span><button id="close-page" type="button">إغلاق الصفحة</button>`
  completePanel.querySelector('#close-page').addEventListener('click', () => {
    window.close()
    window.setTimeout(() => {
      if (!window.closed && window.history.length > 1) window.history.back()
    }, 180)
  })
}

async function loadRequest() {
  if (!token) { showError('رابط الاستئذان غير مكتمل أو غير صالح.'); return }
  try {
    const response = await fetch(`/api/student-excuses/public?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'link_not_found')
    const item = data.request
    if (item.status !== 'pending') {
      loading.hidden = true
      showCompleted(item.status)
      return
    }
    setText('#school-name', item.schoolName)
    setText('#student-name', item.studentName)
    setText('#student-class', `${item.grade} · الفصل ${item.classroom}`)
    setText('#request-date', `${item.weekday} — ${item.requestDate}`)
    setText('#request-reason', item.reasonLabel)
    loading.hidden = true
    requestPanel.hidden = false
    prepareCanvas()
  } catch {
    showError('تعذر فتح الرابط. ربما انتهت صلاحيته أو تم استخدامه مسبقًا.')
  }
}

submitButton.addEventListener('click', async () => {
  const decision = document.querySelector('input[name="decision"]:checked')?.value
  errorPanel.hidden = true
  if (!decision) { errorPanel.textContent = 'اختر الموافقة أو الرفض أولًا.'; errorPanel.hidden = false; return }
  if (!hasInk) { errorPanel.textContent = 'التوقيع مطلوب قبل إرسال القرار.'; errorPanel.hidden = false; return }
  submitButton.disabled = true
  submitButton.textContent = 'جارٍ إرسال القرار…'
  try {
    const response = await fetch(`/api/student-excuses/public/respond?token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ decision, signatureData: canvas.toDataURL('image/png') }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'response_failed')
    requestPanel.hidden = true
    showCompleted(decision)
  } catch {
    errorPanel.textContent = 'تعذر إرسال القرار. تحقق من الاتصال ثم حاول مرة أخرى.'
    errorPanel.hidden = false
    submitButton.disabled = false
    submitButton.textContent = 'إرسال قرار ولي الأمر'
  }
})

void loadRequest()
