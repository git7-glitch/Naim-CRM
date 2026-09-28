// Phase 2 Document center: the per-candidate checklist of documents every
// Gulf placement needs, with missing / expiring / expired indicators.
import { nairobiDate, daysBetween } from './dateUtils.js'

export const EXPIRY_WARNING_DAYS = 90
export const EXPIRY_CRITICAL_DAYS = 30

// `types` are every document_type spelling that satisfies the item
// (case-insensitive). The first entry is what the upload form writes.
export const REQUIRED_DOCUMENTS = Object.freeze([
  { key: 'passport', label: 'Passport', types: ['Passport'], expires: true },
  { key: 'cv', label: 'CV', types: ['Resume/CV', 'CV', 'Resume'], expires: false },
  { key: 'medical', label: 'Medical', types: ['Medical Certificate', 'Medical Examination Report', 'Medical Report', 'Medical', 'Health Certificate'], expires: true },
  { key: 'good_conduct', label: 'Good Conduct', types: ['Good Conduct Certificate', 'Good Conduct', 'Police Clearance'], expires: true },
  { key: 'visa', label: 'Visa', types: ['Visa'], expires: true },
])

export function checklistKeyFor(documentType) {
  const t = String(documentType || '').trim().toLowerCase()
  if (!t) return null
  const item = REQUIRED_DOCUMENTS.find((req) => req.types.some((type) => type.toLowerCase() === t))
  return item ? item.key : null
}

/**
 * Expiry status of one document on `today` (YYYY-MM-DD, Nairobi).
 * 'expired' | 'critical' (<= 30 days) | 'warning' (<= 90 days) | 'valid' | 'no-expiry'
 */
export function expiryStatus(expiryDate, today = nairobiDate()) {
  if (!expiryDate) return { status: 'no-expiry', daysLeft: null }
  const daysLeft = daysBetween(today, String(expiryDate).slice(0, 10))
  if (Number.isNaN(daysLeft)) return { status: 'no-expiry', daysLeft: null }
  if (daysLeft < 0) return { status: 'expired', daysLeft }
  if (daysLeft <= EXPIRY_CRITICAL_DAYS) return { status: 'critical', daysLeft }
  if (daysLeft <= EXPIRY_WARNING_DAYS) return { status: 'warning', daysLeft }
  return { status: 'valid', daysLeft }
}

/**
 * Build the checklist for one candidate's (non-deleted) documents.
 * Each item: { key, label, expires, status, daysLeft, document }
 * status: 'missing' | 'expired' | 'critical' | 'warning' | 'valid' | 'no-expiry'
 * For an item with several uploads, the one expiring LAST (the newest renewal) wins.
 */
export function buildChecklist(documents = [], today = nairobiDate()) {
  const live = (documents || []).filter((d) => d && !d.deleted_at)
  const items = REQUIRED_DOCUMENTS.map((req) => {
    const matches = live.filter((d) => checklistKeyFor(d.document_type) === req.key)
    if (!matches.length) return { key: req.key, label: req.label, expires: req.expires, status: 'missing', daysLeft: null, document: null }
    const best = [...matches].sort((a, b) => {
      const ea = a.expiry_date || '9999-12-31'
      const eb = b.expiry_date || '9999-12-31'
      if (ea !== eb) return ea < eb ? 1 : -1
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })[0]
    const { status, daysLeft } = req.expires ? expiryStatus(best.expiry_date, today) : { status: 'valid', daysLeft: null }
    return { key: req.key, label: req.label, expires: req.expires, status, daysLeft, document: best }
  })
  const missing = items.filter((i) => i.status === 'missing').length
  const problems = items.filter((i) => ['expired', 'critical'].includes(i.status)).length
  const complete = items.length - missing
  return { items, missing, problems, complete, total: items.length }
}
