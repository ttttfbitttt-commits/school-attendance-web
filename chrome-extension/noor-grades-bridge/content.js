(() => {
  const digits = value => String(value ?? '').replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x06f0))
  const normal = value => digits(value).toLowerCase().replace(/[\u064b-\u065f\u0670]/g, '').replace(/[إأآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
  const numeric = value => {
    const text = digits(value).replace(/[^0-9.]/g, '')
    return text ? Number(text) : Number.NaN
  }
  const visible = element => {
    const style = window.getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
  }
  const getIdentity = row => {
    const texts = Array.from(row.querySelectorAll(':scope > td, :scope > th')).map(cell => digits(cell.innerText || cell.textContent || ''))
    texts.push(digits(row.innerText || row.textContent || ''))
    for (const text of texts) {
      const match = text.match(/(?:^|\D)(\d{7,20})(?:\D|$)/)
      if (match) return match[1]
    }
    return ''
  }
  const directCells = row => Array.from(row.children).filter(cell => /^(TD|TH)$/.test(cell.tagName))
  const indexedCells = row => {
    const cells = []
    let index = 0
    for (const cell of directCells(row)) {
      const span = Math.max(1, Number(cell.colSpan) || 1)
      for (let offset = 0; offset < span; offset += 1) cells[index + offset] = cell
      index += span
    }
    return cells
  }
  const rowName = row => {
    const cells = directCells(row)
    const candidate = cells.map(cell => (cell.innerText || '').trim()).filter(text => text && !/\d{7,}/.test(digits(text))).sort((a, b) => b.length - a.length)[0]
    return candidate || ''
  }
  const inputSelector = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset])'
  const scoreInputs = row => Array.from(row.querySelectorAll(inputSelector)).filter(input => visible(input) && !input.disabled && (input.type === 'text' || input.type === 'number' || input.type === 'tel' || !input.type))
  const tableRows = table => Array.from(table.querySelectorAll('tr')).filter(row => row.closest('table') === table)
  const studentRows = table => tableRows(table).filter(row => getIdentity(row) && scoreInputs(row).length)
  const pageTables = () => Array.from(document.querySelectorAll('table')).map(table => ({ table, rows: studentRows(table) })).filter(item => item.rows.length)
  const ignoreColumn = label => /ملاحظ|مجموع|رقم الهويه|رقم الهوية|الطالب|اسم الطالب|تقدير|حاله|حالة/.test(normal(label))
  const maxFromText = text => {
    const values = [...digits(text).matchAll(/\d+(?:\.\d+)?/g)].map(match => Number(match[0])).filter(Number.isFinite)
    return values.length ? values[values.length - 1] : null
  }
  const headersFor = (table, firstStudent) => {
    const allRows = tableRows(table)
    const firstIndex = allRows.indexOf(firstStudent)
    const theadRows = Array.from(table.querySelectorAll('thead tr')).filter(row => row.closest('table') === table)
    const fallback = allRows.slice(0, Math.max(0, firstIndex)).filter(row => directCells(row).some(cell => (cell.innerText || cell.textContent || '').trim()))
    return (theadRows.length ? theadRows : fallback).map(indexedCells)
  }
  const labelsAt = (headerRows, cellIndex) => headerRows.map(cells => cells[cellIndex]).filter(Boolean).map(cell => (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  const findStatusSelect = input => {
    const cell = input.closest('td,th')
    if (!cell) return null
    const candidates = [cell, cell.previousElementSibling, cell.nextElementSibling]
      .filter(Boolean)
      .flatMap(element => Array.from(element.querySelectorAll('select')))
      .filter(select => visible(select) && !select.disabled)
    return candidates.find(select => {
      const options = Array.from(select.options).map(option => normal(option.textContent))
      return options.some(text => text.includes('حاضر')) && options.some(text => text.includes('غائب'))
    }) || null
  }
  const inputCellIndex = (input, cells) => cells.indexOf(input.closest('td,th'))
  const inputOrdinal = (input, cell) => scoreInputs(cell).indexOf(input)
  const buildStructure = () => {
    const candidates = pageTables().sort((left, right) => right.rows.length - left.rows.length)
    if (!candidates.length) return { error: 'لم يتم العثور على جدول طلاب يحتوي أرقام هوية وخانات درجات.' }
    const { table, rows } = candidates[0]
    const firstRow = rows[0]
    const headers = headersFor(table, firstRow)
    const firstCells = indexedCells(firstRow)
    const fields = []
    const seen = new Set()
    for (const input of scoreInputs(firstRow)) {
      const cell = input.closest('td,th')
      const cellIndex = inputCellIndex(input, firstCells)
      const ordinal = inputOrdinal(input, cell)
      const headerLabels = labelsAt(headers, cellIndex)
      const label = headerLabels.join(' / ') || input.getAttribute('aria-label') || input.getAttribute('title') || `عمود درجات ${fields.length + 1}`
      const key = `${cellIndex}:${ordinal}`
      if (cellIndex < 0 || seen.has(key) || ignoreColumn(label)) continue
      seen.add(key)
      const maxScore = Number(input.max) || maxFromText(label)
      fields.push({ id: `column-${cellIndex}-${ordinal}`, label, maxScore: Number.isFinite(maxScore) && maxScore > 0 ? maxScore : null, cellIndex, ordinal, hasStatus: Boolean(findStatusSelect(input)) })
    }
    if (!fields.length) return { error: 'تم العثور على الطلاب، لكن تعذر تمييز أعمدة الدرجات. تأكد من فتح شاشة رصد الدرجات بعد البحث.' }
    return { table, rows, fields }
  }
  const getControls = (row, fields) => {
    const cells = indexedCells(row)
    const controls = {}
    for (const field of fields) {
      const cell = cells[field.cellIndex]
      const input = cell ? scoreInputs(cell)[field.ordinal] : null
      if (input) controls[field.id] = { input, statusSelect: findStatusSelect(input) }
    }
    return controls
  }
  const nativeSet = (input, value) => {
    const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    if (setter) setter.call(input, value)
    else input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('blur', { bubbles: true }))
  }
  const setPresent = select => {
    const option = Array.from(select.options).find(item => normal(item.textContent).includes('حاضر'))
    if (!option) return
    select.value = option.value
    select.dispatchEvent(new Event('input', { bubbles: true }))
    select.dispatchEvent(new Event('change', { bubbles: true }))
    select.dispatchEvent(new Event('blur', { bubbles: true }))
  }
  const mark = input => {
    input.classList.add('h2030-filled-score')
    window.setTimeout(() => input.classList.remove('h2030-filled-score'), 5000)
  }
  const showBanner = text => {
    document.getElementById('h2030-noor-banner')?.remove()
    const banner = document.createElement('aside')
    banner.id = 'h2030-noor-banner'
    banner.setAttribute('role', 'status')
    banner.textContent = text
    document.body.appendChild(banner)
    window.setTimeout(() => banner.remove(), 10000)
  }
  const scan = () => {
    const structure = buildStructure()
    if (structure.error) return { ok: false, error: structure.error }
    const identities = new Set()
    return {
      ok: true,
      fields: structure.fields.map(({ cellIndex, ordinal, ...field }) => field),
      students: structure.rows.map((row, rowIndex) => {
        const identityNumber = getIdentity(row)
        identities.add(identityNumber)
        return { identityNumber, name: rowName(row), rowIndex }
      }),
      matched: 0,
      unmatched: structure.rows.length,
      title: document.title,
    }
  }
  const inspectWithTransfer = transfer => {
    const response = scan()
    if (!response.ok || !transfer?.students) return response
    const ids = new Set(transfer.students.map(student => digits(student.identityNumber).replace(/\D/g, '')))
    const matched = response.students.filter(student => ids.has(student.identityNumber)).length
    return { ...response, matched, unmatched: response.students.length - matched }
  }
  const fill = ({ transfer, mappings, statusMode }) => {
    const structure = buildStructure()
    if (structure.error) return { ok: false, error: structure.error }
    const fieldById = Object.fromEntries(structure.fields.map(field => [field.id, field]))
    const sourceById = Object.fromEntries((transfer?.columns || []).map(column => [column.id, column]))
    const studentsByIdentity = Object.fromEntries((transfer?.students || []).map(student => [digits(student.identityNumber).replace(/\D/g, ''), student]))
    const mappingEntries = Object.entries(mappings || [])
    if (!mappingEntries.length) return { ok: false, error: 'لم تصل مطابقة الأعمدة من الإضافة.' }
    const duplicateTargets = new Set()
    for (const [, targetId] of mappingEntries) {
      if (!fieldById[targetId] || duplicateTargets.has(targetId)) return { ok: false, error: 'مطابقة الأعمدة غير صالحة. افحص الصفحة وراجع المطابقة.' }
      duplicateTargets.add(targetId)
    }
    let matched = 0
    let filledCells = 0
    let skippedCells = 0
    const filledIdentityNumbers = []
    for (const row of structure.rows) {
      const identity = getIdentity(row)
      const student = studentsByIdentity[identity]
      if (!student) continue
      matched += 1
      let filledStudent = false
      const controls = getControls(row, structure.fields)
      for (const [sourceId, targetId] of mappingEntries) {
        const source = sourceById[sourceId]
        const target = fieldById[targetId]
        const raw = student.scores?.[sourceId]
        if (raw === undefined || raw === null || raw === '') continue
        const value = numeric(raw)
        const sourceMaximum = Number(source?.maxScore)
        const targetMaximum = Number(target?.maxScore)
        if (!Number.isFinite(value) || value < 0 || (Number.isFinite(sourceMaximum) && value > sourceMaximum) || (Number.isFinite(targetMaximum) && value > targetMaximum)) { skippedCells += 1; continue }
        const control = controls[targetId]
        if (!control) { skippedCells += 1; continue }
        nativeSet(control.input, String(value))
        mark(control.input)
        if (statusMode === 'present-if-score' && control.statusSelect) setPresent(control.statusSelect)
        filledCells += 1
        filledStudent = true
      }
      if (filledStudent) filledIdentityNumbers.push(identity)
    }
    showBanner(`حصر 2030: تمت تعبئة ${filledCells} خانة. راجع الدرجات ثم استخدم حفظ أو انتقال نور المعتاد.`)
    return { ok: true, matched, filledCells, skippedCells, filledIdentityNumbers }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      if (message?.type === 'NOOR_SCAN') sendResponse(inspectWithTransfer(message.transfer))
      else if (message?.type === 'NOOR_FILL') sendResponse(fill(message))
      else sendResponse({ ok: false, error: 'طلب غير معروف.' })
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'تعذر تنفيذ العملية داخل صفحة نور.' })
    }
    return true
  })
})()
