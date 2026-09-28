import { supabase } from '../supabase/client'
import { ilikeAny } from '../utils/sanitizeSearch'
import { TERMINAL_STAGES, normalizeStage } from '../utils/constants'
import { transitionError } from '../utils/stageTransitions'
import { logActivity, diffFields } from './activityService'

const TABLE = 'candidates'
const PAGE = 1000

export async function getCandidates({ search, stage, country, status, page = 1, pageSize = 20, sortBy = 'created_at', sortDir = 'desc' } = {}) {
  let query = supabase.from(TABLE).select('*', { count: 'exact' }).is('deleted_at', null)

  const searchFilter = ilikeAny(['name', 'email', 'phone', 'passport_number'], search)
  if (searchFilter) query = query.or(searchFilter)
  if (stage) query = query.eq('stage', stage)
  if (country) query = query.eq('country_applying_to', country)
  if (status) query = query.eq('status', status)

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, count, error } = await query
    .order(sortBy, { ascending: sortDir === 'asc' })
    .range(from, to)

  if (error) throw error
  return { data, count, page, pageSize }
}

export async function getAllActiveCandidates() {
  const { data, error } = await supabase.from(TABLE).select('*').is('deleted_at', null).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** Light rows for the pipeline board, paged past PostgREST's 1000-row cap. */
export async function getPipelineCandidates({ search, country } = {}) {
  const rows = []
  const searchFilter = ilikeAny(['name', 'email', 'phone', 'passport_number'], search)
  for (let from = 0; ; from += PAGE) {
    let query = supabase
      .from(TABLE)
      .select('id, name, email, phone, stage, job_title, work_position, country_applying_to, updated_at, created_at')
      .is('deleted_at', null)
    if (searchFilter) query = query.or(searchFilter)
    if (country) query = query.eq('country_applying_to', country)
    const { data, error } = await query.order('updated_at', { ascending: false }).range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return rows
  }
}

export async function countActiveCandidates() {
  const { count, error } = await supabase.from(TABLE).select('id', { count: 'exact', head: true }).is('deleted_at', null)
  if (error) throw error
  return count || 0
}

export async function getCandidateById(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function addCandidate(candidate) {
  const { data, error } = await supabase.from(TABLE).insert(candidate).select().single()
  if (error) throw error
  logActivity({ entityType: 'candidate', entityId: data.id, candidateId: data.id, action: 'created', summary: `Candidate ${data.name || ''} created`.trim(), changes: { stage: { from: null, to: data.stage } } })
  return data
}

/**
 * Validated stage move (Kanban, dashboards, WebMCP). Throws a readable error
 * for an illegal transition before touching the DB; the DB trigger enforces
 * the same rule for every other writer.
 */
export async function changeCandidateStage(id, toStage, fromStage) {
  const target = normalizeStage(toStage)
  let from = fromStage
  if (from === undefined) {
    const { data, error } = await supabase.from(TABLE).select('stage').eq('id', id).single()
    if (error) throw error
    from = data?.stage
  }
  const problem = transitionError(from, target)
  if (problem) throw new Error(problem)
  const { data, error } = await supabase
    .from(TABLE)
    .update({ stage: target, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  if (normalizeStage(from) !== target) {
    logActivity({ entityType: 'candidate', entityId: id, candidateId: id, action: 'stage_change', summary: `Stage changed from ${normalizeStage(from) || 'New'} to ${target}`, changes: { from: normalizeStage(from) || 'New', to: target } })
  }
  return data
}

export async function updateCandidate(id, updates) {
  let before = null
  try {
    const { data } = await supabase.from(TABLE).select('*').eq('id', id).single()
    before = data
  } catch {
    before = null
  }
  if (before && updates && Object.prototype.hasOwnProperty.call(updates, 'stage')) {
    const problem = transitionError(before.stage, updates.stage)
    if (problem) throw new Error(problem)
  }
  const { data, error } = await supabase.from(TABLE).update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  const changes = diffFields(before || {}, updates || {})
  const fields = Object.keys(changes)
  if (fields.length) {
    const stageMoved = changes.stage
    logActivity({
      entityType: 'candidate',
      entityId: id,
      candidateId: id,
      action: stageMoved ? 'stage_change' : 'updated',
      summary: stageMoved
        ? `Stage changed from ${normalizeStage(stageMoved.from) || 'New'} to ${normalizeStage(stageMoved.to)}`
        : `Updated ${fields.slice(0, 6).join(', ')}${fields.length > 6 ? '…' : ''}`,
      changes: stageMoved ? { from: normalizeStage(stageMoved.from) || 'New', to: normalizeStage(stageMoved.to), fields } : { fields },
    })
  }
  return data
}

export async function deleteCandidate(id) {
  const { error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
  logActivity({ entityType: 'candidate', entityId: id, candidateId: id, action: 'deleted', summary: 'Moved to Recycle Bin' })
}

export async function bulkUpdateCandidates(ids, updates) {
  const { error } = await supabase.from(TABLE).update({ ...updates, updated_at: new Date().toISOString() }).in('id', ids)
  if (error) throw error
  const fields = Object.keys(updates || {})
  ids.forEach((id) => logActivity({ entityType: 'candidate', entityId: id, candidateId: id, action: updates?.stage ? 'stage_change' : 'updated', summary: updates?.stage ? `Stage set to ${updates.stage} (bulk)` : `Bulk update: ${fields.join(', ')}`, changes: updates?.stage ? { to: updates.stage, bulk: true } : { fields, bulk: true } }))
}

export async function bulkDeleteCandidates(ids) {
  const { error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).in('id', ids)
  if (error) throw error
  ids.forEach((id) => logActivity({ entityType: 'candidate', entityId: id, candidateId: id, action: 'deleted', summary: 'Moved to Recycle Bin (bulk)' }))
}

// Soft-deletes every candidate still in the list. Used by the Candidates page
// "Clear Supabase" action; records land in the Recycle Bin rather than being
// destroyed, so an accidental click stays recoverable.
export async function clearAllCandidates() {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .is('deleted_at', null)
    .select('id')
  if (error) throw error
  return data?.length || 0
}

// Auto-delete sweeps only candidates whose pipeline has ended
// (canonical TERMINAL_STAGES: Completed, Rejected, Withdrawn).
export async function autoDeleteCompletedCandidates(cutoff) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .in('stage', TERMINAL_STAGES)
    .is('deleted_at', null)
    .lt('updated_at', cutoff)
    .select('id')
  if (error) throw error
  return data?.length || 0
}

export async function getCandidatesByStage() {
  const { data, error } = await supabase.from(TABLE).select('stage').is('deleted_at', null)
  if (error) throw error
  const counts = {}
  data.forEach((c) => { counts[c.stage] = (counts[c.stage] || 0) + 1 })
  return counts
}

export async function getCandidatesByCountry() {
  const { data, error } = await supabase.from(TABLE).select('country_applying_to').is('deleted_at', null)
  if (error) throw error
  const counts = {}
  data.forEach((c) => {
    const key = c.country_applying_to || 'Unknown'
    counts[key] = (counts[key] || 0) + 1
  })
  return counts
}

export async function getRecentPlacements(limit = 10) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('stage', 'Placed').is('deleted_at', null).order('updated_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data
}

// Admin-only in the DB (migration 004 guard_recycle_bin_restore).
export async function restoreCandidate(id) {
  const { error } = await supabase.from(TABLE).update({ deleted_at: null }).eq('id', id)
  if (error) throw error
  logActivity({ entityType: 'candidate', entityId: id, candidateId: id, action: 'restored', summary: 'Restored from Recycle Bin' })
}

// Admin-only in the DB (RLS DELETE policy, migration 004).
export async function permanentDeleteCandidate(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function getDeletedCandidates() {
  const { data, error } = await supabase.from(TABLE).select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  if (error) throw error
  return data
}
