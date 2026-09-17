import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileText, Loader2, Upload } from 'lucide-react'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import DocumentsTabs, { DOCUMENT_TAB_IDS } from '../components/documents/DocumentsTabs'
import CVIntegrationBanner from '../components/documents/CVIntegrationBanner'
import CVDocumentSection from '../components/documents/CVDocumentSection'
import CVDraftsSection from '../components/documents/CVDraftsSection'
import DocumentPreview from '../components/documents/DocumentPreview'
import MedicalReportsPanel, { MEDICAL_SECTIONS } from '../components/documents/MedicalReportsPanel'
import ContractsPanel, { CONTRACT_SECTIONS } from '../components/documents/ContractsPanel'
import LicensesCertificationsPanel, { LICENSE_SECTIONS } from '../components/documents/LicensesCertificationsPanel'
import AdvertsMarketingPanel, { MARKETING_SECTIONS } from '../components/documents/AdvertsMarketingPanel'
import ReportsPanel, { REPORT_SECTIONS } from '../components/documents/ReportsPanel'
import { formatDocumentDate, formatFileSize, readDocumentsStore, writeDocumentsStore } from '../services/documentsStore'
import { getDocuments, uploadDocument, downloadDocument, deleteDocument, updateDocument } from '../services/documentService'
import { getCVDrafts, deleteCVDraft } from '../services/cvDraftService'
import { isSupabaseConfigured } from '../supabase/client'
import { useToast } from '../contexts/ToastContext'

const ACCEPTED_DOCUMENT_EXTENSIONS = /\.(pdf|doc|docx|jpe?g|png|gif|webp|bmp|tiff?|heic|heif)$/i
const ACCEPTED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

// Every list of documents the page owns, keyed by the `kind` its handlers pass
// around. `collection` is the key the demo-mode store persists under.
const DOCUMENT_KINDS = {
  'builder-cv': { label: 'CV', sections: null, collection: 'builderCVs' },
  'uploaded-cv': { label: 'CV', sections: null, collection: 'uploadedCVs' },
  medical: { label: 'Medical document', sections: MEDICAL_SECTIONS, collection: 'medical' },
  contract: { label: 'Contract', sections: CONTRACT_SECTIONS, collection: 'contracts' },
  license: { label: 'License document', sections: LICENSE_SECTIONS, collection: 'licenses' },
  marketing: { label: 'Marketing document', sections: MARKETING_SECTIONS, collection: 'marketing' },
  report: { label: 'Report', sections: REPORT_SECTIONS, collection: 'reports' },
}

function kindLabel(kind) {
  return DOCUMENT_KINDS[kind]?.label || 'Document'
}

function emptySelection(sections) {
  return Object.fromEntries(sections.map((section) => [section.id, new Set()]))
}

function baseFileName(fileName) {
  return String(fileName || '').replace(/\.[^.]+$/, '')
}

function normalizeSupabaseDraft(row, index) {
  const name = row.full_name || row.name || row.title || 'Untitled CV'
  const kind = row.kind || (row.auto_saved ? 'Auto-saved Draft' : 'CV Draft')
  return {
    ...row,
    id: row.id || `live-cv-draft-${index + 1}`,
    number: index + 1,
    name,
    kind,
    title: row.title || `${name} - ${kind}`,
    size: row.size || formatFileSize(row.file_size),
    uploadedAt: row.uploadedAt || formatDocumentDate(row.updated_at || row.created_at),
    uploadedBy: row.uploadedBy || row.uploaded_by || 'CV Builder',
    description: row.description || `CV draft for ${name}`,
    filePath: row.filePath || row.file_path || null,
    fileName: row.fileName || row.file_name || null,
  }
}

function normalizeDocumentRecord(record, fallbackUploadedBy, section) {
  return {
    ...record,
    ...(section ? { section } : null),
    size: record.size || formatFileSize(record.file_size),
    uploadedAt: record.uploadedAt || formatDocumentDate(record.created_at),
    uploadedBy: record.uploaded_by || record.uploadedBy || fallbackUploadedBy,
    description: record.description || record.document_type,
  }
}

function validateUploadFile(file) {
  if (!file || file.size <= 0) return 'Select a non-empty file to upload.'
  const validType = ACCEPTED_DOCUMENT_MIME_TYPES.has(file.type) || file.type.startsWith('image/')
  const validExtension = ACCEPTED_DOCUMENT_EXTENSIONS.test(file.name)
  return validType || validExtension ? null : 'Upload a PDF, DOC, DOCX, or image file.'
}

function triggerBlobDownload(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

// Fixtures and CV Builder drafts carry no stored file, so a download of those
// records saves their details instead of failing.
function triggerTextDownload(record) {
  const displayName = record.file_name || record.name || record.title || 'document'
  const contents = [
    record.title || displayName,
    '',
    `File size: ${record.size || 'Size unavailable'}`,
    `Uploaded: ${record.uploadedAt || 'Date unavailable'} by ${record.uploadedBy || 'Unknown'}`,
    '',
    record.description || '',
  ].join('\n')
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' })
  const safeName = baseFileName(displayName).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '')
  triggerBlobDownload(blob, `${safeName || 'document'}.txt`)
}

export default function DocumentsPage() {
  const navigate = useNavigate()
  const toast = useToast()
  // Global search links in as /documents?tab=<section>, and the tab lives in
  // the URL so a refresh or a shared link lands on the same section.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab = DOCUMENT_TAB_IDS.includes(tabParam) ? tabParam : 'cvs'

  // Demo mode seeds its lists during the first render so the first paint
  // already shows the persisted documents. Read once per mount, then shared by
  // the initializers below (useState initializers run top to bottom on mount).
  const [demoSeed] = useState(() => (isSupabaseConfigured ? null : readDocumentsStore()))
  const seedFor = (collection) => demoSeed?.[collection] || []

  const [builderCVs, setBuilderCVs] = useState(() => seedFor('builderCVs'))
  const [uploadedCVs, setUploadedCVs] = useState(() => seedFor('uploadedCVs'))
  const [drafts, setDrafts] = useState(() => seedFor('drafts'))
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [medicalDocuments, setMedicalDocuments] = useState(() => seedFor('medical'))
  const [medicalSelected, setMedicalSelected] = useState(() => emptySelection(MEDICAL_SECTIONS))
  const [contractDocuments, setContractDocuments] = useState(() => seedFor('contracts'))
  const [contractSelected, setContractSelected] = useState(() => emptySelection(CONTRACT_SECTIONS))
  const [licenseDocuments, setLicenseDocuments] = useState(() => seedFor('licenses'))
  const [licenseSelected, setLicenseSelected] = useState(() => emptySelection(LICENSE_SECTIONS))
  const [marketingDocuments, setMarketingDocuments] = useState(() => seedFor('marketing'))
  const [marketingSelected, setMarketingSelected] = useState(() => emptySelection(MARKETING_SECTIONS))
  const [reportDocuments, setReportDocuments] = useState(() => seedFor('reports'))
  const [reportSelected, setReportSelected] = useState(() => emptySelection(REPORT_SECTIONS))
  const [previewRecord, setPreviewRecord] = useState(null)
  const [editRecord, setEditRecord] = useState(null)
  const [editDescription, setEditDescription] = useState('')
  const [confirmState, setConfirmState] = useState(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  // Demo mode has nothing to fetch, so it never shows the loading row.
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [pendingUpload, setPendingUpload] = useState(null)
  const [candidateId, setCandidateId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const requestGenerationRef = useRef(0)
  const uploadCounterRef = useRef(0)
  const draftIds = useMemo(() => drafts.map((draft) => draft.id), [drafts])

  const documentsByKind = {
    'builder-cv': builderCVs,
    'uploaded-cv': uploadedCVs,
    medical: medicalDocuments,
    contract: contractDocuments,
    license: licenseDocuments,
    marketing: marketingDocuments,
    report: reportDocuments,
  }
  const setDocumentsByKind = {
    'builder-cv': setBuilderCVs,
    'uploaded-cv': setUploadedCVs,
    medical: setMedicalDocuments,
    contract: setContractDocuments,
    license: setLicenseDocuments,
    marketing: setMarketingDocuments,
    report: setReportDocuments,
  }
  const selectedByKind = {
    medical: medicalSelected,
    contract: contractSelected,
    license: licenseSelected,
    marketing: marketingSelected,
    report: reportSelected,
  }
  const setSelectedByKind = {
    medical: setMedicalSelected,
    contract: setContractSelected,
    license: setLicenseSelected,
    marketing: setMarketingSelected,
    report: setReportSelected,
  }

  function handleTabChange(tab) {
    const next = new URLSearchParams(searchParams)
    if (tab === 'cvs') next.delete('tab')
    else next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  // A reload can drop rows that were selected, so selections are pruned to the
  // ids that actually came back.
  function pruneSelection(setSelected, records) {
    const liveIds = new Set(records.map((record) => record.id))
    setSelected((current) => Object.fromEntries(Object.entries(current).map(([sectionId, ids]) => [
      sectionId,
      new Set([...ids].filter((id) => liveIds.has(id))),
    ])))
  }

  async function loadCVData({ showLoading = true } = {}) {
    // Demo mode has no backend: its lists are seeded during the first render
    // and persisted by the effect below, so there is nothing to reload.
    if (!isSupabaseConfigured) return true

    const requestGeneration = ++requestGenerationRef.current
    if (showLoading) setLoading(true)

    const [documentsResult, medicalResult, draftsResult] = await Promise.allSettled([
      getDocuments({ documentType: 'Resume/CV' }),
      getDocuments(),
      getCVDrafts(),
    ])
    if (requestGeneration !== requestGenerationRef.current) return false

    if (documentsResult.status === 'fulfilled') {
      const documents = documentsResult.value || []
      const isBuilderDocument = (record) => (
        record.source === 'cv-builder' || record.file_path?.includes('/cv-builder/')
      )
      setBuilderCVs(documents.filter(isBuilderDocument).map((record) => normalizeDocumentRecord(record, 'CV Builder')))
      setUploadedCVs(documents.filter((record) => !isBuilderDocument(record)).map((record) => normalizeDocumentRecord(record, 'Current User')))
    } else {
      toast.error('Failed to load CV documents')
    }

    if (medicalResult.status === 'fulfilled') {
      const allDocuments = medicalResult.value || []
      const bySection = (sections, fallbackUploadedBy) => {
        const sectionByType = new Map(sections.map((section) => [section.type, section.id]))
        return allDocuments
          .filter((record) => sectionByType.has(record.document_type))
          .map((record) => normalizeDocumentRecord(record, fallbackUploadedBy, sectionByType.get(record.document_type)))
      }
      const bySectionByKind = {
        medical: bySection(MEDICAL_SECTIONS, 'Medical Officer'),
        contract: bySection(CONTRACT_SECTIONS, 'Current User'),
        license: bySection(LICENSE_SECTIONS, 'Current User'),
        marketing: bySection(MARKETING_SECTIONS, 'Current User'),
        report: bySection(REPORT_SECTIONS, 'Current User'),
      }
      setMedicalDocuments(bySectionByKind.medical)
      setContractDocuments(bySectionByKind.contract)
      setLicenseDocuments(bySectionByKind.license)
      setMarketingDocuments(bySectionByKind.marketing)
      setReportDocuments(bySectionByKind.report)
      pruneSelection(setMedicalSelected, bySectionByKind.medical)
      pruneSelection(setContractSelected, bySectionByKind.contract)
      pruneSelection(setLicenseSelected, bySectionByKind.license)
      pruneSelection(setMarketingSelected, bySectionByKind.marketing)
      pruneSelection(setReportSelected, bySectionByKind.report)
    } else {
      toast.error('Failed to load medical documents')
    }

    if (draftsResult.status === 'fulfilled') {
      const normalizedDrafts = (draftsResult.value || []).map(normalizeSupabaseDraft)
      const validDraftIds = new Set(normalizedDrafts.map((draft) => draft.id))
      setDrafts(normalizedDrafts)
      setSelectedIds((current) => new Set([...current].filter((id) => validDraftIds.has(id))))
    } else {
      toast.error('Failed to load CV drafts')
    }

    setLoading(false)
    return documentsResult.status === 'fulfilled' && medicalResult.status === 'fulfilled' && draftsResult.status === 'fulfilled'
  }

  useEffect(() => {
    loadCVData()
    return () => { requestGenerationRef.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Demo mode has no backend, so every list is mirrored to localStorage. That
  // keeps uploads, edits and deletes after navigating away or refreshing.
  useEffect(() => {
    if (isSupabaseConfigured) return
    writeDocumentsStore({
      builderCVs,
      uploadedCVs,
      drafts,
      medical: medicalDocuments,
      contracts: contractDocuments,
      licenses: licenseDocuments,
      marketing: marketingDocuments,
      reports: reportDocuments,
    })
  }, [builderCVs, uploadedCVs, drafts, medicalDocuments, contractDocuments, licenseDocuments, marketingDocuments, reportDocuments])

  function nextDemoId(kind) {
    uploadCounterRef.current += 1
    return `demo-${kind}-${Date.now()}-${uploadCounterRef.current}`
  }

  function buildDemoDocument(file, { kind, section, uploadedBy, description }) {
    return {
      id: nextDemoId(kind),
      ...(section ? { section: section.id, document_type: section.type } : { document_type: 'Resume/CV' }),
      file_name: file.name,
      file_size: file.size,
      size: formatFileSize(file.size),
      uploadedAt: formatDocumentDate(new Date()),
      uploadedBy,
      description: description || section?.subtitle || '',
      mime_type: file.type,
      demoFile: file,
    }
  }

  function addDemoUpload(file, source, documentSection, documentKind) {
    if (documentSection && documentKind) {
      const record = buildDemoDocument(file, {
        kind: documentKind,
        section: documentSection,
        uploadedBy: source === 'camera' ? 'Current User (Camera)' : 'Current User',
      })
      setDocumentsByKind[documentKind]((current) => [...current, record])
      return
    }

    if (source === 'draft') {
      const name = baseFileName(file.name) || 'Untitled CV'
      setDrafts((current) => [{
        id: nextDemoId('draft'),
        name,
        kind: 'Uploaded Draft',
        title: `${name} - Uploaded Draft`,
        size: formatFileSize(file.size),
        uploadedAt: formatDocumentDate(new Date()),
        uploadedBy: 'Current User',
        description: `Uploaded CV draft for ${name}`,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        demoFile: file,
      }, ...current])
      return
    }

    const fromBuilder = source === 'cv-builder'
    const record = buildDemoDocument(file, {
      kind: fromBuilder ? 'builder-cv' : 'uploaded-cv',
      uploadedBy: fromBuilder ? 'CV Builder' : 'Current User',
      description: fromBuilder
        ? `CV added to the CV Builder library for ${baseFileName(file.name) || 'candidate'}`
        : `CV uploaded manually for ${baseFileName(file.name) || 'candidate'}`,
    })
    setDocumentsByKind[fromBuilder ? 'builder-cv' : 'uploaded-cv']((current) => [...current, record])
  }

  function handleUpload(file, source, documentSection = null, documentKind = null) {
    const validationError = validateUploadFile(file)
    if (validationError) {
      toast.error(validationError)
      return
    }
    if (!isSupabaseConfigured) {
      addDemoUpload(file, source, documentSection, documentKind)
      toast.success(`${file.name} uploaded successfully`)
      return
    }
    setCandidateId('')
    setPendingUpload({ file, source, documentSection, documentKind })
  }

  function closeUploadModal() {
    if (uploading) return
    setPendingUpload(null)
    setCandidateId('')
  }

  async function confirmSupabaseUpload(event) {
    event.preventDefault()
    const normalizedCandidateId = candidateId.trim()
    if (!pendingUpload) return
    if (!normalizedCandidateId) return toast.error('Candidate ID is required')

    setUploading(true)
    try {
      await uploadDocument(
        pendingUpload.file,
        normalizedCandidateId,
        pendingUpload.documentSection?.type || 'Resume/CV',
        pendingUpload.source,
      )
      const uploadedFileName = pendingUpload.file.name
      setPendingUpload(null)
      setCandidateId('')
      await loadCVData({ showLoading: false })
      toast.success(`${uploadedFileName} uploaded successfully`)
    } catch (error) {
      toast.error(error?.message || 'Failed to upload CV')
    } finally {
      setUploading(false)
    }
  }

  function handleToggleDraft(id) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleToggleAll() {
    setSelectedIds((current) => {
      const allSelected = draftIds.length > 0 && draftIds.every((id) => current.has(id))
      return allSelected ? new Set() : new Set(draftIds)
    })
  }

  // The CV Builder pre-fills from a candidate handed over in route state, so a
  // draft's name is enough to reopen it there.
  function handleEditDraft(draft) {
    if (!draft) return navigate('/cv-builder')
    navigate('/cv-builder', { state: { candidate: { id: draft.id, name: draft.name } } })
  }

  /**
   * Save a record to disk.
   *
   * Returns 'file' when the real document was saved, 'details' when the record
   * has no stored file and its metadata was saved instead, and 'failed' when
   * nothing could be saved.
   */
  async function downloadRecord(record, label) {
    const fileName = record.file_name || record.fileName || `${baseFileName(record.name) || 'document'}.pdf`
    try {
      if (!isSupabaseConfigured && record.demoFile) {
        triggerBlobDownload(record.demoFile, fileName)
        return 'file'
      }
      const filePath = record.file_path || record.filePath
      if (isSupabaseConfigured && filePath) {
        await downloadDocument(filePath, fileName)
        return 'file'
      }
      triggerTextDownload(record)
      return 'details'
    } catch (error) {
      toast.error(error?.message || `Failed to download ${label.toLowerCase()}`)
      return 'failed'
    }
  }

  async function downloadOne(record, label) {
    const outcome = await downloadRecord(record, label)
    if (outcome === 'details') {
      toast.info(`This ${label.toLowerCase()} has no stored file, so its details were downloaded instead.`)
    }
    return outcome
  }

  function handleDownloadDraft(draft) {
    return downloadOne(draft, 'CV draft')
  }

  function handleDocumentDownload(record, kind = 'medical') {
    return downloadOne(record, kindLabel(kind))
  }

  async function downloadMany(records, label) {
    const outcomes = []
    for (const record of records) {
      // Sequential so the browser does not drop back-to-back downloads.
      // eslint-disable-next-line no-await-in-loop
      outcomes.push(await downloadRecord(record, label))
    }
    const failed = outcomes.filter((outcome) => outcome === 'failed').length
    if (failed > 0) {
      toast.error(`${failed} of ${records.length} downloads failed`)
      return
    }
    const detailsOnly = outcomes.filter((outcome) => outcome === 'details').length
    toast.success(
      detailsOnly === 0
        ? `${records.length} ${label.toLowerCase()}(s) downloaded`
        : `${records.length} ${label.toLowerCase()}(s) downloaded — ${detailsOnly} had no stored file, so their details were saved instead`,
    )
  }

  function removeSelectionIds(kind, removedIds) {
    const setSelected = setSelectedByKind[kind]
    if (!setSelected) return
    setSelected((current) => Object.fromEntries(Object.entries(current).map(([sectionId, ids]) => [
      sectionId,
      new Set([...ids].filter((id) => !removedIds.has(id))),
    ])))
  }

  function forgetPreview(removedIds) {
    setPreviewRecord((current) => (current && removedIds.has(current.id) ? null : current))
    setEditRecord((current) => (current && removedIds.has(current.id) ? null : current))
  }

  async function deleteDrafts(targets) {
    const removedIds = new Set(targets.map((draft) => draft.id))
    const noun = targets.length === 1 ? 'CV draft' : `${targets.length} CV drafts`

    if (!isSupabaseConfigured) {
      setDrafts((current) => current.filter((draft) => !removedIds.has(draft.id)))
      setSelectedIds((current) => new Set([...current].filter((id) => !removedIds.has(id))))
      forgetPreview(removedIds)
      toast.success(`${noun} deleted`)
      return
    }

    try {
      const results = await Promise.allSettled(targets.map((draft) => deleteCVDraft(draft.id)))
      const failed = results.filter((result) => result.status === 'rejected').length
      forgetPreview(removedIds)
      await loadCVData({ showLoading: false })
      if (failed > 0) toast.error(`${failed} of ${targets.length} CV drafts could not be deleted`)
      else toast.success(`${noun} deleted`)
    } catch (error) {
      toast.error(error?.message || 'Failed to delete CV draft')
    }
  }

  async function deleteDocuments(targets, kind) {
    const label = kindLabel(kind)
    let deleted = targets
    let failed = 0

    if (isSupabaseConfigured) {
      const results = await Promise.allSettled(targets.map((record) => deleteDocument(record.id, record.file_path)))
      // Only drop the rows the backend actually removed, so a failed delete
      // stays visible instead of silently disappearing from the list.
      deleted = targets.filter((_, index) => results[index].status === 'fulfilled')
      failed = targets.length - deleted.length
    }

    const removedIds = new Set(deleted.map((record) => record.id))
    if (removedIds.size > 0) {
      setDocumentsByKind[kind]((current) => current.filter((record) => !removedIds.has(record.id)))
      removeSelectionIds(kind, removedIds)
      forgetPreview(removedIds)
    }

    if (failed > 0) {
      toast.error(`${failed} of ${targets.length} ${label.toLowerCase()}s could not be deleted`)
      return
    }
    toast.success(deleted.length === 1 ? `${label} deleted` : `${deleted.length} ${label.toLowerCase()}s deleted`)
  }

  function closeConfirm() {
    if (confirmBusy) return
    setConfirmState(null)
  }

  async function runConfirm() {
    if (!confirmState || confirmBusy) return
    setConfirmBusy(true)
    try {
      await confirmState.run()
    } catch (error) {
      toast.error(error?.message || 'The action could not be completed')
    } finally {
      setConfirmBusy(false)
      setConfirmState(null)
    }
  }

  function requestDeleteDraft(draft) {
    setConfirmState({
      title: 'Delete CV Draft',
      message: <>Are you sure you want to delete the CV draft for <span className="font-bold text-text-primary">{draft.name}</span>? This cannot be undone.</>,
      confirmLabel: 'Delete Draft',
      run: () => deleteDrafts([draft]),
    })
  }

  function requestDeleteSelectedDrafts() {
    const targets = drafts.filter((draft) => selectedIds.has(draft.id))
    if (!targets.length) return
    setConfirmState({
      title: 'Delete Selected CV Drafts',
      message: <>Are you sure you want to delete <span className="font-bold text-text-primary">{targets.length} selected CV draft(s)</span>? This cannot be undone.</>,
      confirmLabel: `Delete ${targets.length} Draft(s)`,
      run: () => deleteDrafts(targets),
    })
  }

  function requestClearDrafts() {
    if (clearing) return
    if (drafts.length === 0) return toast.info('There are no CV drafts to clear.')
    setConfirmState({
      title: 'Clear All CV Drafts',
      message: <>Are you sure you want to clear all <span className="font-bold text-text-primary">{drafts.length} CV draft(s)</span>? This action cannot be undone.</>,
      confirmLabel: 'Clear All Drafts',
      run: async () => {
        setClearing(true)
        try {
          await deleteDrafts(drafts)
        } finally {
          setClearing(false)
        }
      },
    })
  }

  function requestDeleteDocument(record, kind = 'medical') {
    setConfirmState({
      title: `Delete ${kindLabel(kind)}`,
      message: <>Are you sure you want to delete <span className="font-bold text-text-primary">{record.file_name || record.name}</span>? This cannot be undone.</>,
      confirmLabel: 'Delete',
      run: () => deleteDocuments([record], kind),
    })
  }

  function sectionSelection(kind, sectionId) {
    const selected = selectedByKind[kind]?.[sectionId]
    if (!selected || selected.size === 0) return []
    return documentsByKind[kind].filter((record) => record.section === sectionId && selected.has(record.id))
  }

  function requestDeleteSelectedDocuments(kind, sectionId) {
    const targets = sectionSelection(kind, sectionId)
    if (!targets.length) return
    const label = kindLabel(kind).toLowerCase()
    setConfirmState({
      title: `Delete Selected ${kindLabel(kind)}s`,
      message: <>Are you sure you want to delete <span className="font-bold text-text-primary">{targets.length} selected {label}(s)</span>? This cannot be undone.</>,
      confirmLabel: `Delete ${targets.length} File(s)`,
      run: () => deleteDocuments(targets, kind),
    })
  }

  function downloadSelectedDocuments(kind, sectionId) {
    const targets = sectionSelection(kind, sectionId)
    if (!targets.length) return
    return downloadMany(targets, kindLabel(kind))
  }

  function downloadSelectedDrafts() {
    const targets = drafts.filter((draft) => selectedIds.has(draft.id))
    if (!targets.length) return
    return downloadMany(targets, 'CV draft')
  }

  const medicalBySection = useMemo(() => Object.fromEntries(MEDICAL_SECTIONS.map((section) => [
    section.id,
    medicalDocuments.filter((record) => record.section === section.id),
  ])), [medicalDocuments])
  const contractsBySection = useMemo(() => Object.fromEntries(CONTRACT_SECTIONS.map((section) => [
    section.id,
    contractDocuments.filter((record) => record.section === section.id),
  ])), [contractDocuments])
  const licensesBySection = useMemo(() => Object.fromEntries(LICENSE_SECTIONS.map((section) => [
    section.id,
    licenseDocuments.filter((record) => record.section === section.id),
  ])), [licenseDocuments])
  const marketingBySection = useMemo(() => Object.fromEntries(MARKETING_SECTIONS.map((section) => [
    section.id,
    marketingDocuments.filter((record) => record.section === section.id),
  ])), [marketingDocuments])
  const reportsBySection = useMemo(() => Object.fromEntries(REPORT_SECTIONS.map((section) => [
    section.id,
    reportDocuments.filter((record) => record.section === section.id),
  ])), [reportDocuments])

  const documentsBySectionByKind = {
    medical: medicalBySection,
    contract: contractsBySection,
    license: licensesBySection,
    marketing: marketingBySection,
    report: reportsBySection,
  }

  function toggleDocument(kind, sectionId, id) {
    setSelectedByKind[kind]((current) => {
      const next = new Set(current[sectionId])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ...current, [sectionId]: next }
    })
  }

  function toggleAllDocuments(kind, sectionId) {
    const ids = (documentsBySectionByKind[kind][sectionId] || []).map((record) => record.id)
    setSelectedByKind[kind]((current) => ({
      ...current,
      [sectionId]: ids.length > 0 && ids.every((id) => current[sectionId].has(id)) ? new Set() : new Set(ids),
    }))
  }

  function beginDocumentEdit(record, documentKind = 'medical') {
    setEditRecord({ ...record, documentKind })
    setEditDescription(record.description || '')
  }

  async function saveDocumentEdit(event) {
    event.preventDefault()
    if (!editRecord) return
    const description = editDescription.trim()
    if (!description) return toast.error('Description is required')
    const kind = editRecord.documentKind
    const label = kindLabel(kind)

    try {
      if (isSupabaseConfigured) await updateDocument(editRecord.id, { description })
      setDocumentsByKind[kind]((current) => current.map((record) => (
        record.id === editRecord.id ? { ...record, description } : record
      )))
      setPreviewRecord((current) => (current?.id === editRecord.id ? { ...current, description } : current))
      setEditRecord(null)
      toast.success(`${label} updated`)
    } catch (error) {
      toast.error(error?.message || `Failed to update ${label.toLowerCase()}`)
    }
  }

  const panelHandlers = (kind) => ({
    documentsBySection: documentsBySectionByKind[kind],
    selectedBySection: selectedByKind[kind],
    onToggle: (sectionId, id) => toggleDocument(kind, sectionId, id),
    onToggleAll: (sectionId) => toggleAllDocuments(kind, sectionId),
    onUpload: (file, section, source) => handleUpload(file, source, section, kind),
    onPreview: setPreviewRecord,
    onEdit: (record) => beginDocumentEdit(record, kind),
    onDownload: (record) => handleDocumentDownload(record, kind),
    onDelete: (record) => requestDeleteDocument(record, kind),
    onDownloadSelected: (sectionId) => downloadSelectedDocuments(kind, sectionId),
    onDeleteSelected: (sectionId) => requestDeleteSelectedDocuments(kind, sectionId),
  })

  const cvSectionHandlers = (kind) => ({
    onPreview: setPreviewRecord,
    onEdit: (record) => beginDocumentEdit(record, kind),
    onDownload: (record) => handleDocumentDownload(record, kind),
    onDelete: (record) => requestDeleteDocument(record, kind),
  })

  const previewTitle = previewRecord?.title || previewRecord?.file_name || previewRecord?.name || 'Document Preview'
  const uploadModalTitle = pendingUpload?.documentKind
    ? `Link ${kindLabel(pendingUpload.documentKind).toLowerCase()} to candidate`
    : 'Link CV to candidate'

  return (
    <Layout title="Admin Dashboard">
      <div id="documents-cvs-page" className="mx-auto max-w-[1190px] animate-fade-in px-2 pb-8 pt-6 sm:px-4 lg:px-6">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-primary">Documents</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Manage contracts, licenses, certifications, and other important documents
          </p>
        </header>
        <DocumentsTabs activeTab={activeTab} onChange={handleTabChange} />

        {activeTab === 'medical-reports' && <MedicalReportsPanel {...panelHandlers('medical')} />}
        {activeTab === 'contracts' && <ContractsPanel {...panelHandlers('contract')} />}
        {activeTab === 'licenses-certifications' && <LicensesCertificationsPanel {...panelHandlers('license')} />}
        {activeTab === 'adverts-marketing' && <AdvertsMarketingPanel {...panelHandlers('marketing')} />}
        {activeTab === 'reports' && <ReportsPanel {...panelHandlers('report')} />}

        {activeTab === 'cvs' && (
        <div className="mt-6 space-y-6">
          <CVIntegrationBanner onClear={requestClearDrafts} disabled={clearing} />
          {loading && (
            <div role="status" className="flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-text-secondary">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
              Loading CV documents…
            </div>
          )}
          <CVDocumentSection
            id="cv-builder-cvs"
            icon={FileText}
            title="CV Builder CVs"
            subtitle="CVs created and saved from the CV Builder application"
            documents={builderCVs}
            onUpload={(file) => handleUpload(file, 'cv-builder')}
            onCamera={(file) => handleUpload(file, 'cv-builder')}
            {...cvSectionHandlers('builder-cv')}
          />
          <CVDocumentSection
            id="uploaded-cvs"
            icon={Upload}
            title="Uploaded CVs"
            subtitle="CVs uploaded manually by users"
            documents={uploadedCVs}
            onUpload={(file) => handleUpload(file, 'manual')}
            onCamera={(file) => handleUpload(file, 'manual')}
            {...cvSectionHandlers('uploaded-cv')}
          />
          <CVDraftsSection
            drafts={drafts}
            selectedIds={selectedIds}
            onToggle={handleToggleDraft}
            onToggleAll={handleToggleAll}
            onUpload={(file) => handleUpload(file, 'draft')}
            onCamera={(file) => handleUpload(file, 'draft')}
            onPreview={setPreviewRecord}
            onEdit={handleEditDraft}
            onDownload={handleDownloadDraft}
            onDelete={requestDeleteDraft}
            onDownloadSelected={downloadSelectedDrafts}
            onDeleteSelected={requestDeleteSelectedDrafts}
          />
        </div>
        )}

        <Modal isOpen={Boolean(previewRecord)} onClose={() => setPreviewRecord(null)} title={previewTitle}>
          <DocumentPreview record={previewRecord} />
        </Modal>

        <Modal isOpen={Boolean(editRecord)} onClose={() => setEditRecord(null)} title={`Edit ${kindLabel(editRecord?.documentKind).toLowerCase()}`} size="sm">
          <form onSubmit={saveDocumentEdit} className="space-y-4">
            <p className="text-sm text-text-secondary">
              Update the description shown for <span className="font-medium text-text-primary">{editRecord?.file_name || editRecord?.name}</span>.
            </p>
            <div>
              <label htmlFor="document-description" className="mb-1 block text-sm font-medium text-text-secondary">Description</label>
              <textarea
                id="document-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                rows={4}
                autoFocus
                className="w-full rounded-lg border border-cream px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-cream pt-4">
              <button type="button" onClick={() => setEditRecord(null)} className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-cream">Cancel</button>
              <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover">Save changes</button>
            </div>
          </form>
        </Modal>

        <Modal isOpen={Boolean(confirmState)} onClose={closeConfirm} title={confirmState?.title || 'Confirm'} size="sm">
          <p className="text-sm text-text-secondary">{confirmState?.message}</p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeConfirm}
              disabled={confirmBusy}
              className="rounded-full border border-cream bg-white px-4 py-2 text-[13px] font-medium text-text-primary transition-colors hover:bg-cream-warm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={runConfirm}
              disabled={confirmBusy}
              className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirmBusy ? 'Working…' : confirmState?.confirmLabel || 'Delete'}
            </button>
          </div>
        </Modal>

        <Modal isOpen={Boolean(pendingUpload)} onClose={closeUploadModal} title={uploadModalTitle} size="sm">
          <form onSubmit={confirmSupabaseUpload} className="space-y-4">
            <p className="text-sm text-text-secondary">
              Enter the candidate ID before uploading <span className="font-medium text-text-primary">{pendingUpload?.file.name}</span>.
            </p>
            <div>
              <label htmlFor="upload-candidate-id" className="mb-1 block text-sm font-medium text-text-secondary">Candidate ID</label>
              <input
                id="upload-candidate-id"
                value={candidateId}
                onChange={(event) => setCandidateId(event.target.value)}
                autoComplete="off"
                autoFocus
                disabled={uploading}
                className="w-full rounded-lg border border-cream bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-cream pt-4">
              <button type="button" onClick={closeUploadModal} disabled={uploading} className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary hover:bg-cream disabled:opacity-50">Cancel</button>
              <button type="submit" disabled={uploading} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50">
                {uploading ? 'Uploading…' : pendingUpload?.documentSection ? 'Upload Document' : 'Upload CV'}
              </button>
            </div>
          </form>
        </Modal>
      </div>
    </Layout>
  )
}
