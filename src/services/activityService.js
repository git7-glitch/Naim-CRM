// Phase 2 activity log: who changed what, and when. Browser writes go through
// here (service layer); the DB forces actor_id = auth.uid() and the timestamp,
// and logs Hermes/service_role writes itself (migration 004), so history is
// complete without double entries. Logging is best-effort: a failed log write
// never breaks the user's actual change.
import { supabase, isSupabaseConfigured } from '../supabase/client'

const TABLE = 'activity_log'

export async function logActivity({ entityType, entityId = null, candidateId = null, action, summary = '', changes = {} }) {
  if (!isSupabaseConfigured || !entityType || !action) return null
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        entity_type: entityType,
        entity_id: entityId,
        candidate_id: candidateId,
        action,
        summary: String(summary || '').slice(0, 500),
        changes: changes && typeof changes === 'object' ? changes : {},
      })
      .select()
      .single()
    if (error) throw error
    return data
  } catch (err) {
    console.warn('Activity log write failed:', err?.message || err)
    return null
  }
}

export async function getCandidateActivity(candidateId, { limit = 100 } = {}) {
  if (!isSupabaseConfigured || !candidateId) return []
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('candidate_id', candidateId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function getRecentActivity({ limit = 20 } = {}) {
  if (!isSupabaseConfigured) return []
  const { data, error } = await supabase
    .from(TABLE)
    .select('*, candidates(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

/** Fields that changed between two records (ignores bookkeeping columns). */
export function diffFields(before = {}, after = {}) {
  const ignore = new Set(['updated_at', 'created_at', 'id'])
  const changes = {}
  for (const key of Object.keys(after || {})) {
    if (ignore.has(key)) continue
    const a = before?.[key] ?? null
    const b = after[key] ?? null
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a, to: b }
  }
  return changes
}
