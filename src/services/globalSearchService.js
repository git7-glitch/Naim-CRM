import { isSupabaseConfigured, supabase } from '../supabase/client'
import { ilikeAny, sanitizeSearch } from '../utils/sanitizeSearch'
import {
  demoCandidatesList,
  demoJobs,
  demoTasks,
  demoAppointments,
  demoCVDrafts,
  demoMedicalDocuments,
  demoLicenseDocuments,
} from './demoData'

// Max items shown per group in the dropdown. Anything beyond this is
// reachable through the group's "View all" row.
export const GROUP_LIMIT = 5

// Order the groups appear in the dropdown.
export const GROUP_ORDER = ['page', 'candidate', 'job', 'task', 'appointment', 'document', 'cv']

export const GROUP_LABELS = {
  page: 'Pages',
  candidate: 'Candidates',
  job: 'Jobs',
  task: 'Tasks',
  appointment: 'Appointments',
  document: 'Documents',
  cv: 'CVs',
}

// Every navigable destination in the app, with the extra words a user is
// likely to type when they mean it ("trash" for Recycle Bin, "resume" for CVs).
export const SEARCHABLE_PAGES = [
  { title: 'Dashboard', to: '/dashboard', subtitle: 'Live KPIs, charts, task summary and quick actions', keywords: ['home', 'overview', 'summary', 'admin', 'main', 'quick actions', 'recent', 'kpi', 'charts'] },
  { title: 'Candidates', to: '/candidates', subtitle: 'Browse, add and manage all candidates', keywords: ['applicants', 'workers', 'people', 'profiles', 'staff', 'domestic worker'] },
  { title: 'Pipeline', to: '/pipeline', subtitle: 'Drag-and-drop candidate board by stage', keywords: ['kanban', 'board', 'stages', 'funnel', 'drag', 'progress'] },
  { title: 'CV Builder', to: '/cv-builder', subtitle: 'Build and export candidate CVs from templates', keywords: ['cv', 'resume', 'curriculum vitae', 'builder', 'template', 'create cv'] },
  { title: 'Documents', to: '/documents', subtitle: 'CVs, medical reports, contracts, licenses and more', keywords: ['files', 'uploads', 'paperwork', 'attachments', 'folder'] },
  { title: 'Associates', to: '/associates', subtitle: 'Associate activity, candidates and tasks', keywords: ['partners', 'agents', 'agency', 'recruiters', 'team'] },
  { title: 'Receptionist View', to: '/receptionist-view', subtitle: 'Front-desk intake and walk-in handling', keywords: ['reception', 'front desk', 'walk in', 'visitors', 'intake'] },
  { title: 'Tasks', to: '/tasks', subtitle: 'Assign and track team tasks', keywords: ['todo', 'to do', 'assignments', 'follow up', 'reminders'] },
  { title: 'Appointments', to: '/appointments', subtitle: 'Interview and meeting schedule', keywords: ['calendar', 'interviews', 'schedule', 'bookings', 'meetings'] },
  { title: 'Jobs', to: '/jobs', subtitle: 'Open vacancies and job postings', keywords: ['vacancies', 'positions', 'openings', 'roles', 'postings'] },
  { title: 'Job Generator', to: '/job-generator', subtitle: 'Generate a new job posting', keywords: ['generate job', 'create job', 'new job', 'job post', 'advert', 'posting'] },
  { title: 'Reports', to: '/reports', subtitle: 'Performance metrics and placement history', keywords: ['analytics', 'statistics', 'stats', 'metrics', 'performance', 'placements', 'charts'] },
  { title: 'Settings', to: '/settings', subtitle: 'Account, notifications, security and users', keywords: ['preferences', 'account', 'profile', 'security', 'password', 'users', 'config', 'configuration'] },
  { title: 'WhatsApp', to: '/whatsapp', subtitle: 'WhatsApp templates and send-via-agent', keywords: ['messages', 'chat', 'sms', 'whats app', 'messaging', 'agent'] },
  { title: 'Recycle Bin', to: '/recycle-bin', subtitle: 'Restore or permanently delete removed records', keywords: ['trash', 'deleted', 'bin', 'restore', 'removed', 'archive'] },
]

// Document tabs are destinations in their own right, so "medical reports"
// or "contracts" jumps straight to the right tab.
const DOCUMENT_SECTIONS = [
  { title: 'Medical Reports', tab: 'medical-reports', keywords: ['medical', 'health', 'exam', 'examination', 'vaccination', 'certificate', 'clearance'] },
  { title: 'Contracts', tab: 'contracts', keywords: ['contract', 'agreement', 'employment contract', 'signed'] },
  { title: 'Licenses & Certifications', tab: 'licenses-certifications', keywords: ['license', 'licence', 'certification', 'certificate', 'iso', 'regulatory', 'compliance'] },
  { title: 'Adverts/Marketing', tab: 'adverts-marketing', keywords: ['advert', 'adverts', 'marketing', 'brand', 'social', 'advertisement', 'promo'] },
  { title: 'Reports', tab: 'reports', keywords: ['report', 'reports', 'financial', 'analytics', 'performance report'] },
  { title: 'CVs', tab: 'cvs', keywords: ['cv', 'cvs', 'resume', 'resumes', 'drafts'] },
]

/**
 * Rank a single field against the query.
 * 3 = starts with, 2 = starts a word, 1 = appears anywhere, 0 = no match.
 */
function fieldScore(value, q) {
  if (value === null || value === undefined) return 0
  const haystack = String(value).toLowerCase()
  if (!haystack) return 0
  const at = haystack.indexOf(q)
  if (at === -1) return 0
  if (at === 0) return 3
  return /[\s\-_@./&(,]/.test(haystack[at - 1]) ? 2 : 1
}

/**
 * Best score across a record's searchable fields. `fields` entries are
 * [value, weight] so a name match outranks a description match.
 */
function recordScore(fields, q) {
  let best = 0
  for (const [value, weight = 1] of fields) {
    const s = fieldScore(value, q)
    if (s) best = Math.max(best, s * weight)
  }
  return best
}

function byScoreThenTitle(a, b) {
  if (b.score !== a.score) return b.score - a.score
  return String(a.title).localeCompare(String(b.title))
}

function searchPages(q) {
  const results = []

  for (const page of SEARCHABLE_PAGES) {
    const score = Math.max(
      recordScore([[page.title, 4]], q),
      recordScore(page.keywords.map((k) => [k, 2]), q),
      recordScore([[page.subtitle, 1]], q),
    )
    if (score) {
      results.push({ id: `page:${page.to}`, type: 'page', title: page.title, subtitle: page.subtitle, to: page.to, score })
    }
  }

  for (const section of DOCUMENT_SECTIONS) {
    const score = Math.max(
      recordScore([[section.title, 3]], q),
      recordScore(section.keywords.map((k) => [k, 2]), q),
    )
    if (score) {
      results.push({
        id: `page:documents:${section.tab}`,
        type: 'page',
        title: `Documents › ${section.title}`,
        subtitle: 'Documents section',
        to: `/documents?tab=${section.tab}`,
        // Slightly below the top-level page of the same name so
        // "Reports" still surfaces the Reports page first.
        score: score - 0.5,
      })
    }
  }

  return results.sort(byScoreThenTitle)
}

function mapCandidate(c, q) {
  const score = recordScore(
    [
      [c.name, 4],
      [c.email, 3],
      [c.phone, 3],
      [c.passport_number, 3],
      [c.passport, 3],
      [c.position, 2],
      [c.job_title, 2],
      [c.work_position, 2],
      [c.country_applying_to, 2],
      [c.country, 2],
      [c.city, 1],
      [c.company, 1],
      [c.stage, 1],
      [c.salary, 1],
      [c.notes, 1],
    ],
    q,
  )
  if (!score) return null
  const where = c.country_applying_to || c.country
  const role = c.position || c.job_title || c.work_position
  return {
    id: `candidate:${c.id}`,
    type: 'candidate',
    title: c.name,
    subtitle: [role, where].filter(Boolean).join(' • ') || 'Candidate',
    meta: c.stage || c.status || '',
    // Phase 2: straight to the candidate's profile.
    to: `/candidates/${c.id}`,
    score,
  }
}

function mapJob(j, q) {
  const score = recordScore(
    [
      [j.title, 4],
      [j.company, 3],
      [j.location, 2],
      [j.country, 2],
      [j.city, 2],
      [j.type, 1],
      [j.status, 1],
      [j.nationality, 1],
      [j.description, 1],
      [j.additional_details, 1],
    ],
    q,
  )
  if (!score) return null
  return {
    id: `job:${j.id}`,
    type: 'job',
    title: j.title,
    subtitle: [j.company, j.location || j.city || j.country].filter(Boolean).join(' • ') || 'Job',
    meta: j.status || '',
    to: `/jobs?q=${encodeURIComponent(j.title || '')}`,
    score,
  }
}

function mapTask(t, q) {
  const score = recordScore(
    [
      [t.title, 4],
      [t.assignee, 3],
      [t.category, 2],
      [t.priority, 1],
      [t.status, 1],
      [t.created_by, 1],
      [t.description, 1],
    ],
    q,
  )
  if (!score) return null
  return {
    id: `task:${t.id}`,
    type: 'task',
    title: t.title,
    subtitle: [t.assignee, t.category, t.due_date && `Due ${t.due_date}`].filter(Boolean).join(' • ') || 'Task',
    meta: t.status || '',
    to: `/tasks?q=${encodeURIComponent(t.title || '')}`,
    score,
  }
}

function mapAppointment(a, q) {
  const candidateName = a.candidateName || a.candidates?.name
  const score = recordScore(
    [
      [a.title, 4],
      [candidateName, 3],
      [a.candidateEmail || a.candidates?.email, 3],
      [a.candidatePhone || a.candidates?.phone, 3],
      [a.type, 2],
      [a.location, 2],
      [a.coordinator, 2],
      [a.notes, 1],
      [a.status, 1],
      [a.stage, 1],
      [a.date, 1],
    ],
    q,
  )
  if (!score) return null
  return {
    id: `appointment:${a.id}`,
    type: 'appointment',
    title: a.title || candidateName || 'Appointment',
    subtitle: [a.type, [a.date, a.time].filter(Boolean).join(' ')].filter(Boolean).join(' • ') || 'Appointment',
    meta: a.status || '',
    to: `/appointments?q=${encodeURIComponent(a.title || '')}`,
    score,
  }
}

function mapDocument(d, q, tab) {
  const name = d.file_name || d.name
  const owner = d.candidates?.name
  const score = recordScore(
    [
      [name, 4],
      [owner, 3],
      [d.document_type, 3],
      [d.description, 2],
      [d.uploadedBy, 1],
      [d.section, 1],
    ],
    q,
  )
  if (!score) return null
  return {
    id: `document:${d.id}`,
    type: 'document',
    title: name,
    subtitle: [d.document_type, owner || d.size, d.expiry_date && `Expires ${d.expiry_date}`].filter(Boolean).join(' • ') || 'Document',
    meta: d.uploadedAt || '',
    // Candidate documents open in that candidate's document center (signed URLs only).
    to: d.candidate_id ? `/candidates/${d.candidate_id}?tab=documents` : `/documents?tab=${tab}&q=${encodeURIComponent(name || '')}`,
    score,
  }
}

function mapCV(d, q) {
  const score = recordScore(
    [
      [d.name, 4],
      [d.title, 3],
      [d.kind, 2],
      [d.description, 1],
      [d.uploadedBy, 1],
    ],
    q,
  )
  if (!score) return null
  return {
    id: `cv:${d.id}`,
    type: 'cv',
    title: d.name || d.title,
    subtitle: [d.kind, d.size].filter(Boolean).join(' • ') || 'CV',
    meta: d.uploadedAt || '',
    to: `/documents?tab=cvs&q=${encodeURIComponent(d.name || d.title || '')}`,
    score,
  }
}

function collect(list, mapper) {
  const out = []
  for (const row of list || []) {
    if (row?.deleted_at) continue
    const item = mapper(row)
    if (item) out.push(item)
  }
  return out.sort(byScoreThenTitle)
}

/** Demo mode (dev only, see CRM-9/10) — everything is already in memory. */
function searchDemo(q) {
  return {
    candidate: collect(demoCandidatesList, (c) => mapCandidate(c, q)),
    job: collect(demoJobs, (j) => mapJob(j, q)),
    task: collect(demoTasks, (t) => mapTask(t, q)),
    appointment: collect(demoAppointments, (a) => mapAppointment(a, q)),
    document: [
      ...collect(demoMedicalDocuments, (d) => mapDocument(d, q, 'medical-reports')),
      ...collect(demoLicenseDocuments, (d) => mapDocument(d, q, 'licenses-certifications')),
    ].sort(byScoreThenTitle),
    cv: collect(demoCVDrafts, (d) => mapCV(d, q)),
  }
}

// Fetch a capped slice per table so one broad query can't stall the dropdown.
const REMOTE_FETCH_LIMIT = 25

async function remoteRows(table, orFilter, select = '*', notDeleted = true) {
  if (!orFilter) return []
  try {
    let query = supabase.from(table).select(select)
    if (notDeleted) query = query.is('deleted_at', null)
    const { data, error } = await query.or(orFilter).limit(REMOTE_FETCH_LIMIT)
    if (error) throw error
    return data || []
  } catch {
    // A missing table or an offline backend shouldn't blank the whole dropdown.
    return []
  }
}

const EMPTY_ENTITIES = Object.freeze({ candidate: [], job: [], task: [], appointment: [], document: [], cv: [] })

/**
 * Supabase mode — one narrow query per table, all in parallel.
 * CRM-8: every filter goes through ilikeAny(), and only columns that exist in
 * the schema are referenced. Tables whose deleted_at column arrives with
 * migration 004 are filtered client-side (collect() skips deleted rows) so
 * search keeps working even before that migration is applied.
 */
async function searchRemote(q) {
  if (!sanitizeSearch(q)) return EMPTY_ENTITIES
  const [candidates, jobs, tasks, appointments, documents, cvDrafts] = await Promise.all([
    remoteRows('candidates', ilikeAny(['name', 'email', 'phone', 'passport_number', 'job_title', 'work_position', 'country_applying_to'], q)),
    remoteRows('jobs', ilikeAny(['title', 'company', 'city', 'country', 'description'], q)),
    remoteRows('tasks', ilikeAny(['title', 'description'], q), '*', false),
    remoteRows('appointments', ilikeAny(['title', 'type', 'notes'], q), '*, candidates(name, email, phone)', false),
    remoteRows('documents', ilikeAny(['file_name', 'document_type'], q), '*, candidates(name)', false),
    remoteRows('cv_drafts', ilikeAny(['title', 'full_name'], q), 'id, title, full_name, template, updated_at', false),
  ])

  return {
    candidate: collect(candidates, (c) => mapCandidate(c, q)),
    job: collect(jobs, (j) => mapJob(j, q)),
    task: collect(tasks, (t) => mapTask(t, q)),
    appointment: collect(appointments, (a) => mapAppointment(a, q)),
    document: collect(documents, (d) => mapDocument(d, q, 'medical-reports')),
    cv: collect(cvDrafts, (d) => mapCV({ ...d, name: d.full_name || d.title, kind: 'CV Draft' }, q)),
  }
}

// Where a group's "View all" row sends the user.
const VIEW_ALL_ROUTES = {
  candidate: '/candidates',
  job: '/jobs',
  task: '/tasks',
  appointment: '/appointments',
  document: '/documents',
  cv: '/documents',
}

/**
 * Search everything in the CRM — pages, candidates, jobs, tasks,
 * appointments, documents and CVs.
 *
 * Returns { groups, total, shown } where `groups` is already ordered and
 * capped to GROUP_LIMIT per type, and each group keeps its full `count`
 * so the UI can offer "View all".
 */
export async function globalSearch(rawQuery) {
  const q = String(rawQuery || '').trim().toLowerCase()
  if (!q) return { groups: [], total: 0, shown: 0, query: '' }

  const entities = isSupabaseConfigured ? await searchRemote(q) : searchDemo(q)
  const byType = { page: searchPages(q), ...entities }

  const groups = []
  let total = 0
  let shown = 0

  for (const type of GROUP_ORDER) {
    const items = byType[type] || []
    if (!items.length) continue
    const visible = items.slice(0, GROUP_LIMIT)
    total += items.length
    shown += visible.length
    groups.push({
      type,
      label: GROUP_LABELS[type],
      count: items.length,
      items: visible,
      viewAllTo: VIEW_ALL_ROUTES[type] ? `${VIEW_ALL_ROUTES[type]}?q=${encodeURIComponent(rawQuery.trim())}` : null,
    })
  }

  return { groups, total, shown, query: q }
}
