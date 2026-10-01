const RIYADH = 'Asia/Riyadh'
const HIJRI_LONG = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: RIYADH,
})
const HIJRI_PARTS = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
  day: 'numeric', month: 'numeric', year: 'numeric', timeZone: RIYADH,
})
const MILADI_ISO = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: RIYADH,
})

function dateValue(value: string | Date) {
  if (value instanceof Date) return value
  const text = value.trim()
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00+03:00` : text)
}

export function formatHijriDate(value: string | Date) {
  return HIJRI_LONG.format(dateValue(value))
}

export function formatHijriDateWithWeekday(value: string | Date) {
  return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: RIYADH,
  }).format(dateValue(value))
}

export function formatHijriDateTime(value: string | Date) {
  return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: RIYADH,
  }).format(dateValue(value))
}

export function numericHijriParts(value: string | Date) {
  const parts = Object.fromEntries(HIJRI_PARTS.formatToParts(dateValue(value))
    .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]))
  return { year: parts.year || 0, month: parts.month || 0, day: parts.day || 0 }
}

export function hijriMonthDays(year: number, month: number, anchor: string) {
  const anchorDate = dateValue(anchor)
  const anchorParts = numericHijriParts(anchorDate)
  const monthDifference = (year - anchorParts.year) * 12 + month - anchorParts.month
  const guess = anchorDate.getTime() + Math.round(monthDifference * 29.530588853 * 86_400_000) - (anchorParts.day - 1) * 86_400_000
  let start: Date | null = null
  for (let offset = -24; offset <= 24; offset += 1) {
    const candidate = new Date(guess + offset * 86_400_000)
    const parts = numericHijriParts(candidate)
    if (parts.year === year && parts.month === month && parts.day === 1) {
      start = candidate
      break
    }
  }
  if (!start) return []

  const days: Array<{ hijriDay: number; iso: string; weekday: number }> = []
  for (let index = 0; index < 31; index += 1) {
    const date = new Date(start.getTime() + index * 86_400_000)
    const parts = numericHijriParts(date)
    if (parts.year !== year || parts.month !== month) break
    days.push({ hijriDay: parts.day, iso: MILADI_ISO.format(date), weekday: date.getUTCDay() })
  }
  return days
}

export function formatHijriMonth(year: number, month: number, anchor: string) {
  const firstDay = hijriMonthDays(year, month, anchor)[0]
  if (!firstDay) return `${month} / ${year} هـ`
  return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
    month: 'long', year: 'numeric', timeZone: RIYADH,
  }).format(dateValue(firstDay.iso))
}