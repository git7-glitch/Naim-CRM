// Phase 2 notifications: live rows -> bell feed items (rules live in
// utils/notificationRules.js). Read state is kept per user in localStorage.
import { supabase, isSupabaseConfigured } from '../supabase/client'
import { buildNotifications, STALE_CANDIDATE_DAYS } from '../utils/notificationRules'
import { EXPIRY_WARNING_DAYS } from '../utils/documentChecklist'
import { nairobiDate, addDaysYmd } from '../utils/dateUtils'
import { getExpiringDocuments } from './documentService'
import { demoCandidates, demoTasks } from './demoData'

const MAX_ITEMS = 50
const EXPIRED_LOOKBACK_DAYS = 60
const READ_KEY = (userId) => `naim-notifications-read:${userId || 'anon'}`

export async function loadNotifications({ staleDays = STALE_CANDIDATE_DAYS } = {}) {
  const today = nairobiDate()
  if (!isSupabaseConfigured) {
    return buildNotifications({ candidates: demoCandidates, tasks: demoTasks, documents: [], today, staleDays }).slice(0, MAX_ITEMS)
  }

  const staleCutoff = new Date(Date.parse(`${addDaysYmd(today, -staleDays)}T00:00:00+03:00`)).toISOString()
  const lookback = addDaysYmd(today, -EXPIRED_LOOKBACK_DAYS)

  const [documents, candidates, tasks] = await Promise.all([
    getExpiringDocuments(addDaysYmd(today, EXPIRY_WARNING_DAYS))
      .then((rows) => rows.filter((d) => String(d.expiry_date) >= lookback))
      .catch(() => []),
    supabase
      .from('candidates')
      .select('id, name, stage, updated_at')
      .is('deleted_at', null)
      .not('stage', 'in', '("Completed","Rejected","Withdrawn","Draft")')
      .lt('updated_at', staleCutoff)
      .order('updated_at', { ascending: true })
      .limit(100)
      .then(({ data, error }) => { if (error) throw error; return data || [] })
      .catch(() => []),
    supabase
      .from('tasks')
      .select('id, title, due_date, status, priority')
      .is('deleted_at', null)
      .neq('status', 'Completed')
      .lte('due_date', today)
      .order('due_date', { ascending: true })
      .limit(100)
      .then(({ data, error }) => { if (error) throw error; return data || [] })
      .catch(() => []),
  ])

  return buildNotifications({ documents, candidates, tasks, today, staleDays }).slice(0, MAX_ITEMS)
}

export function readNotificationIds(userId) {
  try {
    const raw = window.localStorage.getItem(READ_KEY(userId))
    const ids = JSON.parse(raw || '[]')
    return new Set(Array.isArray(ids) ? ids : [])
  } catch {
    return new Set()
  }
}

export function saveNotificationIds(userId, ids) {
  try {
    window.localStorage.setItem(READ_KEY(userId), JSON.stringify([...ids].slice(-500)))
  } catch {
    // Storage full or blocked: read state just won't persist.
  }
}
