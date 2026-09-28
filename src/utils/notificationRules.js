// Phase 2 notifications: pure rules that turn live rows into bell-feed items.
// notificationService.js fetches the rows; this module decides what to say.
import { TERMINAL_STAGES, normalizeStage } from './constants.js'
import { expiryStatus } from './documentChecklist.js'
import { nairobiDate, daysBetween } from './dateUtils.js'

export const STALE_CANDIDATE_DAYS = 14

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * @param {object} input
 * @param {Array} input.documents  rows: id, candidate_id, document_type, expiry_date, candidate_name
 * @param {Array} input.candidates rows: id, name, stage, updated_at
 * @param {Array} input.tasks      rows: id, title, due_date, status, priority
 * @param {string} [input.today]   YYYY-MM-DD (Nairobi)
 * @param {number} [input.staleDays]
 */
export function buildNotifications({ documents = [], candidates = [], tasks = [], today = nairobiDate(), staleDays = STALE_CANDIDATE_DAYS } = {}) {
  const out = []

  for (const d of documents) {
    if (!d || d.deleted_at || !d.expiry_date) continue
    const { status, daysLeft } = expiryStatus(d.expiry_date, today)
    if (!['expired', 'critical', 'warning'].includes(status)) continue
    const who = d.candidate_name || 'A candidate'
    out.push({
      id: `doc:${d.id}:${status}`,
      kind: 'document',
      severity: status === 'expired' ? 'critical' : status === 'critical' ? 'high' : 'medium',
      title: status === 'expired'
        ? `${who}'s ${d.document_type} expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`
        : `${who}'s ${d.document_type} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      detail: `Expiry ${String(d.expiry_date).slice(0, 10)}`,
      to: d.candidate_id ? `/candidates/${d.candidate_id}?tab=documents` : '/documents',
      date: String(d.expiry_date).slice(0, 10),
    })
  }

  for (const c of candidates) {
    if (!c || c.deleted_at || !c.updated_at) continue
    const stage = normalizeStage(c.stage)
    if (TERMINAL_STAGES.includes(stage) || stage === 'Draft') continue
    const idle = daysBetween(nairobiDate(new Date(c.updated_at)), today)
    if (!(idle >= staleDays)) continue
    out.push({
      id: `stale:${c.id}:${nairobiDate(new Date(c.updated_at))}`,
      kind: 'candidate',
      severity: idle >= staleDays * 2 ? 'high' : 'low',
      title: `${c.name || 'Candidate'} has had no update for ${idle} days`,
      detail: `Stage: ${stage || 'New'}`,
      to: `/candidates/${c.id}`,
      date: nairobiDate(new Date(c.updated_at)),
    })
  }

  for (const t of tasks) {
    if (!t || t.deleted_at || !t.due_date || t.status === 'Completed') continue
    const due = String(t.due_date).slice(0, 10)
    const diff = daysBetween(today, due)
    if (Number.isNaN(diff) || diff > 0) continue
    out.push({
      id: `task:${t.id}:${due}`,
      kind: 'task',
      severity: diff < 0 ? 'high' : (String(t.priority).toLowerCase() === 'urgent' ? 'high' : 'medium'),
      title: diff < 0 ? `Overdue: ${t.title} (due ${due})` : `Due today: ${t.title}`,
      detail: t.priority ? `${t.priority} priority` : 'Task',
      to: `/tasks?q=${encodeURIComponent(t.title || '')}`,
      date: due,
    })
  }

  return out.sort((a, b) => (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || String(a.date).localeCompare(String(b.date)))
}
