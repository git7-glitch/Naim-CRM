import { supabase } from '../supabase/client'
import { ilikeAny } from '../utils/sanitizeSearch'
import { logActivity } from './activityService'

const TABLE = 'tasks'

export async function getTasks({ search, status, priority, candidateId, page = 1, pageSize = 20 } = {}) {
  let query = supabase.from(TABLE).select('*', { count: 'exact' }).is('deleted_at', null)

  const searchFilter = ilikeAny(['title', 'description'], search)
  if (searchFilter) query = query.or(searchFilter)
  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)
  if (candidateId) query = query.eq('candidate_id', candidateId)

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, count, error } = await query
    .order('due_date', { ascending: true, nullsFirst: true })
    .range(from, to)

  if (error) throw error
  return { data, count, page, pageSize }
}

export async function addTask(task) {
  const { data, error } = await supabase.from(TABLE).insert(task).select().single()
  if (error) throw error
  if (data?.candidate_id) {
    logActivity({ entityType: 'task', entityId: data.id, candidateId: data.candidate_id, action: 'task_created', summary: `Task created: ${data.title}`, changes: { due_date: data.due_date } })
  }
  return data
}

export async function updateTask(id, updates) {
  const patch = { ...updates, updated_at: new Date().toISOString() }
  if (updates?.status === 'Completed' && !updates.completed_at) patch.completed_at = patch.updated_at
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select().single()
  if (error) throw error
  if (data?.candidate_id && updates?.status) {
    logActivity({ entityType: 'task', entityId: id, candidateId: data.candidate_id, action: 'task_updated', summary: `Task "${data.title}" set to ${updates.status}` })
  }
  return data
}

/** Soft delete: the task moves to the Recycle Bin. */
export async function deleteTask(id) {
  const { error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function archiveTasks(ids) {
  if (!ids.length) return
  const now = new Date().toISOString()
  const { error } = await supabase.from(TABLE).update({ archived_at: now, updated_at: now }).in('id', ids)
  if (error) throw error
}

/** Moves completed tasks finished before `cutoff` to the Recycle Bin and returns how many went. */
export async function deleteCompletedTasksBefore(cutoff) {
  if (!cutoff) return 0
  const { data, error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString() })
    .eq('status', 'Completed')
    .is('deleted_at', null)
    .lt('completed_at', cutoff)
    .select('id')
  if (error) throw error
  return data?.length || 0
}

export async function getTaskCounts() {
  const { data, error } = await supabase.from(TABLE).select('status').is('deleted_at', null)
  if (error) throw error
  const counts = {}
  data.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1 })
  return counts
}

export async function getDeletedTasks() {
  const { data, error } = await supabase.from(TABLE).select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function restoreTask(id) {
  const { error } = await supabase.from(TABLE).update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}

export async function permanentDeleteTask(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
}
