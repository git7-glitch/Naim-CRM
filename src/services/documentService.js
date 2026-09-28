import { supabase } from '../supabase/client'
import { logActivity } from './activityService'

const TABLE = 'documents'
const BUCKET = 'documents'

export async function getDocuments({ candidateId, documentType, includeDeleted = false } = {}) {
  let query = supabase.from(TABLE).select('*')
  if (!includeDeleted) query = query.is('deleted_at', null)
  if (candidateId) query = query.eq('candidate_id', candidateId)
  if (documentType) query = query.eq('document_type', documentType)
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data
}

/** Documents with an expiry date on or before `untilYmd` (YYYY-MM-DD), with the candidate's name. */
export async function getExpiringDocuments(untilYmd) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, candidate_id, document_type, file_name, expiry_date, candidates(name, deleted_at)')
    .is('deleted_at', null)
    .not('expiry_date', 'is', null)
    .lte('expiry_date', untilYmd)
    .order('expiry_date', { ascending: true })
    .limit(500)
  if (error) throw error
  return (data || [])
    .filter((d) => !d.candidates?.deleted_at)
    .map((d) => ({ ...d, candidate_name: d.candidates?.name || '' }))
}

export async function uploadDocument(file, candidateId, documentType, source = 'manual', { expiryDate = null } = {}) {
  const safeName = String(file.name || 'file').replace(/[^\w.\- ]+/g, '_')
  const filePath = `${candidateId}/${source}/${Date.now()}_${safeName}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(filePath, file)
  if (uploadError) throw uploadError

  const { data, error } = await supabase.from(TABLE).insert({
    candidate_id: candidateId,
    document_type: documentType,
    file_name: file.name,
    file_path: filePath,
    file_url: null,
    file_size: file.size,
    mime_type: file.type,
    ...(expiryDate ? { expiry_date: expiryDate } : {}),
  }).select().single()
  if (error) {
    try {
      const { error: rollbackError } = await supabase.storage.from(BUCKET).remove([filePath])
      void rollbackError
    } catch {
      // Preserve the database error that made the rollback necessary.
    }
    throw error
  }
  logActivity({ entityType: 'document', entityId: data.id, candidateId, action: 'document_uploaded', summary: `${documentType} uploaded (${file.name})`, changes: expiryDate ? { expiry_date: expiryDate } : {} })
  return data
}

export async function getSignedUrl(filePath, ttl = 600) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('://') || filePath.split('/').includes('..')) {
    throw new Error('A valid storage file path is required')
  }
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 600) {
    throw new Error('Signed URL lifetime must be between 1 and 600 seconds')
  }
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(filePath, ttl)
  if (error) throw error
  if (!data?.signedUrl) throw new Error('Unable to create document access link')
  return data.signedUrl
}

export async function updateDocument(id, updates) {
  const { data, error } = await supabase.from(TABLE).update(updates).eq('id', id).select().single()
  if (error) throw error
  if (data?.candidate_id) {
    logActivity({ entityType: 'document', entityId: id, candidateId: data.candidate_id, action: 'document_updated', summary: `${data.document_type} updated`, changes: { fields: Object.keys(updates || {}) } })
  }
  return data
}

/**
 * Phase 2: "delete" moves the document to the Recycle Bin (soft delete). The
 * stored file stays in the private bucket until an admin purges it, so a
 * restore brings the file back intact. `filePath` is kept for API compatibility.
 */
export async function deleteDocument(id, filePath) {
  void filePath
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw error
  if (data?.candidate_id) {
    logActivity({ entityType: 'document', entityId: id, candidateId: data.candidate_id, action: 'document_deleted', summary: `${data.document_type} moved to Recycle Bin` })
  }
}

export async function getDeletedDocuments() {
  const { data, error } = await supabase.from(TABLE).select('*, candidates(name)').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })
  if (error) throw error
  return data || []
}

// Admin-only in the DB (migration 004).
export async function restoreDocument(id) {
  const { data, error } = await supabase.from(TABLE).update({ deleted_at: null }).eq('id', id).select().single()
  if (error) throw error
  if (data?.candidate_id) {
    logActivity({ entityType: 'document', entityId: id, candidateId: data.candidate_id, action: 'document_restored', summary: `${data.document_type} restored from Recycle Bin` })
  }
}

// Admin-only in the DB: removes the row AND the stored file.
export async function permanentDeleteDocument(id, filePath) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  if (error) throw error
  if (filePath) {
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([filePath])
    if (storageError) throw storageError
  }
}

export async function downloadDocument(filePath, fileName) {
  const { data, error } = await supabase.storage.from(BUCKET).download(filePath)
  if (error) throw error
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
