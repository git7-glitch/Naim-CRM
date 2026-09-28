// Phase 2 Recycle Bin: every soft-deletable entity (candidates, jobs, tasks,
// appointments, documents) lands here. Restore and permanent delete are
// admin-only, enforced by the DB (migration 004), not just the UI.
import { isSupabaseConfigured } from '../supabase/client'
import { getDeletedCandidates, permanentDeleteCandidate, restoreCandidate } from './candidateService'
import { getDeletedJobs, permanentDeleteJob, restoreJob } from './jobService'
import { getDeletedTasks, permanentDeleteTask, restoreTask } from './taskService'
import { getDeletedAppointments, permanentDeleteAppointment, restoreAppointment } from './appointmentService'
import { getDeletedDocuments, permanentDeleteDocument, restoreDocument } from './documentService'

export const RECYCLE_BIN_STORAGE_KEY = 'naim-recycle-bin-items'

export const RECYCLE_BIN_TYPES = [
  { value: 'candidate', label: 'Candidates' },
  { value: 'job', label: 'Jobs' },
  { value: 'task', label: 'Tasks' },
  { value: 'appointment', label: 'Appointments' },
  { value: 'document', label: 'Documents' },
]

// ── Demo mode (dev only): a localStorage list of candidates ─────────────────
const screenshotItems = [
  ['recycle-1', 'MERCY HABEL MWAMBANGA', '1781021361040@temp.com'],
  ['recycle-2', 'MERCY HABEL MWAMBANGA', '1781021513702@temp.com'],
  ['recycle-3', 'MERCY HABEL MWAMBANGA', '1781021514348@temp.com'],
  ['recycle-4', 'JULIA KEYA BARASA', '1780052470377@temp.com'],
  ['recycle-5', 'JULIA KEYA BARASA', '1780052472808@temp.com'],
  ['recycle-6', 'JULIA KEYA BARASA', '1780052471508@temp.com'],
  ['recycle-7', 'JULIA KEYA BARASA', '1780052466546@temp.com'],
  ['recycle-8', 'JULIA KEYA BARASA', '1780052472050@temp.com'],
  ['recycle-9', 'JULIA KEYA BARASA', '1780052471864@temp.com'],
  ['recycle-10', 'JULIA KEYA BARASA', '1780052473410@temp.com'],
  ['recycle-11', 'JULIA KEYA BARASA', '1780052473189@temp.com'],
  ['recycle-12', 'JULIA KEYA BARASA', '1780052471315@temp.com'],
  ['recycle-13', 'JULIA KEYA BARASA', '1780052470963@temp.com'],
  ['recycle-14', 'JULIA KEYA BARASA', '1780052471695@temp.com'],
  ['recycle-15', 'JULIA KEYA BARASA', '1780052471115@temp.com'],
]

export const DEFAULT_RECYCLE_BIN_ITEMS = Object.freeze(
  screenshotItems.map(([id, name, email]) => Object.freeze({
    id,
    name,
    email,
    phone: '+000-000-0000',
    type: 'candidate',
    deleted_at: '2026-08-08T12:00:00.000Z',
    deleted_by: '',
  })),
)

function cloneDefaults() {
  return DEFAULT_RECYCLE_BIN_ITEMS.map((item) => ({ ...item }))
}

function normalizeLocal(value) {
  if (!Array.isArray(value)) return cloneDefaults()
  return value
    .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
    .map((item) => ({
      id: item.id,
      name: item.name,
      email: typeof item.email === 'string' ? item.email : '',
      phone: typeof item.phone === 'string' ? item.phone : '',
      type: 'candidate',
      deleted_at: typeof item.deleted_at === 'string' ? item.deleted_at : new Date().toISOString(),
      deleted_by: typeof item.deleted_by === 'string' ? item.deleted_by : '',
    }))
}

export function readLocalRecycleBin(storage = window.localStorage) {
  try {
    const raw = storage.getItem(RECYCLE_BIN_STORAGE_KEY)
    const items = raw === null ? cloneDefaults() : normalizeLocal(JSON.parse(raw))
    storage.setItem(RECYCLE_BIN_STORAGE_KEY, JSON.stringify(items))
    return items
  } catch {
    const items = cloneDefaults()
    storage.setItem(RECYCLE_BIN_STORAGE_KEY, JSON.stringify(items))
    return items
  }
}

function writeLocalRecycleBin(items, storage = window.localStorage) {
  const normalized = normalizeLocal(items)
  storage.setItem(RECYCLE_BIN_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

/** Demo mode: Candidates page deletes push their records into the local bin. */
export function addLocalRecycleBinItems(records) {
  const incoming = (Array.isArray(records) ? records : [records]).filter(Boolean)
  if (!incoming.length) return readLocalRecycleBin()
  const existing = readLocalRecycleBin()
  const knownIds = new Set(existing.map((item) => item.id))
  const additions = incoming
    .filter((record) => !knownIds.has(record.id))
    .map((record) => ({
      id: record.id,
      name: record.name || 'Unnamed candidate',
      email: record.email || '',
      phone: record.phone || '',
      type: 'candidate',
      deleted_at: record.deleted_at || new Date().toISOString(),
      deleted_by: '',
    }))
  return additions.length ? writeLocalRecycleBin([...additions, ...existing]) : existing
}

function toViewItem(local) {
  return {
    key: `candidate:${local.id}`,
    rowId: local.id,
    type: 'candidate',
    name: local.name,
    detail: [local.email && `Email: ${local.email}`, local.phone && `Phone: ${local.phone}`].filter(Boolean).join(', '),
    deleted_at: local.deleted_at,
  }
}

// ── Supabase mode: one query per entity ────────────────────────────────────
const LOADERS = {
  candidate: {
    load: getDeletedCandidates,
    view: (r) => ({ name: r.name || 'Unnamed candidate', detail: [r.email && `Email: ${r.email}`, r.phone && `Phone: ${r.phone}`, r.stage && `Stage: ${r.stage}`].filter(Boolean).join(', ') }),
    restore: (item) => restoreCandidate(item.rowId),
    purge: (item) => permanentDeleteCandidate(item.rowId),
  },
  job: {
    load: getDeletedJobs,
    view: (r) => ({ name: r.title || 'Untitled job', detail: [r.company, r.city || r.country, r.status].filter(Boolean).join(' • ') }),
    restore: (item) => restoreJob(item.rowId),
    purge: (item) => permanentDeleteJob(item.rowId),
  },
  task: {
    load: getDeletedTasks,
    view: (r) => ({ name: r.title || 'Untitled task', detail: [r.status, r.priority && `${r.priority} priority`, r.due_date && `Due ${r.due_date}`].filter(Boolean).join(' • ') }),
    restore: (item) => restoreTask(item.rowId),
    purge: (item) => permanentDeleteTask(item.rowId),
  },
  appointment: {
    load: getDeletedAppointments,
    view: (r) => ({ name: r.title || 'Appointment', detail: [r.candidates?.name, r.type, [r.date, r.time].filter(Boolean).join(' ')].filter(Boolean).join(' • ') }),
    restore: (item) => restoreAppointment(item.rowId),
    purge: (item) => permanentDeleteAppointment(item.rowId),
  },
  document: {
    load: getDeletedDocuments,
    view: (r) => ({ name: r.file_name || 'Document', detail: [r.document_type, r.candidates?.name].filter(Boolean).join(' • ') }),
    restore: (item) => restoreDocument(item.rowId),
    purge: (item) => permanentDeleteDocument(item.rowId, item.filePath),
  },
}

export async function loadRecycleBinItems() {
  if (!isSupabaseConfigured) return readLocalRecycleBin().map(toViewItem)

  const types = Object.keys(LOADERS)
  const results = await Promise.allSettled(types.map((type) => LOADERS[type].load()))
  const items = []
  const failed = []
  results.forEach((result, i) => {
    const type = types[i]
    if (result.status !== 'fulfilled') { failed.push(type); return }
    for (const row of result.value || []) {
      items.push({
        key: `${type}:${row.id}`,
        rowId: row.id,
        type,
        filePath: row.file_path || null,
        deleted_at: row.deleted_at,
        ...LOADERS[type].view(row),
      })
    }
  })
  if (failed.length === types.length) throw new Error('Failed to load deleted items')
  items.sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)))
  items.failedTypes = failed
  return items
}

export async function restoreRecycleBinItem(item) {
  if (isSupabaseConfigured) {
    await LOADERS[item.type].restore(item)
    return
  }
  writeLocalRecycleBin(readLocalRecycleBin().filter((c) => c.id !== item.rowId))
}

export async function deleteRecycleBinItem(item) {
  if (isSupabaseConfigured) {
    await LOADERS[item.type].purge(item)
    return
  }
  writeLocalRecycleBin(readLocalRecycleBin().filter((c) => c.id !== item.rowId))
}
