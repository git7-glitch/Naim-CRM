import { supabase } from '../supabase/client'
import { ilikeAny } from '../utils/sanitizeSearch'

const TABLE = 'tasks'

export async function getTasks({ search, status, priority, page = 1, pageSize = 20 } = {}) {
  let query = supabase.from(TABLE).select('*', { count: 'exact' })

  const searchFilter = ilikeAny(['title', 'description'], search)
  if (searchFilter) query = query.or(searchFilter)
  if (status) query = query.eq('status', status)
  if (priority) query = query.eq('priority', priority)

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
  return data
}

export async function updateTask(id, updates) {
  const { data, error } = await supabase.from(TABLE).update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteTask(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
}

export async function archiveTasks(ids) {
  if (!ids.length) return
  const now = new Date().toISOString()
  const { error } = await supabase.from(TABLE).update({ archived_at: now, updated_at: now }).in('id', ids)
  if (error) throw error
}

/** Hard-deletes completed tasks finished before `cutoff` and returns how many went. */
export async function deleteCompletedTasksBefore(cutoff) {
  if (!cutoff) return 0
  const { data, error } = await supabase.from(TABLE).delete().eq('status', 'Completed').lt('completed_at', cutoff).select('id')
  if (error) throw error
  return data?.length || 0
}

export async function getTaskCounts() {
  const { data, error } = await supabase.from(TABLE).select('status')
  if (error) throw error
  const counts = {}
  data.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1 })
  return counts
}
