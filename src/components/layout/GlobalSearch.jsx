import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, X, ArrowRight, Loader2,
  LayoutDashboard, Users, FileEdit, Folder, UserPlus, Eye, CheckSquare,
  Calendar, Briefcase, Plus, BarChart3, Settings, Trash2, MessageCircle,
  FileText, CalendarClock, ClipboardCheck, SquareKanban,
} from 'lucide-react'
import { globalSearch } from '../../services/globalSearchService'

const DEBOUNCE_MS = 180

// Pages reuse their sidebar icon so a result looks like its destination.
const PAGE_ICONS = {
  '/dashboard': LayoutDashboard,
  '/candidates': Users,
  '/pipeline': SquareKanban,
  '/cv-builder': FileEdit,
  '/documents': Folder,
  '/associates': UserPlus,
  '/receptionist-view': Eye,
  '/tasks': CheckSquare,
  '/appointments': Calendar,
  '/jobs': Briefcase,
  '/job-generator': Plus,
  '/reports': BarChart3,
  '/settings': Settings,
  '/whatsapp': MessageCircle,
  '/recycle-bin': Trash2,
}

const TYPE_ICONS = {
  candidate: Users,
  job: Briefcase,
  task: ClipboardCheck,
  appointment: CalendarClock,
  document: FileText,
  cv: FileEdit,
}

function iconFor(item) {
  if (item.type === 'page') {
    const route = item.to.split('?')[0]
    return (item.to.includes('tab=') ? Folder : PAGE_ICONS[route]) || ArrowRight
  }
  return TYPE_ICONS[item.type] || Search
}

/** Wrap the matched span of `text` in a highlight, case-insensitively. */
function Highlight({ text, query }) {
  const value = String(text ?? '')
  if (!query) return value
  const at = value.toLowerCase().indexOf(query.toLowerCase())
  if (at === -1) return value
  return (
    <>
      {value.slice(0, at)}
      <mark className="rounded-sm bg-gold-light/40 px-0.5 text-inherit">{value.slice(at, at + query.length)}</mark>
      {value.slice(at + query.length)}
    </>
  )
}

/**
 * Phase 2 Cmd/Ctrl-K global search across pages, candidates, jobs, tasks,
 * appointments, documents and CVs. Every remote filter goes through
 * sanitizeSearch()/ilikeAny() (CRM-8). On phones it opens as a full-width bar.
 */
export default function GlobalSearch() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState({ groups: [], total: 0 })
  const [activeIndex, setActiveIndex] = useState(0)

  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  // Guards against a slow request overwriting a newer one.
  const requestId = useRef(0)

  const trimmed = query.trim()

  // Flatten the grouped results so arrow keys walk a single list.
  const rows = useMemo(() => {
    const flat = []
    for (const group of result.groups) {
      for (const item of group.items) flat.push({ kind: 'item', ...item })
      if (group.viewAllTo && group.count > group.items.length) {
        flat.push({ kind: 'viewAll', id: `viewAll:${group.type}`, type: group.type, title: `View all ${group.count} ${group.label.toLowerCase()}`, to: group.viewAllTo })
      }
    }
    return flat
  }, [result])

  useEffect(() => {
    if (!trimmed) {
      setResult({ groups: [], total: 0 })
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const id = ++requestId.current
    const timer = window.setTimeout(async () => {
      try {
        const next = await globalSearch(trimmed)
        if (requestId.current !== id) return
        setResult(next)
        setActiveIndex(0)
      } catch {
        if (requestId.current !== id) return
        setResult({ groups: [], total: 0 })
      } finally {
        if (requestId.current === id) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [trimmed])

  useEffect(() => {
    function onPointerDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setMobileOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const focusSearch = useCallback(() => {
    if (window.matchMedia && !window.matchMedia('(min-width: 768px)').matches) setMobileOpen(true)
    setOpen(true)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  // Ctrl/Cmd+K opens search from anywhere.
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        focusSearch()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [focusSearch])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const go = useCallback((item) => {
    if (!item) return
    setOpen(false)
    setMobileOpen(false)
    setQuery('')
    setResult({ groups: [], total: 0 })
    inputRef.current?.blur()
    navigate(item.to)
  }, [navigate])

  function reset() {
    setQuery('')
    setResult({ groups: [], total: 0 })
    setOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (query) reset()
      else { setOpen(false); setMobileOpen(false) }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      if (rows.length) setActiveIndex((i) => (i + 1) % rows.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length) setActiveIndex((i) => (i - 1 + rows.length) % rows.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (rows.length) go(rows[activeIndex] || rows[0])
      else if (trimmed) go({ to: `/candidates?q=${encodeURIComponent(trimmed)}` })
    }
  }

  const showPanel = open && Boolean(trimmed)
  const noResults = showPanel && !loading && rows.length === 0
  let cursor = -1

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={focusSearch}
        className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-cream-warm hover:text-primary md:hidden"
        aria-label="Search the CRM"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className={mobileOpen ? 'fixed inset-x-2 top-2 z-50 md:relative md:inset-auto md:top-auto' : 'relative hidden md:block'}>
        <input
          ref={inputRef}
          id="global-search"
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search…  (Ctrl+K)"
          autoComplete="off"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          aria-label="Search the CRM"
          className="h-10 w-full rounded-full border border-gray-300 bg-white pl-4 pr-9 text-sm text-text-primary placeholder-gray-400 shadow-lg outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30 md:h-9 md:w-64 md:shadow-none"
        />
        {query ? (
          <button type="button" onClick={reset} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 transition-colors hover:bg-cream-warm hover:text-primary">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : mobileOpen ? (
          <button type="button" onClick={() => { setMobileOpen(false); setOpen(false) }} aria-label="Close search" className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-primary md:hidden">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" aria-hidden="true" />
        )}
      </div>

      {showPanel && (
        <div id="global-search-results" role="listbox" className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl animate-scale-in md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-[26rem]">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
            <span className="text-xs font-medium text-gray-500" aria-live="polite">
              {loading
                ? 'Searching…'
                : result.total > 0
                  ? `${result.total} result${result.total === 1 ? '' : 's'} for “${trimmed}”`
                  : `No results for “${trimmed}”`}
            </span>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />}
          </div>

          <div ref={listRef} className="max-h-[60vh] overflow-y-auto md:max-h-[26rem]">
            {noResults && (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-text-secondary">Nothing matched your search.</p>
                <p className="mt-1 text-xs text-gray-400">Try a name, phone, passport, job title, task, document or page.</p>
              </div>
            )}

            {result.groups.map((group) => (
              <div key={group.type} className="border-b border-gray-100 last:border-b-0">
                <div className="flex items-center justify-between bg-cream-light/60 px-4 py-1.5">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-primary">{group.label}</span>
                  <span className="text-[11px] text-gray-400">{group.count}</span>
                </div>

                {group.items.map((item) => {
                  cursor += 1
                  const index = cursor
                  const Icon = iconFor(item)
                  const active = index === activeIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go(item)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${active ? 'bg-cream-warm' : 'hover:bg-cream-light'}`}
                    >
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-primary text-white' : 'bg-cream-light text-primary'}`}>
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-text-primary"><Highlight text={item.title} query={trimmed} /></span>
                        {item.subtitle && <span className="block truncate text-[11px] text-text-secondary"><Highlight text={item.subtitle} query={trimmed} /></span>}
                      </span>
                      {item.meta && <span className="shrink-0 rounded-full bg-cream-light px-2 py-0.5 text-[10px] font-medium text-primary">{item.meta}</span>}
                    </button>
                  )
                })}

                {group.viewAllTo && group.count > group.items.length && (() => {
                  cursor += 1
                  const index = cursor
                  const active = index === activeIndex
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => go({ to: group.viewAllTo })}
                      className={`flex w-full items-center gap-1.5 px-4 py-2 text-left text-[12px] font-medium text-primary transition-colors ${active ? 'bg-cream-warm' : 'hover:bg-cream-light'}`}
                    >
                      View all {group.count} {group.label.toLowerCase()}
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </button>
                  )
                })()}
              </div>
            ))}
          </div>

          {rows.length > 0 && (
            <div className="hidden items-center justify-between border-t border-gray-100 bg-cream-light/40 px-4 py-1.5 text-[10px] text-gray-400 md:flex">
              <span>↑↓ navigate · Enter open · Esc close</span>
              <span>Ctrl+K</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
