/** Gregorian calendar with Latin digits — what a shop counter actually reads. */
const AR = 'ar-SA-u-ca-gregory-nu-latn'

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

let currencyCode = 'SAR'
export function setCurrency(code: string) {
  currencyCode = code
}

export function money(n: number, opts: { compact?: boolean } = {}): string {
  const v = round2(n || 0)
  if (opts.compact && Math.abs(v) >= 10000) {
    return (
      new Intl.NumberFormat(AR, { notation: 'compact', maximumFractionDigits: 1 }).format(v) +
      ' ' +
      symbol()
    )
  }
  return (
    new Intl.NumberFormat(AR, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) +
    ' ' +
    symbol()
  )
}

export function symbol(): string {
  return currencyCode === 'SAR' ? 'ر.س' : currencyCode
}

export function num(n: number, digits = 0): string {
  return new Intl.NumberFormat(AR, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n || 0)
}

export function percent(n: number, digits = 1): string {
  return `${new Intl.NumberFormat(AR, { maximumFractionDigits: digits }).format(n || 0)}٪`
}

export function date(ts: number): string {
  return new Intl.DateTimeFormat(AR, { dateStyle: 'medium' }).format(new Date(ts))
}

export function dateTime(ts: number): string {
  return new Intl.DateTimeFormat(AR, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(ts),
  )
}

export function time(ts: number): string {
  return new Intl.DateTimeFormat(AR, { timeStyle: 'short' }).format(new Date(ts))
}

export function relative(ts: number): string {
  const diff = ts - Date.now()
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(AR, { numeric: 'auto' })
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (abs < hour) return rtf.format(Math.round(diff / min), 'minute')
  if (abs < day) return rtf.format(Math.round(diff / hour), 'hour')
  if (abs < 30 * day) return rtf.format(Math.round(diff / day), 'day')
  return date(ts)
}

/** Profit margin as a share of the selling price (not of cost). */
export function marginPercent(price: number, cost: number): number {
  if (!price) return 0
  return ((price - cost) / price) * 100
}

export function startOfDay(d = new Date()): number {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x.getTime()
}

export function endOfDay(d = new Date()): number {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x.getTime()
}

export function daysAgo(n: number): number {
  return startOfDay(new Date(Date.now() - n * 86_400_000))
}

export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function shortDay(ts: number): string {
  return new Intl.DateTimeFormat(AR, { day: 'numeric', month: 'short' }).format(new Date(ts))
}

export function monthLabel(ts: number): string {
  return new Intl.DateTimeFormat(AR, { month: 'long', year: 'numeric' }).format(new Date(ts))
}
