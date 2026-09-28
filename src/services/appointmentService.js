import { supabase } from '../supabase/client'
import { sanitizeSearch } from '../utils/sanitizeSearch'
import { logActivity } from './activityService'

const TABLE = 'appointments'

export async function getAppointments({ search, status, date, candidateId, page = 1, pageSize = 20 } = {}) {
  let query = supabase.from(TABLE).select('*, candidates(name, email, phone)', { count: 'exact' }).is('deleted_at', null)

  const term = sanitizeSearch(search)
  if (term) query = query.ilike('title', `%${term}%`)
  if (status) query = query.eq('status', status)
  if (date) query = query.eq('date', date)
  if (candidateId) query = query.eq('candidate_id', candidateId)

  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const { data, count, error } = await query
    .order('date', { ascending: true })
    .range(from, to)

  if (error) throw error
  return { data, count, page, pageSize }
}

export async function addAppointment(appointment) {
  const { data, error } = await supabase.from(TABLE).insert(appointment).select().single()
  if (error) throw error
  if (data?.candidate_id) {
    logActivity({ entityType: 'appointment', entityId: data.id, candidateId: data.candidate_id, action: 'appointment_booked', summary: `${data.type || 'Appointment'} booked for ${data.date}${data.time ? ` ${data.time}` : ''}` })
  }
  return data
}

export async function updateAppointment(id, updates) {
  const { data, error } = await supabase.from(TABLE).update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  if (data?.candidate_id && (updates?.status || updates?.date)) {
    logActivity({ entityType: 'appointment', entityId: id, candidateId: data.candidate_id, action: 'appointment_updated', summary: `${data.title}: ${updates.status || `moved to ${updates.date}`}` })
  }
  return data
}

/** Soft delete: the appointment moves to the Recycle Bin. */
export async function deleteAppointment(id) {
  const { error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export async function getUpcomingAppointments(limit = 10) {
  // Today in Mombasa, not UTC — avoids dropping the morning's appointments.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date())
  const { data, error } = await supabase.from(TABLE).select('*, candidates(name)').is('deleted_at', null).gte('date', today).order('date', { ascending: true }).limit(limit)
  if (error) throw error
  return data
}

export async function getDeletedAppointments() {
  const { data, error } = await supabase.from(TABLE).select('*, candidates(name)').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function restoreAppointment(id) {
  const { error } = await supabase.from(TABLE).update({ deleted_at: null }).eq('id', id)
  if (error) throw error
}

export async function permanentDeleteAppointment(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
}
