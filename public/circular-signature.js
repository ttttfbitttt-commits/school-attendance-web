const token = new URLSearchParams(location.search).get('token') || ''
const loading = document.querySelector('#loading')
const content = document.querySelector('#content')
const complete = document.querySelector('#complete')
const canvas = document.querySelector('#signature')
const clearButton = document.querySelector('#clear')
const signButton = document.querySelector('#sign')
const errorBox = document.querySelector('#error')
let context = null
let drawing = false
let hasInk = false

function text(id, value) { document.querySelector(id).textContent = value || '—' }
function fail(message) { loading.textContent = message; loading.hidden = false; content.hidden = true }
function weekday(date) { return ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'][new Date(`${date}T12:00:00Z`).getUTCDay()] || '' }
function clearSignature() { if (context) { context.clearRect(0, 0, canvas.width, canvas.height); hasInk = false } }
function point(event) { const box = canvas.getBoundingClientRect(); return { x: (event.clientX - box.left) * canvas.width / box.width, y: (event.clientY - box.top) * canvas.height / box.height } }
function setupCanvas() { const box = canvas.getBoundingClientRect(); const scale = Math.max(window.devicePixelRatio || 1, 1); canvas.width = Math.max(2, Math.floor(box.width * scale)); canvas.height = Math.max(2, Math.floor(box.height * scale)); context = canvas.getContext('2d'); context.strokeStyle = '#1268c4'; context.lineWidth = 5 * scale; context.lineCap = 'round'; context.lineJoin = 'round'; clearSignature(); canvas.addEventListener('pointerdown', event => { drawing = true; hasInk = true; canvas.setPointerCapture(event.pointerId); const p = point(event); context.beginPath(); context.moveTo(p.x,p.y) }); canvas.addEventListener('pointermove', event => { if (!drawing) return; const p=point(event); context.lineTo(p.x,p.y); context.stroke() }); canvas.addEventListener('pointerup', () => { drawing=false }); canvas.addEventListener('pointercancel', () => { drawing=false }); clearButton.addEventListener('click', clearSignature) }
function showComplete() { content.hidden = true; complete.hidden = false; complete.innerHTML = '<strong>تم التوقيع بالعلم والاطلاع</strong><span>شكرًا لك. وصل توقيعك إلى سجل التعميم في المدرسة.</span><button id="close-page" type="button">إغلاق الصفحة</button>'; complete.querySelector('#close-page').addEventListener('click', () => { window.close(); window.setTimeout(() => { if (!window.closed && history.length > 1) history.back() }, 180) }) }

async function load() { if (!token) { fail('رابط التعميم غير مكتمل أو غير صالح.'); return } try { const response = await fetch(`/api/circulars/public?token=${encodeURIComponent(token)}`, { cache:'no-store' }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(); const circular = data.circular; if (circular.status !== 'pending') { loading.hidden=true; showComplete(); return } text('#title', circular.title); text('#school', circular.schoolName); text('#teacher', circular.teacherName); text('#date', `${weekday(circular.circularDate)} — ${circular.circularDate}`); text('#file-name', circular.fileName); const viewer = document.querySelector('#file-viewer'); if (circular.fileType === 'application/pdf') { const object=document.createElement('object'); object.data=circular.fileData; object.type='application/pdf'; object.innerHTML='يتعذر عرض ملف PDF في هذا المتصفح. يرجى تنزيله وقراءته.'; viewer.append(object) } else { const image=document.createElement('img'); image.src=circular.fileData; image.alt='مرفق التعميم'; viewer.append(image) } loading.hidden=true; content.hidden=false; setupCanvas() } catch { fail('تعذر فتح رابط التعميم. قد يكون الرابط غير صالح أو تم استبداله برابط أحدث.') } }

signButton.addEventListener('click', async () => { errorBox.hidden=true; if (!hasInk) { errorBox.textContent='التوقيع مطلوب بعد قراءة التعميم.'; errorBox.hidden=false; return } signButton.disabled=true; signButton.textContent='جارٍ حفظ التوقيع…'; try { const response=await fetch(`/api/circulars/public/sign?token=${encodeURIComponent(token)}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({signatureData:canvas.toDataURL('image/png')}) }); if (!response.ok) throw new Error(); showComplete() } catch { errorBox.textContent='تعذر حفظ التوقيع. تحقق من الاتصال ثم أعد المحاولة.'; errorBox.hidden=false; signButton.disabled=false; signButton.textContent='التوقيع بالعلم' } })
void load()
