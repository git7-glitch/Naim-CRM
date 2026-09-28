// CRM-4: live Reports data. Always used when Supabase is configured; the
// organized demo set in components/reports/reportsData.js is dev-only.
import { supabase } from '../supabase/client'
import { CANDIDATE_STAGES, normalizeStage } from '../utils/constants'
import { formatSalary } from '../components/reports/reportsData'

// PostgREST caps a response at 1000 rows by default; page past it.
const PAGE_SIZE = 1000
const PLACED_STAGES = new Set(['Placed', 'Completed'])

const nairobiDate = new Intl.DateTimeFormat('en-KE', {
  timeZone: 'Africa/Nairobi',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

async function fetchAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE_SIZE) return rows
  }
}

async function countRows(build) {
  const { count, error } = await build()
  if (error) throw error
  return count || 0
}

function tally(rows, keyOf) {
  const counts = new Map()
  rows.forEach((row) => {
    const key = keyOf(row)
    counts.set(key, (counts.get(key) || 0) + 1)
  })
  return counts
}

export async function getReportsSummary() {
  const [candidates, tasks, totalJobs, activeJobs, totalAppointments] = await Promise.all([
    fetchAll(() => supabase
      .from('candidates')
      .select('id, name, stage, job_title, work_position, country_applying_to, salary, currency, updated_at')
      .is('deleted_at', null)
      .order('updated_at', { ascending: false })),
    fetchAll(() => supabase.from('tasks').select('id, status').order('id')),
    countRows(() => supabase.from('jobs').select('id', { count: 'exact', head: true }).is('deleted_at', null)),
    countRows(() => supabase.from('jobs').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('status', 'Active')),
    countRows(() => supabase.from('appointments').select('id', { count: 'exact', head: true })),
  ])

  const completedTasks = tasks.filter((t) => t.status === 'Completed').length
  const pendingTasks = tasks.length - completedTasks

  const stageCounts = tally(candidates, (c) => normalizeStage(c.stage) || 'Unknown')
  const stages = CANDIDATE_STAGES
    .map((label) => ({ label, value: stageCounts.get(label) || 0 }))
    .filter((stage) => stage.value > 0)

  const countries = [...tally(candidates, (c) => (c.country_applying_to || '').trim() || 'Unknown')]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)

  const placements = candidates
    .filter((c) => PLACED_STAGES.has(normalizeStage(c.stage)))
    .map((c, index) => ({
      id: c.id,
      date: c.updated_at ? nairobiDate.format(new Date(c.updated_at)) : 'Not set',
      sequence: index + 1,
      candidate: c.name,
      position: c.job_title || c.work_position || 'N/A',
      country: c.country_applying_to || 'N/A',
      salary: Number(c.salary) || 0,
      currency: c.currency || 'KES',
      status: normalizeStage(c.stage),
      departure: 'Not set',
    }))

  const recentPlacements = placements.slice(0, 5).map((row) => ({
    id: row.id,
    candidate: row.candidate,
    position: row.position,
    country: row.country,
    salary: formatSalary(row.salary, row.currency),
  }))

  return {
    demo: false,
    isEmpty: candidates.length === 0,
    generatedAt: new Date().toISOString(),
    metrics: [
      { label: 'Total Candidates', value: candidates.length, icon: 'users', accent: 'gold' },
      { label: 'Total Jobs', value: totalJobs, icon: 'briefcase', accent: 'gold' },
      { label: 'Total Tasks', value: tasks.length, icon: 'tasks', accent: 'gold' },
      { label: 'Completed Tasks', value: completedTasks, icon: 'completed', accent: 'green' },
      { label: 'Total Appointments', value: totalAppointments, icon: 'calendar', accent: 'gold' },
      { label: 'Pending Tasks', value: pendingTasks, icon: 'pending', accent: 'orange' },
    ],
    stages,
    countries,
    taskPerformance: [
      { label: 'Completed', value: completedTasks, tone: 'green' },
      { label: 'Pending', value: pendingTasks, tone: 'yellow' },
      { label: 'Active Jobs', value: activeJobs, tone: 'blue' },
    ],
    placements,
    recentPlacements,
  }
}
