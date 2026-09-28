import { supabase, isSupabaseConfigured } from '../supabase/client'
import { demoKPIs } from './demoData'

const CANDIDATE_STAGES = ['New', 'Interview', 'Offer', 'Completed', 'Rejected', 'Withdrawn']

/**
 * Get candidates grouped by stage (funnel)
 */
export async function getCandidatesByStage() {
  if (!isSupabaseConfigured) return demoKPIs.byStage

  try {
    const { data, error } = await supabase
      .from('candidates')
      .select('id, stage', { count: 'exact' })
      .order('stage')

    if (error) throw error

    const stages = CANDIDATE_STAGES.map((stage) => ({
      stage,
      count: (data || []).filter((c) => (c.stage || 'New') === stage).length,
    }))

    return stages
  } catch (err) {
    console.error('getCandidatesByStage error:', err)
    return CANDIDATE_STAGES.map((stage) => ({ stage, count: 0 }))
  }
}

/**
 * Get placements count for the current month
 */
export async function getMonthlyPlacements() {
  if (!isSupabaseConfigured) return demoKPIs.monthlyPlacements

  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

    const { data, error, count } = await supabase
      .from('candidates')
      .select('id', { count: 'exact' })
      .eq('stage', 'Completed')
      .gte('updated_at', monthStart.toISOString())
      .lte('updated_at', monthEnd.toISOString())

    if (error) throw error

    return {
      month: monthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
      count: count || 0,
    }
  } catch (err) {
    console.error('getMonthlyPlacements error:', err)
    return { month: 'This Month', count: 0 }
  }
}

/**
 * Get documents expiring soon (good-conduct, medical, visas)
 * Warning at 90 days, critical at 30 days
 */
export async function getExpiringDocuments(warnDays = 90) {
  if (!isSupabaseConfigured) return demoKPIs.expiringDocuments

  try {
    const now = new Date()
    const warnDate = new Date(now.getTime() + warnDays * 24 * 60 * 60 * 1000)
    const criticalDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    const docTypes = ['good-conduct', 'medical', 'visa']
    const { data, error } = await supabase
      .from('documents')
      .select('id, candidate_id, doc_type, expiry_date, candidates(name)')
      .in('doc_type', docTypes)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', warnDate.toISOString().split('T')[0])
      .gt('expiry_date', now.toISOString().split('T')[0])

    if (error) throw error

    const critical = (data || []).filter((d) => new Date(d.expiry_date) <= criticalDate).length
    const warning = (data || []).length - critical

    return { warning, critical, total: (data || []).length }
  } catch (err) {
    console.error('getExpiringDocuments error:', err)
    return { warning: 0, critical: 0, total: 0 }
  }
}

/**
 * Get tasks due today
 */
export async function getTasksDueToday() {
  if (!isSupabaseConfigured) return demoKPIs.tasksDueToday

  try {
    const today = new Date().toISOString().split('T')[0]
    const { data, error, count } = await supabase
      .from('tasks')
      .select('id', { count: 'exact' })
      .eq('due_date', today)
      .neq('status', 'Completed')

    if (error) throw error

    return { date: today, count: count || 0 }
  } catch (err) {
    console.error('getTasksDueToday error:', err)
    return { date: new Date().toISOString().split('T')[0], count: 0 }
  }
}

/**
 * Get all KPIs (candidates by stage, placements, expiring docs, tasks due)
 */
export async function getKPIs() {
  const [byStage, placements, expiring, tasksDue] = await Promise.all([
    getCandidatesByStage(),
    getMonthlyPlacements(),
    getExpiringDocuments(),
    getTasksDueToday(),
  ])

  return {
    byStage,
    placements,
    expiring,
    tasksDue,
  }
}
