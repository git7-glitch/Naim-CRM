// Phase 2: drag-and-drop candidate pipeline over the canonical stages.
// Optimistic moves with rollback; illegal jumps (e.g. New -> Placed) are
// blocked in the UI here and by the DB trigger (migration 004).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, RefreshCw, GripVertical, SquareKanban, AlertTriangle } from 'lucide-react'
import Layout from '../components/layout/Layout'
import Skeleton from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import { useToast } from '../contexts/ToastContext'
import { isSupabaseConfigured } from '../supabase/client'
import { getPipelineCandidates, changeCandidateStage } from '../services/candidateService'
import { demoCandidatesList } from '../services/demoData'
import { COUNTRIES, STAGE_DOTS, normalizeStage } from '../utils/constants'
import { PIPELINE_STAGES, EXIT_STAGES, PARKING_STAGES, canTransition, transitionError, allowedTargets } from '../utils/stageTransitions'
import { sanitizeSearch } from '../utils/sanitizeSearch'

const COLUMN_RENDER_LIMIT = 40

function relativeDays(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}

function CandidateCard({ candidate, dragging, onDragStart, onDragEnd, onMove }) {
  const stage = normalizeStage(candidate.stage) || 'New'
  const targets = allowedTargets(stage)
  const role = candidate.job_title || candidate.work_position || candidate.position
  return (
    <article
      draggable
      onDragStart={(e) => onDragStart(e, candidate)}
      onDragEnd={onDragEnd}
      aria-label={`${candidate.name}, stage ${stage}`}
      className={`group rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-all hover:border-gold-light hover:shadow ${dragging ? 'opacity-40' : ''}`}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-gray-300 group-hover:text-gray-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <Link to={`/candidates/${candidate.id}`} className="block truncate text-[13px] font-semibold text-text-primary hover:text-primary hover:underline">
            {candidate.name || 'Unnamed candidate'}
          </Link>
          <p className="truncate text-[11px] text-text-secondary">
            {[role, candidate.country_applying_to].filter(Boolean).join(' • ') || 'No role yet'}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-400">Updated {relativeDays(candidate.updated_at)}</p>
        </div>
      </div>
      <label className="mt-2 block">
        <span className="sr-only">Move {candidate.name} to stage</span>
        <select
          value=""
          onChange={(e) => e.target.value && onMove(candidate, e.target.value)}
          className="w-full rounded-md border border-gray-200 bg-cream-light/50 px-2 py-1 text-[11px] text-text-secondary outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
        >
          <option value="">Move to…</option>
          {targets.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
    </article>
  )
}

export default function PipelinePage() {
  const toast = useToast()
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [country, setCountry] = useState('')
  const [showSide, setShowSide] = useState(false)
  const [drag, setDrag] = useState(null)
  const [overStage, setOverStage] = useState(null)
  const [expanded, setExpanded] = useState({})
  const pending = useRef(new Set())

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search), 250)
    return () => window.clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!isSupabaseConfigured) {
        const q = sanitizeSearch(debounced).toLowerCase()
        setCandidates(demoCandidatesList.filter((c) => (!q || String(c.name).toLowerCase().includes(q)) && (!country || c.country_applying_to === country)))
      } else {
        setCandidates(await getPipelineCandidates({ search: debounced, country }))
      }
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [debounced, country])

  useEffect(() => { load() }, [load])

  const columns = useMemo(() => {
    const stages = showSide ? [...PIPELINE_STAGES, ...PARKING_STAGES, ...EXIT_STAGES] : PIPELINE_STAGES
    const byStage = new Map(stages.map((s) => [s, []]))
    for (const c of candidates) {
      const stage = normalizeStage(c.stage) || 'New'
      if (byStage.has(stage)) byStage.get(stage).push(c)
    }
    return stages.map((stage) => ({ stage, items: byStage.get(stage) }))
  }, [candidates, showSide])

  const hiddenCount = useMemo(() => (showSide ? 0 : candidates.filter((c) => !PIPELINE_STAGES.includes(normalizeStage(c.stage) || 'New')).length), [candidates, showSide])

  async function move(candidate, toStage) {
    const from = normalizeStage(candidate.stage) || 'New'
    if (from === toStage) return
    const problem = transitionError(from, toStage)
    if (problem) {
      toast.error(problem)
      return
    }
    if (pending.current.has(candidate.id)) return
    pending.current.add(candidate.id)

    const stamp = new Date().toISOString()
    setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? { ...c, stage: toStage, updated_at: stamp } : c)))

    if (!isSupabaseConfigured) {
      toast.info(`Demo mode: ${candidate.name} moved to ${toStage} (not saved)`)
      pending.current.delete(candidate.id)
      return
    }
    try {
      await changeCandidateStage(candidate.id, toStage, from)
      toast.success(`${candidate.name} moved to ${toStage}`)
    } catch (err) {
      setCandidates((prev) => prev.map((c) => (c.id === candidate.id ? { ...c, stage: candidate.stage, updated_at: candidate.updated_at } : c)))
      toast.error(err?.message ? `Move failed: ${err.message}` : 'Move failed, change was undone')
    } finally {
      pending.current.delete(candidate.id)
    }
  }

  function onDragStart(e, candidate) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', candidate.id)
    setDrag({ id: candidate.id, from: normalizeStage(candidate.stage) || 'New' })
  }

  function onDragEnd() {
    setDrag(null)
    setOverStage(null)
  }

  function onDrop(e, stage) {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || drag?.id
    const candidate = candidates.find((c) => c.id === id)
    setDrag(null)
    setOverStage(null)
    if (candidate) move(candidate, stage)
  }

  return (
    <Layout title="Candidate Pipeline">
      <div className="space-y-4 animate-fade-in">
        <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm lg:flex-row lg:items-center">
          <div className="flex items-center gap-2 text-primary">
            <SquareKanban className="h-5 w-5" aria-hidden="true" />
            <h2 className="text-base font-bold">Pipeline</h2>
            <span className="text-xs text-gray-400">{candidates.length} candidates</span>
          </div>
          <label className="relative flex-1 lg:max-w-xs">
            <span className="sr-only">Search candidates</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, phone, passport…"
              className="h-9 w-full rounded-lg border border-gray-300 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/30"
            />
          </label>
          <label>
            <span className="sr-only">Country</span>
            <select value={country} onChange={(e) => setCountry(e.target.value)} className="h-9 w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-primary lg:w-44">
              <option value="">All countries</option>
              {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={showSide} onChange={(e) => setShowSide(e.target.checked)} className="h-4 w-4 accent-primary" />
            Show Pending / Draft / Rejected / Withdrawn{hiddenCount ? ` (${hiddenCount})` : ''}
          </label>
          <button type="button" onClick={load} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-text-primary hover:bg-cream-warm lg:ml-auto">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Refresh
          </button>
        </section>

        <p className="text-xs text-gray-500">
          Drag a card to another column, or use its "Move to…" menu. Checkpoints can't be skipped: Interview, Offer, Visa Processing and Placed must each be passed in order.
        </p>

        {error ? (
          <div role="alert" className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            Couldn't load the pipeline.
            <button type="button" onClick={load} className="ml-auto font-medium underline">Retry</button>
          </div>
        ) : loading ? (
          <div className="flex gap-3 overflow-x-auto pb-4" aria-busy="true">
            {PIPELINE_STAGES.slice(0, 6).map((s) => (
              <div key={s} className="w-64 shrink-0 space-y-2 rounded-xl bg-white/70 p-3">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <div className="rounded-2xl bg-white shadow-sm">
            <EmptyState icon={SquareKanban} title="No candidates here" description={debounced || country ? 'Nothing matches these filters.' : 'Add candidates to see them on the board.'} />
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4" role="list" aria-label="Pipeline stages">
            {columns.map(({ stage, items }) => {
              const legal = drag ? canTransition(drag.from, stage) : true
              const isOver = overStage === stage
              const limit = expanded[stage] ? items.length : COLUMN_RENDER_LIMIT
              return (
                <section
                  key={stage}
                  role="listitem"
                  aria-label={`${stage}: ${items.length} candidates`}
                  onDragOver={(e) => {
                    if (!drag || !legal) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (overStage !== stage) setOverStage(stage)
                  }}
                  onDragLeave={() => isOver && setOverStage(null)}
                  onDrop={(e) => legal && onDrop(e, stage)}
                  className={`flex max-h-[72vh] w-64 shrink-0 flex-col rounded-xl border-2 p-2 transition-colors ${
                    isOver ? 'border-primary bg-cream-warm' : drag && !legal ? 'border-transparent bg-gray-100 opacity-50' : 'border-transparent bg-white/70'
                  }`}
                >
                  <header className="mb-2 flex items-center gap-2 px-1">
                    <span className={`h-2.5 w-2.5 rounded-full ${STAGE_DOTS[stage] || 'bg-gray-400'}`} aria-hidden="true" />
                    <h3 className="flex-1 truncate text-[13px] font-bold text-primary">{stage}</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500 shadow-sm">{items.length}</span>
                  </header>
                  <div className="flex-1 space-y-2 overflow-y-auto px-0.5 pb-1">
                    {items.slice(0, limit).map((c) => (
                      <CandidateCard key={c.id} candidate={c} dragging={drag?.id === c.id} onDragStart={onDragStart} onDragEnd={onDragEnd} onMove={move} />
                    ))}
                    {items.length > limit && (
                      <button type="button" onClick={() => setExpanded((p) => ({ ...p, [stage]: true }))} className="w-full rounded-md py-1.5 text-[12px] font-medium text-primary hover:bg-cream-warm">
                        Show {items.length - limit} more
                      </button>
                    )}
                    {items.length === 0 && (
                      <p className="rounded-lg border border-dashed border-gray-300 px-2 py-6 text-center text-[11px] text-gray-400">
                        {drag && legal ? 'Drop here' : 'No candidates'}
                      </p>
                    )}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}
