// Phase 2 Dashboard 2.0: live KPIs straight from Supabase. Demo figures are
// produced ONLY in dev demo mode (isDemoMode) and are flagged `demo: true` so
// the UI labels them "Demo data" (CRM-9 policy).
import { supabase, isSupabaseConfigured } from '../supabase/client'
import { PIPELINE_STAGES } from '../utils/stageTransitions'
import { CANDIDATE_STAGES, TERMINAL_STAGES, normalizeStage } from '../utils/constants'
import { EXPIRY_WARNING_DAYS, expiryStatus } from '../utils/documentChecklist'
import { nairobiDate, addDaysYmd, nairobiMonthStartIso, nairobiMonthKey } from '../utils/dateUtils'
import { getExpiringDocuments } from './documentService'
import { demoCandidatesList, demoTasks } from './demoData'

const PAGE = 1000
const INTAKE_MONTHS = 6

async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

/** Pure aggregation, shared by live and demo mode. */
export function summarize({ candidates = [], tasks = [], documents = [], placedIds = [], now = new Date() }) {
  const today = nairobiDate(now)
  const monthStart = nairobiMonthStartIso(now)

  const stageCounts = new Map()
  const countryCounts = new Map()
  for (const c of candidates) {
    const stage = normalizeStage(c.stage) || 'New'
    stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1)
    const country = (c.country_applying_to || '').trim() || 'Unknown'
    countryCounts.set(country, (countryCounts.get(country) || 0) + 1)
  }

  const byStage = CANDIDATE_STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) || 0 }))
  const funnel = PIPELINE_STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) || 0 }))
  const byCountry = [...countryCounts].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)

  const placed = new Set(placedIds)
  for (const c of candidates) {
    if (normalizeStage(c.stage) === 'Placed' && c.updated_at && c.updated_at >= monthStart) placed.add(c.id)
  }

  const expiringItems = documents
    .map((d) => ({ ...d, ...expiryStatus(d.expiry_date, today) }))
    .filter((d) => ['expired', 'critical', 'warning'].includes(d.status))
    .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)))

  const openTasks = tasks.filter((t) => t.status !== 'Completed' && t.due_date)
  const dueToday = openTasks.filter((t) => String(t.due_date).slice(0, 10) === today)
  const overdue = openTasks.filter((t) => String(t.due_date).slice(0, 10) < today)

  const intakeKeys = Array.from({ length: INTAKE_MONTHS }, (_, i) => nairobiMonthKey(new Date(nairobiMonthStartIso(now, i - (INTAKE_MONTHS - 1)))))
  const intakeCounts = new Map(intakeKeys.map((k) => [k, 0]))
  for (const c of candidates) {
    if (!c.created_at) continue
    const key = nairobiMonthKey(new Date(c.created_at))
    if (intakeCounts.has(key)) intakeCounts.set(key, intakeCounts.get(key) + 1)
  }
  const intake = intakeKeys.map((key) => ({ month: key, label: monthLabel(key), count: intakeCounts.get(key) }))

  const active = candidates.filter((c) => !TERMINAL_STAGES.includes(normalizeStage(c.stage))).length

  return {
    generatedAt: now.toISOString(),
    today,
    totals: { candidates: candidates.length, active },
    byStage,
    funnel,
    byCountry,
    intake,
    placementsThisMonth: {
      count: placed.size,
      month: new Date(monthStart).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'Africa/Nairobi' }),
    },
    expiring: {
      items: expiringItems,
      expired: expiringItems.filter((d) => d.status === 'expired').length,
      critical: expiringItems.filter((d) => d.status === 'critical').length,
      warning: expiringItems.filter((d) => d.status === 'warning').length,
    },
    tasks: { dueToday, overdue },
  }
}

async function placementsFromLog(monthStartIso) {
  try {
    const { data, error } = await supabase
      .from('activity_log')
      .select('candidate_id')
      .eq('action', 'stage_change')
      .eq('changes->>to', 'Placed')
      .gte('created_at', monthStartIso)
      .limit(1000)
    if (error) throw error
    return (data || []).map((r) => r.candidate_id).filter(Boolean)
  } catch {
    return []
  }
}

export async function getDashboardKPIs() {
  if (!isSupabaseConfigured) {
    return {
      demo: true,
      ...summarize({ candidates: demoCandidatesList, tasks: demoTasks, documents: [] }),
    }
  }

  const now = new Date()
  const today = nairobiDate(now)
  const [candidates, tasks, documents, placedIds] = await Promise.all([
    fetchAll(() => supabase
      .from('candidates')
      .select('id, stage, country_applying_to, created_at, updated_at')
      .is('deleted_at', null)
      .order('id')),
    fetchAll(() => supabase
      .from('tasks')
      .select('id, title, due_date, status, priority')
      .is('deleted_at', null)
      .neq('status', 'Completed')
      .lte('due_date', today)
      .order('id')),
    getExpiringDocuments(addDaysYmd(today, EXPIRY_WARNING_DAYS)),
    placementsFromLog(nairobiMonthStartIso(now)),
  ])

  return { demo: false, ...summarize({ candidates, tasks, documents, placedIds, now }) }
}
