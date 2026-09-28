import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, FileClock, UserX, ClipboardList, RefreshCw } from 'lucide-react'
import { useNotifications } from '../../contexts/NotificationsContext'

const KIND_ICON = { document: FileClock, candidate: UserX, task: ClipboardList }
const KIND_LABEL = { document: 'document', candidate: 'candidate', task: 'task' }
const SEVERITY_STYLE = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const { items, unreadCount, loading, error, refresh, markRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onPointerDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  function openItem(n) {
    markRead(n.id)
    setOpen(false)
    navigate(n.to)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        id="notifications-button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-cream-warm hover:text-primary"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-2 right-2 top-14 z-50 rounded-xl border border-gray-200 bg-white shadow-xl animate-scale-in sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between px-4 py-3">
            <h3 className="text-sm font-bold text-primary">Notifications</h3>
            <div className="flex items-center gap-3">
              <button type="button" onClick={refresh} className="text-gray-400 transition-colors hover:text-primary" aria-label="Refresh notifications">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              </button>
              <button type="button" onClick={markAllRead} disabled={!unreadCount} className="flex items-center gap-1 text-xs text-gray-500 transition-colors hover:text-primary disabled:opacity-40">
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Mark all read
              </button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto border-t border-gray-100">
            {error && <p className="px-4 py-3 text-xs text-red-600">Couldn't refresh alerts. Showing the last known list.</p>}
            {items.length === 0 && !loading && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-text-primary">All clear</p>
                <p className="mt-1 text-xs text-gray-400">No expiring documents, stale candidates or due tasks.</p>
              </div>
            )}
            {items.map((n) => {
              const Icon = KIND_ICON[n.kind] || Bell
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openItem(n)}
                  className={`flex w-full gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-cream-light ${n.read ? '' : 'bg-blue-50/50'}`}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] leading-snug text-text-primary ${n.read ? '' : 'font-semibold'}`}>{n.title}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY_STYLE[n.severity]}`}>{n.severity}</span>
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">{KIND_LABEL[n.kind]}</span>
                      <span className="text-[11px] text-gray-400">{n.detail}</span>
                    </span>
                  </span>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-label="Unread" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
