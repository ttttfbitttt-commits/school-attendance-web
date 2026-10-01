import { useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatHijriDate, formatHijriMonth, hijriMonthDays, numericHijriParts } from './dateUtils'

const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())

type HijriDatePickerProps = {
  label: string
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
}

export function HijriDatePicker({ label, value, onChange, min, max, disabled = false }: HijriDatePickerProps) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(value || today())
  const [view, setView] = useState(() => numericHijriParts(value || today()))
  const days = useMemo(() => hijriMonthDays(view.year, view.month, anchor), [view, anchor])
  const cells: Array<(typeof days)[number] | null> = [...Array(days[0]?.weekday || 0).fill(null), ...days]
  const canChoose = (iso: string) => (!min || iso >= min) && (!max || iso <= max)

  const moveMonth = (direction: number) => {
    const absoluteMonth = view.year * 12 + view.month - 1 + direction
    setView({ year: Math.floor(absoluteMonth / 12), month: ((absoluteMonth % 12) + 12) % 12 + 1, day: 1 })
  }

  const openPicker = () => {
    const current = value || today()
    setAnchor(current)
    setView(numericHijriParts(current))
    setOpen(currentOpen => !currentOpen)
  }

  return <div className="hijri-date-picker">
    <span className="hijri-date-label">{label}</span>
    <button type="button" className="hijri-date-trigger" onClick={openPicker} disabled={disabled} aria-expanded={open}>
      <CalendarDays size={16} aria-hidden="true" />
      <span>{value ? formatHijriDate(value) : 'اختر التاريخ الهجري'}</span>
    </button>
    {open && <div className="hijri-date-popover" role="dialog" aria-label="اختر تاريخاً هجرياً">
      <div className="hijri-date-month-nav">
        <button type="button" onClick={() => moveMonth(-1)} aria-label="الشهر السابق"><ChevronRight size={18} /></button>
        <strong>{formatHijriMonth(view.year, view.month, anchor)}</strong>
        <button type="button" onClick={() => moveMonth(1)} aria-label="الشهر التالي"><ChevronLeft size={18} /></button>
      </div>
      <div className="hijri-date-grid">
        {WEEKDAYS.map(day => <span className="hijri-date-weekday" key={day}>{day}</span>)}
        {cells.map((day, index) => day ? <button
          type="button"
          key={day.iso}
          className={day.iso === value ? 'selected' : ''}
          disabled={!canChoose(day.iso)}
          aria-label={formatHijriDate(day.iso)}
          aria-pressed={day.iso === value}
          onClick={() => { onChange(day.iso); setAnchor(day.iso); setOpen(false) }}
        >{day.hijriDay}</button> : <span key={`empty-${index}`} />)}
      </div>
    </div>}
  </div>
}