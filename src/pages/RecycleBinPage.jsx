import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Briefcase, CalendarClock, CheckSquare, ClipboardList, Clock3, FileText, RotateCcw, Search, Trash2, Users } from 'lucide-react'
import Layout from '../components/layout/Layout'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import { SkeletonText } from '../components/ui/Skeleton'
import { useToast } from '../contexts/ToastContext'
import { deleteRecycleBinItem, loadRecycleBinItems, restoreRecycleBinItem, RECYCLE_BIN_TYPES } from '../services/recycleBinService'

const TYPE_UI = {
  candidate: { icon: Users, chip: 'border-blue-200 bg-blue-50 text-blue-600', tile: 'bg-blue-100 text-blue-600' },
  job: { icon: Briefcase, chip: 'border-amber-200 bg-amber-50 text-amber-700', tile: 'bg-amber-100 text-amber-700' },
  task: { icon: ClipboardList, chip: 'border-green-200 bg-green-50 text-green-700', tile: 'bg-green-100 text-green-700' },
  appointment: { icon: CalendarClock, chip: 'border-purple-200 bg-purple-50 text-purple-700', tile: 'bg-purple-100 text-purple-700' },
  document: { icon: FileText, chip: 'border-slate-200 bg-slate-50 text-slate-700', tile: 'bg-slate-100 text-slate-700' },
}

function deletedAgo(iso) {
  if (!iso) return 'Deleted'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'Deleted today'
  if (days === 1) return 'Deleted yesterday'
  if (days < 60) return `Deleted ${days} days ago`
  return `Deleted ${Math.round(days / 30)} months ago`
}

function ConfirmModal({ open, title, body, confirmLabel, onClose, onConfirm, busy }) {
  return (
    <Modal isOpen={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm leading-6 text-text-secondary">{body}</p>
      <div className="mt-6 flex justify-end gap-3 border-t border-gray-200 pt-4">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="danger" onClick={onConfirm} loading={busy}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}

function DeletedItemRow({ item, index, selected, onSelect, onRestore, onDelete }) {
  const ui = TYPE_UI[item.type] || TYPE_UI.candidate
  const Icon = ui.icon
  return (
    <article data-testid="recycle-bin-item" className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-[#d8dee8] bg-[#f8fafc] px-4 py-4 sm:grid-cols-[auto_auto_auto_minmax(0,1fr)_auto] sm:px-5">
      <input
        type="checkbox"
        aria-label={`Select deleted ${item.type} ${item.name}`}
        checked={selected}
        onChange={(event) => onSelect(item.key, event.target.checked)}
        className="h-3.5 w-3.5 rounded border-gray-400 accent-primary"
      />
      <span className="hidden h-7 min-w-8 items-center justify-center rounded bg-[#f2e6c9] px-2 text-sm font-semibold text-[#8d6810] sm:flex">{index + 1}.</span>
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${ui.tile}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div className="col-span-3 min-w-0 sm:col-span-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="break-words text-sm font-semibold text-slate-950 sm:text-base">{item.name}</h3>
          <span className={`rounded border px-2 py-0.5 text-xs font-medium ${ui.chip}`}>{item.type}</span>
        </div>
        {item.detail && <p className="mt-1 break-words text-xs text-slate-600 sm:text-sm">{item.detail}</p>}
        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 sm:text-xs">
          <Clock3 className="h-3 w-3" aria-hidden="true" />
          <time dateTime={item.deleted_at}>{deletedAgo(item.deleted_at)}</time>
        </p>
      </div>
      <div className="col-span-3 flex justify-end gap-2 sm:col-span-1">
        <button type="button" aria-label={`Restore ${item.name}`} title="Restore" onClick={() => onRestore(item)} className="rounded p-2 text-blue-600 transition-colors hover:bg-blue-50">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label={`Permanently delete ${item.name}`} title="Delete permanently" onClick={() => onDelete([item])} className="rounded p-2 text-red-500 transition-colors hover:bg-red-50">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

export default function RecycleBinPage() {
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [selected, setSelected] = useState([])
  const [pendingDelete, setPendingDelete] = useState(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const data = await loadRecycleBinItems()
      setItems(data)
      setLoadError(false)
      if (data.failedTypes?.length) toast.warning(`Couldn't load deleted ${data.failedTypes.join(', ')}`)
    } catch {
      setLoadError(true)
      toast.error('Failed to load deleted items')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => (type === 'all' || item.type === type)
      && (!q || [item.name, item.detail, item.type].some((v) => String(v || '').toLowerCase().includes(q))))
  }, [items, search, type])

  const counts = useMemo(() => items.reduce((acc, i) => ({ ...acc, [i.type]: (acc[i.type] || 0) + 1 }), {}), [items])
  const allVisibleSelected = filtered.length > 0 && filtered.every((i) => selected.includes(i.key))
  const selectedItems = items.filter((i) => selected.includes(i.key))

  function handleSelect(key, checked) {
    setSelected((cur) => (checked ? [...new Set([...cur, key])] : cur.filter((k) => k !== key)))
  }

  function handleSelectAll() {
    const keys = filtered.map((i) => i.key)
    setSelected((cur) => (allVisibleSelected ? cur.filter((k) => !keys.includes(k)) : [...new Set([...cur, ...keys])]))
  }

  async function runEach(list, action) {
    const done = []
    const failed = []
    for (const item of list) {
      try {
        await action(item)
        done.push(item.key)
      } catch (err) {
        failed.push({ item, err })
      }
    }
    setItems((cur) => cur.filter((i) => !done.includes(i.key)))
    setSelected((cur) => cur.filter((k) => !done.includes(k)))
    return { done, failed }
  }

  async function restore(list) {
    setBusy(true)
    const { done, failed } = await runEach(list, restoreRecycleBinItem)
    setBusy(false)
    if (done.length) toast.success(`${done.length} item${done.length === 1 ? '' : 's'} restored`)
    if (failed.length) toast.error(`${failed.length} restore${failed.length === 1 ? '' : 's'} failed: ${failed[0].err?.message || 'permission denied'}`)
  }

  async function confirmDelete() {
    const list = pendingDelete || []
    setBusy(true)
    const { done, failed } = await runEach(list, deleteRecycleBinItem)
    setBusy(false)
    setPendingDelete(null)
    if (done.length) toast.success(`${done.length} item${done.length === 1 ? '' : 's'} permanently deleted`)
    if (failed.length) toast.error(`${failed.length} delete${failed.length === 1 ? '' : 's'} failed: ${failed[0].err?.message || 'permission denied'}`)
  }

  return (
    <Layout title="Recycle Bin">
      <div className="min-w-0 animate-fade-in">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-primary sm:text-3xl">Recycle Bin</h1>
          <p className="mt-2 text-sm text-slate-600 sm:text-base">
            Deleted candidates, jobs, tasks, appointments and documents. Restore them, or delete them for good.
          </p>
        </header>

        <section data-testid="recycle-bin-panel" className="min-w-0 rounded-2xl border border-gray-100 bg-white px-4 py-6 shadow-[0_8px_22px_rgba(15,23,42,0.10)] sm:px-8 lg:px-10 lg:py-10">
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2 text-primary">
              <Trash2 className="h-5 w-5" aria-hidden="true" />
              <h2 className="text-xl font-bold">Deleted Items</h2>
              <span className="text-sm text-gray-400">({items.length})</span>
            </div>
            <label className="relative min-w-0 flex-1 lg:max-w-sm">
              <span className="sr-only">Search deleted items</span>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                placeholder="Search deleted items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-slate-400 focus:border-primary"
              />
            </label>
            <label className="lg:ml-auto">
              <span className="sr-only">Deleted item type</span>
              <select value={type} onChange={(e) => setType(e.target.value)} className="w-full min-w-40 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary lg:w-auto">
                <option value="all">All types ({items.length})</option>
                {RECYCLE_BIN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label} ({counts[t.value] || 0})</option>)}
              </select>
            </label>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-2 rounded-lg border border-[#d8dee8] bg-[#f8fafc] px-3 py-3">
            <Button type="button" variant="outline" onClick={handleSelectAll} className="bg-white" disabled={!filtered.length}>
              <CheckSquare className="h-4 w-4" aria-hidden="true" />
              {allVisibleSelected ? 'Clear selection' : 'Select all'}
            </Button>
            {selectedItems.length > 0 && (
              <>
                <span className="text-sm text-gray-500">{selectedItems.length} selected</span>
                <Button type="button" size="sm" onClick={() => restore(selectedItems)} loading={busy}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Restore selected
                </Button>
                <Button type="button" size="sm" variant="danger" onClick={() => setPendingDelete(selectedItems)} disabled={busy}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete selected
                </Button>
              </>
            )}
          </div>

          {loading ? (
            <div className="mt-4"><SkeletonText lines={6} /></div>
          ) : loadError ? (
            <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-700">
              Couldn't load the Recycle Bin. <button type="button" onClick={load} className="font-medium underline">Retry</button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {filtered.map((item, index) => (
                <DeletedItemRow
                  key={item.key}
                  item={item}
                  index={index}
                  selected={selected.includes(item.key)}
                  onSelect={handleSelect}
                  onRestore={(i) => restore([i])}
                  onDelete={setPendingDelete}
                />
              ))}
              {filtered.length === 0 && (
                <div className="rounded-lg border border-dashed border-gray-300 px-6 py-12 text-center text-sm text-slate-500">
                  {items.length ? 'No deleted items match your search.' : 'The Recycle Bin is empty.'}
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-amber-700">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <h3 className="text-sm font-semibold">Admin-only area</h3>
              <p className="mt-1 text-xs leading-5">
                Staff can delete records, which moves them here. Only admins can restore or permanently delete, and the database enforces it.
                Permanently deleting a document also removes its stored file.
              </p>
            </div>
          </div>
        </section>
      </div>

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Permanently delete"
        body={`${pendingDelete?.length || 0} item${pendingDelete?.length === 1 ? '' : 's'} will be removed for good and cannot be restored.`}
        confirmLabel="Delete permanently"
        busy={busy}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </Layout>
  )
}
