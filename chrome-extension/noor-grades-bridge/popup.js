(() => {
  const fileInput = document.getElementById('transfer-file')
  const transferSummary = document.getElementById('transfer-summary')
  const clearButton = document.getElementById('clear-transfer')
  const scanButton = document.getElementById('scan-page')
  const scanSummary = document.getElementById('scan-summary')
  const mappingCard = document.getElementById('mapping-card')
  const mappingList = document.getElementById('mapping-list')
  const fillButton = document.getElementById('fill-page')
  const setPresent = document.getElementById('set-present')
  const result = document.getElementById('result')
  const progress = document.getElementById('progress')
  let transfer = null
  let scan = null
  let mappings = {}

  const digits = value => String(value ?? '').replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
  const normal = value => digits(value).toLowerCase().replace(/[\u064b-\u065f\u0670]/g, '').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
  const storageGet = keys => new Promise(resolve => chrome.storage.local.get(keys, resolve))
  const storageSet = data => new Promise(resolve => chrome.storage.local.set(data, resolve))
  const storageClear = keys => new Promise(resolve => chrome.storage.local.remove(keys, resolve))
  const activeTab = () => new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0])))
  const messagePage = async (type, payload = {}) => {
    const tab = await activeTab()
    if (!tab?.id) throw new Error('تعذر الوصول إلى تبويب نور الحالي.')
    return await new Promise((resolve, reject) => chrome.tabs.sendMessage(tab.id, { type, ...payload }, response => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error('افتح صفحة رصد الدرجات داخل نظام نور ثم أعد المحاولة.'))
      else if (!response?.ok) reject(new Error(response?.error || 'تعذر قراءة صفحة نور.'))
      else resolve(response)
    }))
  }
  const setSummary = (element, text, empty = false) => { element.textContent = text; element.classList.toggle('empty', empty) }
  const setResult = (text, type = 'success') => { result.textContent = text; result.className = `result ${type}` }
  const hideResult = () => { result.className = 'result hidden'; result.textContent = '' }

  function validTransfer(value) {
    if (!value || value.format !== '7asr2030-noor-transfer' || value.version !== 1) return 'هذا ليس ملف إضافة نور صادرًا من نظام الحصر.'
    if (!Array.isArray(value.columns) || !value.columns.length) return 'الملف لا يحتوي على أعمدة درجات.'
    if (!Array.isArray(value.students) || !value.students.length) return 'الملف لا يحتوي على طلاب.'
    const ids = new Set()
    for (const student of value.students) {
      const id = digits(student?.identityNumber).replace(/\D/g, '')
      if (!id) return 'يوجد طالب بلا رقم هوية في الملف.'
      if (ids.has(id)) return `رقم الهوية ${id} مكرر في الملف.`
      ids.add(id)
    }
    return ''
  }

  function renderTransfer() {
    if (!transfer) {
      setSummary(transferSummary, 'لم يتم اختيار ملف بعد.', true)
      clearButton.disabled = true
      scanButton.disabled = true
      progress.textContent = '—'
      return
    }
    const labels = transfer.columns.map(column => `${column.label} (${digits(column.maxScore)})`).join('، ')
    setSummary(transferSummary, `المادة: ${transfer.subject || '—'} · الصف: ${transfer.grade || '—'} · الفصل: ${transfer.classroom || '—'}\n${transfer.students.length} طالبًا · ${transfer.columns.length} أعمدة: ${labels}`)
    clearButton.disabled = false
    scanButton.disabled = false
    updateProgress()
  }

  function updateProgress() {
    if (!transfer) { progress.textContent = '—'; return }
    storageGet(['noorCompletedIds']).then(data => {
      const completed = Array.isArray(data.noorCompletedIds) ? data.noorCompletedIds.length : 0
      progress.textContent = `تمت معالجة ${completed} من ${transfer.students.length}`
    })
  }

  function guessMapping(source, fields) {
    const sourceLabel = normal(source.label)
    const sourceMax = Number(source.maxScore)
    const exact = fields.find(field => normal(field.label) === sourceLabel && (!field.maxScore || Number(field.maxScore) === sourceMax))
    if (exact) return exact.id
    const sameMax = fields.filter(field => Number(field.maxScore) === sourceMax)
    return sameMax.length === 1 ? sameMax[0].id : ''
  }

  function renderMappings() {
    mappingList.replaceChildren()
    if (!transfer || !scan) return
    transfer.columns.forEach(source => {
      const row = document.createElement('div')
      row.className = 'mapping-row'
      const title = document.createElement('div')
      title.className = 'mapping-source'
      title.textContent = source.label
      const score = document.createElement('small')
      score.textContent = ` — من ${digits(source.maxScore)}`
      title.appendChild(score)
      const select = document.createElement('select')
      select.dataset.sourceId = source.id
      const empty = document.createElement('option')
      empty.value = ''
      empty.textContent = '— اختر عمود نور المناظر —'
      select.appendChild(empty)
      scan.fields.forEach(field => {
        const option = document.createElement('option')
        option.value = field.id
        option.textContent = `${field.label || 'عمود درجات'}${field.maxScore ? ` — من ${digits(field.maxScore)}` : ''}`
        select.appendChild(option)
      })
      const current = mappings[source.id]
      select.value = scan.fields.some(field => field.id === current) ? current : guessMapping(source, scan.fields)
      mappings[source.id] = select.value
      select.addEventListener('change', () => { mappings[source.id] = select.value; hideResult(); updateFillAvailability() })
      row.append(title, select)
      mappingList.appendChild(row)
    })
    updateFillAvailability()
  }

  function mappingIssue() {
    if (!transfer || !scan) return 'افحص صفحة نور أولًا.'
    const selected = transfer.columns.map(column => mappings[column.id]).filter(Boolean)
    if (selected.length !== transfer.columns.length) return 'اختر عمود نور لكل عمود درجات في الملف.'
    if (new Set(selected).size !== selected.length) return 'لا يمكن ربط أكثر من عمود في الملف بالعمود نفسه في نور.'
    return ''
  }

  function updateFillAvailability() {
    fillButton.disabled = Boolean(mappingIssue()) || !scan?.matched
  }

  async function inspectPage() {
    hideResult()
    scanButton.disabled = true
    scanButton.textContent = 'جارٍ فحص الصفحة…'
    try {
      scan = await messagePage('NOOR_SCAN', { transfer })
      if (!scan.fields.length) throw new Error('لم يتم العثور على خانات درجات واضحة في الصفحة. تأكد من فتح صفحة رصد الدرجات بعد البحث.')
      setSummary(scanSummary, `تم العثور على ${scan.students.length} طالبًا في الصفحة: ${scan.matched} مطابقون لملفك و${scan.unmatched} غير موجودين في الملف. تم العثور على ${scan.fields.length} أعمدة درجات قابلة للمطابقة.`)
      mappingCard.classList.remove('hidden')
      renderMappings()
    } catch (error) {
      scan = null
      mappingCard.classList.add('hidden')
      setSummary(scanSummary, error.message || 'تعذر فحص الصفحة.', true)
      setResult(error.message || 'تعذر فحص الصفحة.', 'error')
    } finally {
      scanButton.disabled = !transfer
      scanButton.textContent = 'فحص الصفحة الحالية'
    }
  }

  async function fillPage() {
    const issue = mappingIssue()
    if (issue) { setResult(issue, 'error'); return }
    const yes = window.confirm(`سيتم تعبئة درجات ${scan.matched} طالبًا مطابقًا في الصفحة الحالية فقط.\nلن تضغط الإضافة حفظ أو انتقال. راجع النتائج قبل استخدام أزرار نور.\n\nهل تريد المتابعة؟`)
    if (!yes) return
    hideResult()
    fillButton.disabled = true
    fillButton.textContent = 'جارٍ تعبئة الصفحة…'
    try {
      const response = await messagePage('NOOR_FILL', { transfer, mappings, statusMode: setPresent.checked ? 'present-if-score' : 'preserve' })
      const previous = await storageGet(['noorCompletedIds'])
      const done = new Set(Array.isArray(previous.noorCompletedIds) ? previous.noorCompletedIds : [])
      ;(response.filledIdentityNumbers || []).forEach(identity => done.add(identity))
      await storageSet({ noorCompletedIds: [...done] })
      updateProgress()
      const skipped = response.skippedCells ? `، وتُركت ${response.skippedCells} خانات لأنها فارغة أو خارج الدرجة المسموح بها` : ''
      setResult(`تمت مطابقة ${response.matched} طالبًا وتعبئة ${response.filledCells} خانة${skipped}. راجع الدرجات ثم احفظ أو انتقل من أزرار نور المعتادة.`)
    } catch (error) {
      setResult(error.message || 'تعذرت تعبئة الصفحة.', 'error')
    } finally {
      fillButton.textContent = 'تعبئة درجات هذه الصفحة'
      updateFillAvailability()
    }
  }

  fileInput.addEventListener('change', async () => {
    hideResult()
    const file = fileInput.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      const issue = validTransfer(parsed)
      if (issue) throw new Error(issue)
      transfer = parsed
      scan = null
      mappings = {}
      mappingCard.classList.add('hidden')
      setSummary(scanSummary, 'افتح صفحة إدخال الدرجات في نور ثم افحصها.', true)
      await storageSet({ noorTransfer: transfer, noorCompletedIds: [] })
      renderTransfer()
    } catch (error) {
      transfer = null
      await storageClear(['noorTransfer', 'noorCompletedIds'])
      renderTransfer()
      setResult(error.message || 'تعذر قراءة الملف.', 'error')
    }
  })
  clearButton.addEventListener('click', async () => {
    transfer = null; scan = null; mappings = {}; fileInput.value = ''
    mappingCard.classList.add('hidden')
    await storageClear(['noorTransfer', 'noorCompletedIds'])
    renderTransfer()
    setSummary(scanSummary, 'افتح صفحة إدخال الدرجات في نور ثم افحصها.', true)
    hideResult()
  })
  scanButton.addEventListener('click', inspectPage)
  fillButton.addEventListener('click', fillPage)

  storageGet(['noorTransfer']).then(data => {
    const issue = validTransfer(data.noorTransfer)
    if (!issue) transfer = data.noorTransfer
    renderTransfer()
  })
})()
