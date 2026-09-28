// Phase 2 Document center: per-candidate checklist (passport, CV, medical,
// good conduct, visa) with missing / expiring / expired indicators. Every view
// goes through a short-lived signed URL (CRM-1); nothing is ever public.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, Upload, Eye, Download, Trash2, CircleCheck, AlertTriangle, CircleX, Clock, CircleDashed } from 'lucide-react'
import Modal from '../ui/Modal'
import Button from '../ui/Button'
import Skeleton from '../ui/Skeleton'
import { useToast } from '../../contexts/ToastContext'
import { isSupabaseConfigured } from '../../supabase/client'
import { getDocuments, uploadDocument, getSignedUrl, downloadDocument, deleteDocument, updateDocument } from '../../services/documentService'
import { buildChecklist, REQUIRED_DOCUMENTS, expiryStatus } from '../../utils/documentChecklist'
import { DOCUMENT_TYPES } from '../../utils/constants'

const MAX_BYTES = 10 * 1024 * 1024
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx'

const STATUS_UI = {
  missing: { label: 'Missing', icon: CircleDashed, chip: 'bg-gray-100 text-gray-600', card: 'border-dashed border-gray-300' },
  expired: { label: 'Expired', icon: CircleX, chip: 'bg-red-100 text-red-700', card: 'border-red-300 bg-red-50/40' },
  critical: { label: 'Expiring', icon: AlertTriangle, chip: 'bg-orange-100 text-orange-700', card: 'border-orange-300 bg-orange-50/40' },
  warning: { label: 'Expiring soon', icon: Clock, chip: 'bg-yellow-100 text-yellow-800', card: 'border-yellow-300' },
  valid: { label: 'Valid', icon: CircleCheck, chip: 'bg-green-100 text-green-700', card: 'border-green-200' },
  'no-expiry': { label: 'No expiry set', icon: AlertTriangle, chip: 'bg-amber-100 text-amber-800', card: 'border-amber-200' },
}

function statusText(item) {
  if (item.status === 'expired') return `Expired ${Math.abs(item.daysLeft)} day${Math.abs(item.daysLeft) === 1 ? '' : 's'} ago`
  if (item.status === 'critical' || item.status === 'warning') return `Expires in ${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'}`
  if (item.status === 'no-expiry') return 'Add the expiry date'
  return STATUS_UI[item.status].label
}

async function openSigned(filePath, toast) {
  // Open the tab synchronously (popup blockers), then point it at the signed URL.
  const win = window.open('about:blank', '_blank')
  try {
    const url = await getSignedUrl(filePath, 600)
    if (win) {
      win.opener = null
      win.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (err) {
    if (win) win.close()
    toast.error(err?.message || 'Could not open the document')
  }
}

function UploadModal({ open, onClose, candidateId, presetType, onUploaded }) {
  const toast = useToast()
  const [type, setType] = useState(presetType || DOCUMENT_TYPES[0])
  const [expiry, setExpiry] = useState('')
  const [file, setFile] = useState(null)
  const [saving, setSaving] = useState(false)
  const needsExpiry = REQUIRED_DOCUMENTS.some((r) => r.expires && r.types[0] === type)

  useEffect(() => {
    if (open) {
      setType(presetType || DOCUMENT_TYPES[0])
      setExpiry('')
      setFile(null)
    }
  }, [open, presetType])

  async function submit(e) {
    e.preventDefault()
    if (!file) return toast.error('Choose a file to upload')
    if (file.size > MAX_BYTES) return toast.error('Files must be 10 MB or smaller')
    setSaving(true)
    try {
      await uploadDocument(file, candidateId, type, 'manual', { expiryDate: expiry || null })
      toast.success(`${type} uploaded`)
      onUploaded()
      onClose()
    } catch (err) {
      toast.error(err?.message || 'Upload failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={open} onClose={onClose} title="Upload document" size="sm">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="doc-type" className="mb-1 block text-sm font-medium text-text-primary">Document type</label>
          <select id="doc-type" value={type} onChange={(e) => setType(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30">
            {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="doc-expiry" className="mb-1 block text-sm font-medium text-text-primary">
            Expiry date {needsExpiry ? <span className="text-xs font-normal text-amber-700">(needed for expiry alerts)</span> : <span className="text-xs font-normal text-gray-400">(optional)</span>}
          </label>
          <input id="doc-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30" />
        </div>
        <div>
          <label htmlFor="doc-file" className="mb-1 block text-sm font-medium text-text-primary">File</label>
          <input id="doc-file" type="file" accept={ACCEPT} required onChange={(e) => setFile(e.target.files?.[0] || null)} className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-lg file:border-0 file:bg-cream file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary" />
          <p className="mt-1 text-xs text-gray-400">PDF, image or Word, up to 10 MB. Stored privately; viewed only through expiring links.</p>
        </div>
        <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}><Upload className="h-4 w-4" aria-hidden="true" /> Upload</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function DocumentCenter({ candidateId, onChanged }) {
  const toast = useToast()
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [uploadType, setUploadType] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setDocs([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setDocs((await getDocuments({ candidateId })) || [])
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [candidateId])

  useEffect(() => { load() }, [load])

  const checklist = useMemo(() => buildChecklist(docs), [docs])

  function changed() {
    load()
    if (onChanged) onChanged()
  }

  async function saveExpiry(doc, value) {
    try {
      await updateDocument(doc.id, { expiry_date: value || null })
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, expiry_date: value || null } : d)))
      toast.success('Expiry date saved')
      if (onChanged) onChanged()
    } catch (err) {
      toast.error(err?.message || 'Could not save the expiry date')
    }
  }

  async function confirmDelete() {
    const doc = pendingDelete
    setPendingDelete(null)
    try {
      await deleteDocument(doc.id, doc.file_path)
      setDocs((prev) => prev.filter((d) => d.id !== doc.id))
      toast.success('Document moved to the Recycle Bin')
      if (onChanged) onChanged()
    } catch (err) {
      toast.error(err?.message || 'Delete failed')
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-800">
        Demo mode: the document center needs a live Supabase connection (private storage + signed URLs).
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="checklist-title">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="checklist-title" className="text-sm font-bold text-primary">
            Placement checklist <span className="font-normal text-gray-400">({checklist.complete}/{checklist.total} on file)</span>
          </h3>
          <Button size="sm" onClick={() => setUploadType(DOCUMENT_TYPES[0])}><Upload className="h-3.5 w-3.5" aria-hidden="true" /> Upload</Button>
        </div>
        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{REQUIRED_DOCUMENTS.map((r) => <Skeleton key={r.key} className="h-28" />)}</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {checklist.items.map((item) => {
              const ui = STATUS_UI[item.status]
              const Icon = ui.icon
              const req = REQUIRED_DOCUMENTS.find((r) => r.key === item.key)
              return (
                <div key={item.key} className={`flex flex-col rounded-xl border bg-white p-3 ${ui.card}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-text-primary">{item.label}</span>
                    <Icon className="h-4 w-4 text-gray-500" aria-hidden="true" />
                  </div>
                  <span className={`mt-2 w-fit rounded-full px-2 py-0.5 text-[11px] font-medium ${ui.chip}`}>{statusText(item)}</span>
                  {item.document && <p className="mt-1 truncate text-[11px] text-gray-500" title={item.document.file_name}>{item.document.file_name}</p>}
                  <div className="mt-auto flex gap-3 pt-3">
                    {item.document && (
                      <button type="button" onClick={() => openSigned(item.document.file_path, toast)} className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" /> View
                      </button>
                    )}
                    <button type="button" onClick={() => setUploadType(req.types[0])} className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" /> {item.document ? 'Replace' : 'Upload'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="all-docs-title">
        <h3 id="all-docs-title" className="mb-3 text-sm font-bold text-primary">All documents</h3>
        {error && (
          <div role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Couldn't load documents. <button type="button" onClick={load} className="font-medium underline">Retry</button>
          </div>
        )}
        {!loading && docs.length === 0 && !error && (
          <p className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">No documents uploaded for this candidate yet.</p>
        )}
        {docs.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-cream-light/60 text-xs uppercase tracking-wide text-primary">
                <tr>
                  <th scope="col" className="px-3 py-2">File</th>
                  <th scope="col" className="px-3 py-2">Type</th>
                  <th scope="col" className="px-3 py-2">Expiry</th>
                  <th scope="col" className="px-3 py-2">Uploaded</th>
                  <th scope="col" className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {docs.map((d) => {
                  const exp = expiryStatus(d.expiry_date)
                  return (
                    <tr key={d.id}>
                      <td className="max-w-[220px] px-3 py-2">
                        <span className="flex items-center gap-2 truncate" title={d.file_name}>
                          <FileText className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                          <span className="truncate">{d.file_name}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-secondary">{d.document_type}</td>
                      <td className="px-3 py-2">
                        <label className="sr-only" htmlFor={`exp-${d.id}`}>Expiry date for {d.file_name}</label>
                        <input
                          id={`exp-${d.id}`}
                          type="date"
                          defaultValue={d.expiry_date || ''}
                          onBlur={(e) => e.target.value !== (d.expiry_date || '') && saveExpiry(d, e.target.value)}
                          className={`rounded-md border px-2 py-1 text-xs outline-none focus:border-primary ${exp.status === 'expired' ? 'border-red-300 text-red-700' : exp.status === 'critical' ? 'border-orange-300 text-orange-700' : 'border-gray-200'}`}
                        />
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">{d.created_at ? new Date(d.created_at).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', year: 'numeric' }) : ''}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => openSigned(d.file_path, toast)} className="rounded p-1.5 text-primary hover:bg-cream-warm" aria-label={`View ${d.file_name}`}><Eye className="h-4 w-4" aria-hidden="true" /></button>
                          <button type="button" onClick={() => downloadDocument(d.file_path, d.file_name).catch((err) => toast.error(err?.message || 'Download failed'))} className="rounded p-1.5 text-primary hover:bg-cream-warm" aria-label={`Download ${d.file_name}`}><Download className="h-4 w-4" aria-hidden="true" /></button>
                          <button type="button" onClick={() => setPendingDelete(d)} className="rounded p-1.5 text-red-500 hover:bg-red-50" aria-label={`Delete ${d.file_name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <UploadModal open={Boolean(uploadType)} onClose={() => setUploadType(null)} candidateId={candidateId} presetType={uploadType} onUploaded={changed} />

      <Modal isOpen={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} title="Delete document" size="sm">
        <p className="text-sm text-text-secondary">
          Move <strong>{pendingDelete?.file_name}</strong> to the Recycle Bin? An admin can restore it.
        </p>
        <div className="mt-6 flex justify-end gap-3 border-t border-gray-200 pt-4">
          <Button type="button" variant="ghost" onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button type="button" variant="danger" onClick={confirmDelete}>Delete</Button>
        </div>
      </Modal>
    </div>
  )
}
