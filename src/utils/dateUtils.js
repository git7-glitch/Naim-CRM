// Business dates are Mombasa dates (Africa/Nairobi, UTC+3, no DST).
export const BUSINESS_TZ = 'Africa/Nairobi'
const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

/** YYYY-MM-DD for `date` in Africa/Nairobi. */
export function nairobiDate(date = new Date()) {
  return ymd.format(date instanceof Date ? date : new Date(date))
}

/** Whole days from `fromYmd` to `toYmd` (both YYYY-MM-DD). */
export function daysBetween(fromYmd, toYmd) {
  const a = Date.parse(`${fromYmd}T00:00:00Z`)
  const b = Date.parse(`${toYmd}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN
  return Math.round((b - a) / 86400000)
}

/** ISO instant of 00:00 Nairobi on the first day of the month containing `date`, offset by `monthOffset`. */
export function nairobiMonthStartIso(date = new Date(), monthOffset = 0) {
  const [y, m] = nairobiDate(date).split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + monthOffset, 1))
  const yy = first.getUTCFullYear()
  const mm = String(first.getUTCMonth() + 1).padStart(2, '0')
  return new Date(`${yy}-${mm}-01T00:00:00+03:00`).toISOString()
}

/** 'YYYY-MM' key in Nairobi time. */
export function nairobiMonthKey(date) {
  return nairobiDate(date).slice(0, 7)
}

/** YYYY-MM-DD shifted by `days`. */
export function addDaysYmd(ymdValue, days) {
  const t = Date.parse(`${ymdValue}T00:00:00Z`) + days * 86400000
  return new Date(t).toISOString().slice(0, 10)
}
