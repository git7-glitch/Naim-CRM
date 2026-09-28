// DEV DEMO DATA ONLY (CRM-9). Rendered by the Reports page exclusively when
// Supabase is NOT configured in a dev build, always labelled "Demo data".
// Production reads live data via src/services/reportsService.js.

export const REPORT_METRICS = Object.freeze([
  { label: 'Total Candidates', value: 165, icon: 'users', accent: 'gold' },
  { label: 'Total Jobs', value: 3, icon: 'briefcase', accent: 'gold' },
  { label: 'Total Tasks', value: 2, icon: 'tasks', accent: 'gold' },
  { label: 'Completed Tasks', value: 1, icon: 'completed', accent: 'green' },
  { label: 'Total Appointments', value: 1, icon: 'calendar', accent: 'gold' },
  { label: 'Pending Tasks', value: 0, icon: 'pending', accent: 'orange' },
])

export const CANDIDATE_STAGES = Object.freeze([
  { label: 'Onboarding', value: 158 },
  { label: 'Offer', value: 4 },
  { label: 'Interview', value: 1 },
  { label: 'Placed', value: 2 },
])

export const RECENT_SUCCESSFUL_PLACEMENTS = Object.freeze([
  {
    id: 'recent-1',
    candidate: 'TERESIAH WAMBERE KARIUKI',
    position: 'DOMESTIC WORKER',
    country: 'KENYA',
    salary: 'Ksh 90.00',
  },
  {
    id: 'recent-2',
    candidate: 'JANE NYAMBURA NJOROGE',
    position: 'DOMESTIC WORKER',
    country: 'KENYA',
    salary: 'Ksh 90.00',
  },
])

export const STAGE_DISTRIBUTION = CANDIDATE_STAGES

export const APPLICATIONS_BY_COUNTRY = Object.freeze([
  { label: 'SAUDI ARABIA', value: 118 },
  { label: 'KENYA', value: 34 },
  { label: 'Saudi Arabia', value: 2 },
  { label: 'MOMBASA, KENYA', value: 1 },
  { label: 'LEBANON', value: 2 },
  { label: 'Kuwait', value: 4 },
  { label: 'Kenya', value: 1 },
  { label: 'Unknown', value: 3 },
])

export const TASK_PERFORMANCE = Object.freeze([
  { label: 'Completed', value: 1, tone: 'green' },
  { label: 'Pending', value: 0, tone: 'yellow' },
  { label: 'Active Jobs', value: 2, tone: 'blue' },
])

const historyEntries = [
  ['AMINA ALI KAKAWA', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['AMINA ALI KAKAWA', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['AMINA ALI KAKAWA', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['LYDIA MAPENZI KITSAO', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['LYDIA MAPENZI KITSAO', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['MWATSENZE MESAIDI BAKARI', 'NONE', 'SAUDI ARABIA', 0],
  ['JOLINE CHELIMO KENTEYIA', 'DOMESTIC WORKER', 'SAUDI ARABIA', 0],
  ['JOLINE CHELIMO KENTEYIA', 'DOMESTIC WORKER', 'SAUDI ARABIA', 0],
  ['ALICE DAMA KITSAO', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['ALICE DAMA KITSAO', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['KITHUKA AGNES KATHEU', 'FEMALE DRIVER', 'KENYA', 1500],
  ['ROSEMARY MUKAMI NDUMIA', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['JOYCE MMBONE OUMA', 'DOMESTIC WORKER', 'KENYA', 900],
  ['JOYCE MMBONE OUMA', 'DOMESTIC WORKER', 'KENYA', 900],
  ['JOYCE MMBONE OUMA', 'DOMESTIC WORKER', 'KENYA', 900],
  ['JOYCE MMBONE OUMA', 'DOMESTIC WORKER', 'KENYA', 900],
  ['CAROLINE WAMBUI KAMAU', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['VERONICA WAMBUI MACHARIA', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
  ['CYNTHIA KERUBO OMWOYO', 'DOMESTIC WORKER', 'KENYA', 900],
  ['BEATRICE KANZE LWAMBI', 'DOMESTIC WORKER', 'SAUDI ARABIA', 1100],
]

export const PLACEMENT_HISTORY = Object.freeze(
  historyEntries.map(([candidate, position, country, salary], index) => Object.freeze({
    id: `placement-${index + 1}`,
    date: 'Not set',
    sequence: index + 1,
    candidate,
    position,
    country,
    salary,
    currency: 'KES',
    status: 'Onboarding',
    departure: 'Not set',
  }))
)

/** Same shape as reportsService.getReportsSummary(), flagged demo. */
export function getDemoReportsSummary() {
  return {
    demo: true,
    isEmpty: false,
    metrics: REPORT_METRICS,
    stages: CANDIDATE_STAGES,
    countries: APPLICATIONS_BY_COUNTRY,
    taskPerformance: TASK_PERFORMANCE,
    placements: PLACEMENT_HISTORY,
    recentPlacements: RECENT_SUCCESSFUL_PLACEMENTS,
  }
}

export function formatSalary(value, currency = 'KES') {
  const label = !currency || currency === 'KES' ? 'Ksh' : currency
  return `${label} ${Number(value || 0).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function filterReportRows(rows, query) {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return rows

  return rows.filter((row) =>
    [
      row.date,
      row.sequence,
      row.candidate,
      row.position,
      row.country,
      typeof row.salary === 'number' ? formatSalary(row.salary, row.currency) : row.salary,
      row.status,
      row.departure,
    ].some((value) => value !== undefined && value !== null && String(value).toLocaleLowerCase().includes(term))
  )
}

export function sortReportRows(rows, sort) {
  if (!sort?.key) return rows
  const direction = sort.direction === 'desc' ? -1 : 1

  return [...rows].sort((a, b) => {
    if (sort.key === 'sequence' || sort.key === 'salary') {
      return (a[sort.key] - b[sort.key]) * direction
    }

    return String(a[sort.key]).localeCompare(String(b[sort.key]), undefined, {
      numeric: true,
    }) * direction
  })
}

export function toExportRows(rows) {
  return rows.map((row) => ({
    Date: row.date,
    Number: row.sequence,
    Candidate: row.candidate,
    Position: row.position,
    Country: row.country,
    Salary: formatSalary(row.salary, row.currency),
    Status: row.status,
    Departure: row.departure,
  }))
}
