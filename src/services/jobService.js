import { supabase } from '../supabase/client'
import { ilikeAny } from '../utils/sanitizeSearch'

const TABLE = 'jobs'

export async function getJobs({ search, status, country, page = 1, pageSize = 20 } = {}) {
  let query = supabase.from(TABLE).select('*', { count: 'exact' }).is('deleted_at', null)

  const searchFilter = ilikeAny(['title', 'description'], search)
  if (searchFilter) query = query.or(searchFilter)
  if (status) query = query.eq('status', status)
  if (country) query = query.eq('country', country)

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error
  return { data, count, page, pageSize }
}

export async function getJobById(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function addJob(job) {
  const { data, error } = await supabase.from(TABLE).insert(job).select().single()
  if (error) throw error
  return data
}

export async function updateJob(id, updates) {
  const { data, error } = await supabase.from(TABLE).update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  return data
}

export async function deleteJob(id) {
  const { error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function getActiveJobs() {
  const { data, error } = await supabase.from(TABLE).select('*').eq('status', 'Active').is('deleted_at', null).order('created_at', { ascending: false })
  if (error) throw error
  return data
}
