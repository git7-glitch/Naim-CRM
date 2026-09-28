import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useSearchQueryParam from '../hooks/useSearchQueryParam'
import Layout from '../components/layout/Layout'
import Modal from '../components/ui/Modal'
import { PageSpinner } from '../components/ui/Spinner'
import CandidateForm from '../components/candidates/CandidateForm'
import CandidateEditForm from '../components/candidates/CandidateEditForm'
import StatusDropdown, { CANDIDATE_STATUSES } from '../components/candidates/StatusDropdown'
import { isSupabaseConfigured } from '../supabase/client'
import {
  getCandidates,
  updateCandidate,
  deleteCandidate,
  bulkUpdateCandidates,
  bulkDeleteCandidates,
  autoDeleteCompletedCandidates,
  clearAllCandidates,
  countActiveCandidates,
} from '../services/candidateService'
import { syncStandardCandidateData, syncStandardDemoData } from '../services/candidateSyncService'
import { addLocalRecycleBinItems } from '../services/recycleBinService'
import { demoCandidatesList } from '../services/demoData'
import { exportToCSV, exportToExcel, exportToPDF } from '../utils/exportUtils'
import { TERMINAL_STAGES } from '../utils/constants'
import { useToast } from '../contexts/ToastContext'
import {
  Users, Plus, Search, ChevronDown, ChevronUp, UserRound, FilePenLine,
  Trash2, FileText, FileSpreadsheet, FileDown, RefreshCw, Settings, TriangleAlert
} from 'lucide-react'

const STAGE_OPTIONS = CANDIDATE_STATUSES.map((status) => status.label)
const AUTO_DELETE_STORAGE_KEY = 'candidates:autoDeleteSettings'
const AUTO_DELETE_DURATIONS = [
  { value: '7', label: '7 days (1 week)' },
  { value: '30', label: '30 days (1 month)' },
  { value: '60', label: '60 days (2 months)' },
  { value: '90', label: '90 days (3 months)' },
]
// CRM-6: canonical terminal stages (Completed, Rejected, Withdrawn).
const COMPLETED_STAGES = new Set(TERMINAL_STAGES)
const PAGE_SIZE = 10

function getStoredAutoDeleteSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(AUTO_DELETE_STORAGE_KEY))
    const days = AUTO_DELETE_DURATIONS.some((duration) => duration.value === stored?.days) ? stored.days : '30'
    // Auto-deletion stays off until the user ticks the box and runs it, which is
    // what the green dot on the Auto-Delete button reports.
    return { enabled: stored?.enabled === true, days }
  } catch {
    return { enabled: false, days: '30' }
  }
}

function BulkStageDropdown({ onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Update Stage"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        className="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-text-primary shadow-sm transition-colors hover:bg-gray-50"
      >
        Update Stage
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Bulk stage options"
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-44 overflow-y-auto border border-gray-100 bg-white py-0.5 shadow-[0_8px_18px_rgba(0,0,0,0.10)] animate-scale-in"
        >
          {CANDIDATE_STATUSES.map((status) => (
            <button
              key={status.label}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(status.label)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 bg-white px-3 py-2 text-left text-[13px] text-gray-900 transition-colors hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
            >
              <span data-status-dot className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
              {status.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function CandidatesPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [candidates, setCandidates] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useSearchQueryParam()
  const [stageFilter, setStageFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState([])
  const [expandedId, setExpandedId] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editCandidate, setEditCandidate] = useState(null)
  const [viewCandidate, setViewCandidate] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [showAutoDelete, setShowAutoDelete] = useState(false)
  const [autoDeleteSettings, setAutoDeleteSettings] = useState(getStoredAutoDeleteSettings)
  const [autoDeleteDraft, setAutoDeleteDraft] = useState(getStoredAutoDeleteSettings)
  const [autoDeleteBusy, setAutoDeleteBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [clearTarget, setClearTarget] = useState(null)
  const [clearing, setClearing] = useState(false)
  const autoSweptRef = useRef(false)

  const loadCandidates = useCallback(async () => {
    setLoading(true)
    setSelectedIds([])
    setShowBulkDelete(false)
    try {
      if (!isSupabaseConfigured) {
        // Demo mode — filter/paginate the local demo dataset
        let list = demoCandidatesList.filter((c) => !c.deleted_at)
        if (search) {
          const q = search.toLowerCase()
          list = list.filter((c) =>
            c.name.toLowerCase().includes(q) ||
            (c.email || '').toLowerCase().includes(q) ||
            (c.country || '').toLowerCase().includes(q) ||
            (c.phone || '').includes(q)
          )
        }
        if (stageFilter) list = list.filter((c) => c.stage === stageFilter)
        setTotal(list.length)
        setCandidates(list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE))
      } else {
        const result = await getCandidates({ search, stage: stageFilter, page, pageSize: PAGE_SIZE })
        setCandidates(result.data || [])
        setTotal(result.count || 0)
      }
    } catch {
      toast.error('Failed to load candidates')
    } finally {
      setLoading(false)
    }
  }, [page, search, stageFilter, toast])

  useEffect(() => {
    loadCandidates()
  }, [loadCandidates])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]))
  }

  const allOnPageSelected = candidates.length > 0 && candidates.every((candidate) => selectedIds.includes(candidate.id))

  function toggleSelectAll() {
    setSelectedIds(allOnPageSelected ? [] : candidates.map((candidate) => candidate.id))
  }

  async function handleBulkStageChange(newStage) {
    const ids = [...selectedIds]
    if (!ids.length) return

    const previousCandidates = candidates
    setCandidates((currentCandidates) => currentCandidates.map((candidate) => (
      ids.includes(candidate.id) ? { ...candidate, stage: newStage, status: newStage } : candidate
    )))

    if (isSupabaseConfigured) {
      try {
        await bulkUpdateCandidates(ids, { stage: newStage, status: newStage })
      } catch {
        setCandidates(previousCandidates)
        toast.error('Failed to update selected candidates')
        return
      }
    } else {
      demoCandidatesList.forEach((candidate) => {
        if (ids.includes(candidate.id)) {
          candidate.stage = newStage
          candidate.status = newStage
        }
      })
    }

    setSelectedIds([])
    toast.success(`Updated ${ids.length} candidates to ${newStage}`)
  }

  async function confirmBulkDelete() {
    const ids = [...selectedIds]
    if (!ids.length) return

    if (isSupabaseConfigured) {
      try {
        await bulkDeleteCandidates(ids)
      } catch {
        toast.error('Failed to delete selected candidates')
        return
      }
    } else {
      const deletedAt = new Date().toISOString()
      const removed = demoCandidatesList.filter((candidate) => ids.includes(candidate.id))
      removed.forEach((candidate) => { candidate.deleted_at = deletedAt })
      addLocalRecycleBinItems(removed)
    }

    setShowBulkDelete(false)
    setSelectedIds([])
    toast.success(`${ids.length} candidates moved to Recycle Bin`)
    loadCandidates()
  }

  function openAutoDeleteSettings() {
    setAutoDeleteDraft(autoDeleteSettings)
    setShowAutoDelete(true)
  }

  // Moves completed candidates whose last activity predates the retention
  // window into the Recycle Bin, and reports how many were removed.
  const sweepCompletedCandidates = useCallback(async (settings) => {
    const cutoff = new Date(Date.now() - Number(settings.days) * 86400000).toISOString()
    if (isSupabaseConfigured) return autoDeleteCompletedCandidates(cutoff)

    const deletedAt = new Date().toISOString()
    const expired = demoCandidatesList.filter((candidate) => {
      const activityDate = candidate.updated_at || candidate.created_at
      return !candidate.deleted_at && COMPLETED_STAGES.has(candidate.stage) && activityDate && activityDate < cutoff
    })
    expired.forEach((candidate) => { candidate.deleted_at = deletedAt })
    addLocalRecycleBinItems(expired)
    return expired.length
  }, [])

  async function executeAutoDelete() {
    const settings = { ...autoDeleteDraft }
    setAutoDeleteBusy(true)
    try {
      localStorage.setItem(AUTO_DELETE_STORAGE_KEY, JSON.stringify(settings))
      setAutoDeleteSettings(settings)
      autoSweptRef.current = true

      if (!settings.enabled) {
        setShowAutoDelete(false)
        toast.success('Candidate auto-deletion disabled')
        return
      }

      const deletedCount = await sweepCompletedCandidates(settings)
      setShowAutoDelete(false)
      await loadCandidates()
      toast.success(deletedCount
        ? `Auto-deletion active — ${deletedCount} completed candidate(s) moved to Recycle Bin`
        : `Auto-deletion active — no completed candidate is older than ${settings.days} days yet`)
    } catch {
      toast.error('Failed to execute candidate auto-deletion')
    } finally {
      setAutoDeleteBusy(false)
    }
  }

  // While the setting is on the sweep also runs when the page opens, so
  // auto-deletion keeps working without the user re-running it by hand.
  useEffect(() => {
    if (autoSweptRef.current || !autoDeleteSettings.enabled) return
    autoSweptRef.current = true
    sweepCompletedCandidates(autoDeleteSettings)
      .then((deletedCount) => {
        if (!deletedCount) return
        toast.success(`Auto-delete removed ${deletedCount} completed candidate(s)`)
        loadCandidates()
      })
      .catch(() => toast.error('Auto-delete sweep failed'))
  }, [autoDeleteSettings, loadCandidates, sweepCompletedCandidates, toast])

  async function handleSyncStandardData() {
    setSyncing(true)
    try {
      const result = isSupabaseConfigured
        ? await syncStandardCandidateData()
        : syncStandardDemoData(demoCandidatesList)
      await loadCandidates()
      toast.success(result.standardized
        ? `Standard data synced — ${result.standardized} of ${result.checked} candidate record(s) updated`
        : `Standard data synced — all ${result.checked} candidate record(s) already standard`)
    } catch {
      toast.error('Failed to sync standard data')
    } finally {
      setSyncing(false)
    }
  }

  async function openClearData() {
    try {
      const count = isSupabaseConfigured
        ? await countActiveCandidates()
        : demoCandidatesList.filter((candidate) => !candidate.deleted_at).length
      if (!count) return toast.error('There are no candidate records to clear')
      setClearTarget(count)
    } catch {
      toast.error('Failed to read candidate records')
    }
  }

  async function confirmClearData() {
    setClearing(true)
    try {
      let cleared = 0
      if (isSupabaseConfigured) {
        cleared = await clearAllCandidates()
      } else {
        const deletedAt = new Date().toISOString()
        const live = demoCandidatesList.filter((candidate) => !candidate.deleted_at)
        live.forEach((candidate) => { candidate.deleted_at = deletedAt })
        addLocalRecycleBinItems(live)
        cleared = live.length
      }
      setClearTarget(null)
      setExpandedId(null)
      setPage(1)
      await loadCandidates()
      toast.success(`${cleared} candidate record(s) cleared and moved to the Recycle Bin`)
    } catch {
      toast.error('Failed to clear Supabase candidate data')
    } finally {
      setClearing(false)
    }
  }

  async function handleStatusChange(id, newStage) {
    setCandidates((prev) => prev.map((c) => (c.id === id ? { ...c, stage: newStage, status: newStage } : c)))
    const demo = demoCandidatesList.find((c) => c.id === id)
    if (demo) { demo.stage = newStage; demo.status = newStage }
    if (isSupabaseConfigured) {
      try {
        await updateCandidate(id, { stage: newStage, status: newStage })
        toast.success(`Status updated to ${newStage}`)
      } catch {
        toast.error('Failed to update status')
      }
    } else {
      toast.success(`Status updated to ${newStage}`)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    if (isSupabaseConfigured) {
      try {
        await deleteCandidate(deleteTarget.id)
      } catch {
        toast.error('Failed to delete candidate')
        setDeleteTarget(null)
        return
      }
    } else {
      const demo = demoCandidatesList.find((c) => c.id === deleteTarget.id)
      if (demo) {
        demo.deleted_at = new Date().toISOString()
        addLocalRecycleBinItems(demo)
      }
    }
    toast.success('Candidate moved to Recycle Bin')
    setDeleteTarget(null)
    loadCandidates()
  }

  function exportRows(source) {
    return source.map((candidate) => ({
      Name: candidate.name,
      Phone: candidate.phone || '',
      Email: candidate.email || '',
      Emergency: candidate.emergency_contact || 'N/A',
      Stage: candidate.stage || '',
      Salary: candidate.salary || 'N/A',
      Position: candidate.position || candidate.job_title || 'N/A',
      Departure: candidate.departure || 'Not set',
      Company: candidate.company || candidate.work_company || 'N/A',
      Country: candidate.country || 'N/A',
    }))
  }

  function handleExport(type, selectedOnly = false) {
    const source = selectedOnly
      ? candidates.filter((candidate) => selectedIds.includes(candidate.id))
      : isSupabaseConfigured
        ? candidates
        : demoCandidatesList.filter((candidate) => !candidate.deleted_at)
    const rows = exportRows(source)
    if (!rows.length) return toast.error('No candidates to export')

    const basename = selectedOnly ? 'selected-candidates' : 'candidates'
    if (type === 'csv') exportToCSV(rows, `${basename}.csv`)
    if (type === 'excel') exportToExcel(rows, `${basename}.xlsx`)
    if (type === 'pdf') exportToPDF(rows, selectedOnly ? 'Selected Candidates' : 'All Candidates', `${basename}.pdf`)
    toast.success(`Exported ${rows.length} candidates to ${type.toUpperCase()}`)
  }

  const DetailField = ({ label, value, valueClass = 'text-text-primary' }) => (
    <div className="mb-2.5">
      <span className="text-[13px] text-text-secondary">{label}: </span>
      <span className={`text-[13px] ${valueClass}`}>{value}</span>
    </div>
  )

  return (
    <Layout title="Admin Dashboard">
      <div className="animate-fade-in">
        {/* ── Page header ─────────────────────────────── */}
        <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-primary">Candidates</h1>
            <p className="mt-1 max-w-xs text-[13px] leading-snug text-text-secondary">
              Manage and track all candidates in your recruitment pipeline
            </p>
          </div>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
            <div className="flex flex-col items-start gap-2">
              <button
                type="button"
                onClick={handleSyncStandardData}
                disabled={syncing}
                className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-primary-hover transition-colors disabled:cursor-not-allowed disabled:opacity-70"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                {syncing ? 'Syncing…' : 'Sync Standard Data'}
              </button>
              <button
                type="button"
                onClick={openAutoDeleteSettings}
                title={autoDeleteSettings.enabled ? 'Auto-deletion is active' : 'Auto-deletion is off'}
                className="flex items-center gap-2 rounded-full border border-cream bg-white px-4 py-2 text-[13px] font-medium text-primary shadow-sm hover:bg-cream-warm transition-colors"
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                Auto-Delete
                {autoDeleteSettings.enabled && (
                  <>
                    <span data-testid="auto-delete-active" className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
                    <span className="sr-only">(active)</span>
                  </>
                )}
              </button>
            </div>
            <button
              type="button"
              onClick={openClearData}
              className="flex items-center gap-2 rounded-full border border-red-200 bg-white px-4 py-2 text-[13px] font-medium text-red-600 shadow-sm hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Clear Supabase
            </button>
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-text-secondary">Export All:</span>
              <button onClick={() => handleExport('pdf')} className="flex items-center gap-1.5 rounded-full border border-cream bg-white px-3.5 py-2 text-[13px] font-medium text-primary shadow-sm hover:bg-cream-warm transition-colors">
                <FileText className="h-4 w-4" /> PDF
              </button>
              <button onClick={() => handleExport('excel')} className="flex items-center gap-1.5 rounded-full border border-cream bg-white px-3.5 py-2 text-[13px] font-medium text-primary shadow-sm hover:bg-cream-warm transition-colors">
                <FileSpreadsheet className="h-4 w-4" /> Excel
              </button>
              <button onClick={() => handleExport('csv')} className="flex items-center gap-1.5 rounded-full border border-cream bg-white px-3.5 py-2 text-[13px] font-medium text-primary shadow-sm hover:bg-cream-warm transition-colors">
                <FileDown className="h-4 w-4" /> CSV
              </button>
            </div>
          </div>
        </header>

        {/* ── All Candidates card ─────────────────────── */}
        <section id="all-candidates" className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h2 className="flex items-center gap-2 text-base font-bold text-primary">
              <Users className="h-5 w-5" />
              All Candidates
            </h2>
            <button
              type="button"
              onClick={() => navigate('/cv-builder')}
              className="flex items-center gap-1.5 rounded-full border border-cream bg-white px-4 py-1.5 text-[13px] font-semibold text-primary shadow-sm hover:bg-cream-warm transition-colors"
            >
              <Plus className="h-4 w-4" /> Add Candidate
            </button>
            <div className="relative flex-1 md:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                id="candidates-search"
                type="text"
                aria-label="Search candidates"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search names, emails, countries, passports..."
                className="h-9 w-full rounded-full border border-gray-200 bg-white pl-9 pr-3 text-[13px] text-text-primary placeholder-gray-400 outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="relative">
              <select
                aria-label="Filter by stage"
                value={stageFilter}
                onChange={(e) => { setStageFilter(e.target.value); setPage(1) }}
                className="h-9 appearance-none rounded-lg border-none bg-transparent pr-7 pl-2 text-[13px] font-medium text-text-primary outline-none cursor-pointer"
              >
                <option value="">All Stages</option>
                {STAGE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-primary" />
            </div>
          </div>

          {/* Select all */}
          <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={allOnPageSelected}
              onChange={toggleSelectAll}
              className="h-3.5 w-3.5 rounded border-gray-300 accent-primary"
            />
            Select All on Page
          </label>

          {selectedIds.length > 0 && (
            <div
              role="region"
              aria-label="Candidate bulk actions"
              className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[#eee8d8] bg-white px-3 py-2.5 shadow-sm animate-fade-in"
            >
              <p className="mr-auto min-w-fit text-[13px] font-semibold text-primary">
                {selectedIds.length} candidate(s) selected
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <BulkStageDropdown onChange={handleBulkStageChange} />
                <button
                  type="button"
                  aria-label="Export selected candidates to PDF"
                  onClick={() => handleExport('pdf', true)}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-gray-50"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" /> PDF
                </button>
                <button
                  type="button"
                  aria-label="Export selected candidates to Excel"
                  onClick={() => handleExport('excel', true)}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-gray-50"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" /> Excel
                </button>
                <button
                  type="button"
                  aria-label="Export selected candidates to CSV"
                  onClick={() => handleExport('csv', true)}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-xs font-medium text-primary shadow-sm transition-colors hover:bg-gray-50"
                >
                  <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> CSV
                </button>
                <button
                  type="button"
                  onClick={() => setShowBulkDelete(true)}
                  className="flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-600 shadow-sm transition-colors hover:bg-red-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete Selected
                </button>
              </div>
            </div>
          )}

          {/* ── Candidate rows ─────────────────────────── */}
          {loading ? (
            <PageSpinner />
          ) : (
            <div className="space-y-2.5">
              {candidates.map((c, i) => {
                const rowNum = (page - 1) * PAGE_SIZE + i + 1
                const expanded = expandedId === c.id
                return (
                  <article key={c.id} className="rounded-xl border border-gray-100 bg-white shadow-sm">
                    <div className="flex items-center gap-2.5 p-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.name}`}
                        checked={selectedIds.includes(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 accent-primary"
                      />
                      <span className="flex h-7 w-9 shrink-0 items-center justify-center rounded-md bg-gold-light/25 text-[13px] font-bold text-primary">
                        {rowNum}.
                      </span>
                      <div className="w-44 min-w-0 shrink-0">
                        <p className="truncate text-[13px] font-bold text-primary">{c.name}</p>
                        <p className="truncate text-[11px]">
                          <span className="text-emerald-600">{c.phone}</span>
                          <span className="mx-1 text-gray-300">•</span>
                          <span className="text-blue-600">{(c.email || '').split('@')[0].slice(0, 13)}@...</span>
                        </p>
                      </div>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-secondary">
                        <span>Emergency: <span className="font-medium text-text-primary">{c.emergency_contact || 'N/A'}</span></span>
                        <StatusDropdown value={c.stage} onChange={(s) => handleStatusChange(c.id, s)} size="xs" />
                        <span>Position: <span className="font-medium text-text-primary">{c.position || c.job_title || 'N/A'}</span></span>
                        <span>Departure: <span className="font-medium text-text-primary">{c.departure || 'Not set'}</span></span>
                        <span>Company: <span className="font-medium text-text-primary">{c.company || c.work_company || 'N/A'}</span></span>
                        <span>Salary: <span className="font-medium text-text-primary">{c.salary || 'N/A'}</span></span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => navigate('/cv-builder', { state: { candidate: c } })} title="Create/Edit CV" aria-label={`Create or edit CV for ${c.name}`} className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50 transition-colors">
                          <UserRound className="h-4 w-4" />
                        </button>
                        <button onClick={() => { setEditCandidate(c); setShowForm(true) }} title="Edit" aria-label={`Edit ${c.name}`} className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50 transition-colors">
                          <FilePenLine className="h-4 w-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(c)} title="Delete" aria-label={`Delete ${c.name}`} className="rounded-md p-1.5 text-red-500 hover:bg-red-50 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setExpandedId(expanded ? null : c.id)}
                          title={expanded ? 'Collapse' : 'Expand'}
                          aria-label={expanded ? `Collapse ${c.name}` : `Expand ${c.name}`}
                          aria-expanded={expanded}
                          className="rounded-md p-1.5 text-gray-400 hover:bg-cream-warm hover:text-primary transition-colors"
                        >
                          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* ── Expanded details panel ──────────── */}
                    {expanded && (
                      <div className="mx-3 mb-3 rounded-xl border border-gray-100 bg-white p-5 shadow-sm animate-fade-in">
                        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                          <div>
                            <h3 className="mb-3 text-[13px] font-bold text-primary">Contact Information</h3>
                            <DetailField label="Email" value={c.email || 'N/A'} valueClass="text-blue-600" />
                            <DetailField label="Phone" value={c.phone || 'N/A'} valueClass="text-emerald-600" />
                            <DetailField label="Emergency Contact" value={c.emergency_contact || 'N/A'} />
                          </div>
                          <div>
                            <h3 className="mb-3 text-[13px] font-bold text-primary">Work Details</h3>
                            <DetailField label="Position" value={c.position || c.job_title || 'N/A'} />
                            <DetailField label="Company" value={c.company || c.work_company || 'N/A'} />
                            <DetailField label="City" value={c.city || 'N/A'} />
                            <DetailField label="Country" value={c.country || 'N/A'} />
                            <DetailField label="Salary" value={c.salary || 'N/A'} />
                          </div>
                          <div>
                            <h3 className="mb-3 text-[13px] font-bold text-primary">Additional Information</h3>
                            <div className="mb-2.5">
                              <span className="text-[13px] text-text-secondary">Stage: </span>
                              <div className="mt-1 inline-block">
                                <StatusDropdown value={c.stage} onChange={(s) => handleStatusChange(c.id, s)} size="xs" />
                              </div>
                            </div>
                            <DetailField label="Departure" value={c.departure || 'Not set'} />
                            <DetailField label="Added" value={c.added || (c.created_at ? new Date(c.created_at).toLocaleDateString('en-KE', { timeZone: 'Africa/Nairobi' }) : 'Not set')} />
                            <div>
                              <p className="text-[13px] text-text-secondary">Notes:</p>
                              <p className="mt-1 text-[13px] font-medium uppercase leading-relaxed text-text-primary">
                                {c.notes || '—'}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
              {candidates.length === 0 && (
                <p className="py-10 text-center text-sm text-text-muted">No candidates found</p>
              )}
            </div>
          )}

          {/* ── Pagination ─────────────────────────────── */}
          <footer className="mt-5 flex items-center justify-between">
            <p className="text-[13px] text-text-secondary">Page {page} of {totalPages}</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-full border border-cream bg-white px-5 py-2 text-[13px] font-medium text-primary shadow-sm hover:bg-cream-warm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-full border border-cream bg-white px-5 py-2 text-[13px] font-medium text-primary shadow-sm hover:bg-cream-warm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </footer>
        </section>
      </div>

      {/* ── Auto-delete settings modal ────────────────── */}
      <Modal
        isOpen={showAutoDelete}
        onClose={() => setShowAutoDelete(false)}
        title="Auto-Deletion Settings"
        size="md"
        className="max-w-md overflow-hidden"
      >
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 text-[13px] font-medium text-[#8b6200]">
            <input
              type="checkbox"
              checked={autoDeleteDraft.enabled}
              onChange={(event) => setAutoDeleteDraft((current) => ({ ...current, enabled: event.target.checked }))}
              className="h-4 w-4 accent-blue-600"
            />
            Enable auto-deletion for completed candidates
          </label>

          <label htmlFor="candidate-auto-delete-days" className="block text-[13px] font-semibold text-[#8b6200]">
            Delete after (days):
          </label>
          <select
            id="candidate-auto-delete-days"
            value={autoDeleteDraft.days}
            disabled={!autoDeleteDraft.enabled}
            onChange={(event) => setAutoDeleteDraft((current) => ({ ...current, days: event.target.value }))}
            className="-mt-2 h-12 w-full max-w-48 rounded-xl border-2 border-gray-900 bg-white px-4 text-base text-gray-900 outline-none transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {AUTO_DELETE_DURATIONS.map((duration) => (
              <option key={duration.value} value={duration.value}>{duration.label}</option>
            ))}
          </select>

          <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-3 text-amber-700">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-semibold">Auto-Deletion Policy</p>
              <p className="mt-1 text-xs leading-4">
                Candidates in a finished stage (Completed, Rejected, Withdrawn) move to the Recycle Bin after the specified number of days without updates. Placed candidates are never swept.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={() => setShowAutoDelete(false)}
              className="h-12 rounded-xl border-2 border-[#efe0c0] bg-white px-6 text-sm font-semibold text-[#8b6200] shadow-sm transition-colors hover:bg-cream-warm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={executeAutoDelete}
              disabled={autoDeleteBusy}
              className="flex h-12 items-center gap-2 rounded-xl bg-[#ca9000] px-6 text-sm font-semibold text-white shadow-md transition-colors hover:bg-[#b27f00] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {autoDeleteBusy ? 'Working…' : 'Execute Now'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Add / Edit modal ──────────────────────────── */}
      <Modal
        isOpen={showForm}
        onClose={() => { setShowForm(false); setEditCandidate(null) }}
        title={editCandidate ? 'Edit Candidate' : 'Add Candidate'}
        size={editCandidate ? 'lg' : 'xl'}
      >
        {editCandidate ? (
          <CandidateEditForm
            candidate={editCandidate}
            onSave={() => { setShowForm(false); setEditCandidate(null); loadCandidates() }}
            onCancel={() => { setShowForm(false); setEditCandidate(null) }}
          />
        ) : (
          <CandidateForm
            onSave={() => { setShowForm(false); loadCandidates() }}
            onCancel={() => setShowForm(false)}
          />
        )}
      </Modal>

      {/* ── View profile modal ────────────────────────── */}
      <Modal isOpen={!!viewCandidate} onClose={() => setViewCandidate(null)} title="Candidate Profile" size="lg">
        {viewCandidate && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-bold text-white">
                {viewCandidate.name?.charAt(0)}
              </div>
              <div>
                <p className="font-bold text-text-primary">{viewCandidate.name}</p>
                <StatusDropdown value={viewCandidate.stage} onChange={(s) => { handleStatusChange(viewCandidate.id, s); setViewCandidate({ ...viewCandidate, stage: s }) }} size="xs" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <p><span className="text-text-secondary">Email:</span> <span className="text-blue-600">{viewCandidate.email || 'N/A'}</span></p>
              <p><span className="text-text-secondary">Phone:</span> <span className="text-emerald-600">{viewCandidate.phone || 'N/A'}</span></p>
              <p><span className="text-text-secondary">Position:</span> {viewCandidate.position || 'N/A'}</p>
              <p><span className="text-text-secondary">Company:</span> {viewCandidate.company || 'N/A'}</p>
              <p><span className="text-text-secondary">Country:</span> {viewCandidate.country || 'N/A'}</p>
              <p><span className="text-text-secondary">Salary:</span> {viewCandidate.salary || 'N/A'}</p>
            </div>
            {viewCandidate.notes && (
              <div>
                <p className="text-sm text-text-secondary">Notes:</p>
                <p className="text-sm uppercase text-text-primary">{viewCandidate.notes}</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Delete confirm modal ──────────────────────── */}
      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Candidate" size="sm">
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete <span className="font-bold text-text-primary">{deleteTarget?.name}</span>? The candidate will be moved to the Recycle Bin.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setDeleteTarget(null)} className="rounded-full border border-cream bg-white px-4 py-2 text-[13px] font-medium text-text-primary hover:bg-cream-warm transition-colors">
            Cancel
          </button>
          <button onClick={confirmDelete} className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 transition-colors">
            Delete
          </button>
        </div>
      </Modal>

      {/* ── Bulk delete confirm modal ─────────────────── */}
      <Modal isOpen={showBulkDelete} onClose={() => setShowBulkDelete(false)} title="Delete Selected Candidates" size="sm">
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete <span className="font-bold text-text-primary">{selectedIds.length} selected candidates</span>? They will be moved to the Recycle Bin.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={() => setShowBulkDelete(false)} className="rounded-full border border-cream bg-white px-4 py-2 text-[13px] font-medium text-text-primary hover:bg-cream-warm transition-colors">
            Cancel
          </button>
          <button onClick={confirmBulkDelete} className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 transition-colors">
            Delete {selectedIds.length} Candidates
          </button>
        </div>
      </Modal>
      {/* ── Clear Supabase confirm modal ──────────────── */}
      <Modal
        isOpen={clearTarget !== null}
        onClose={() => setClearTarget(null)}
        title="Clear Supabase Data"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-red-700">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-semibold">This clears every candidate record</p>
              <p className="mt-1 text-xs leading-4">
                All {clearTarget} candidate record(s) leave the candidates list and move to the Recycle Bin. Jobs, appointments, tasks and documents are not touched.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setClearTarget(null)}
              className="rounded-full border border-cream bg-white px-4 py-2 text-[13px] font-medium text-text-primary hover:bg-cream-warm transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmClearData}
              disabled={clearing}
              className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 transition-colors disabled:cursor-not-allowed disabled:opacity-70"
            >
              {clearing ? 'Clearing…' : `Clear ${clearTarget} Records`}
            </button>
          </div>
        </div>
      </Modal>
    </Layout>
  )
}
