// Phase 2 notifications: bell feed + in-app toasts for expiring documents,
// stale candidates and tasks due. Polls every 5 minutes and on window focus.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { loadNotifications, readNotificationIds, saveNotificationIds } from '../services/notificationService'

const NotificationsContext = createContext(null)
const POLL_MS = 5 * 60 * 1000
const SESSION_TOAST_KEY = 'naim-notifications-toasted'

export function NotificationsProvider({ children }) {
  const { user } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [readIds, setReadIds] = useState(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inFlight = useRef(false)
  const userId = user?.id

  useEffect(() => {
    setReadIds(userId ? readNotificationIds(userId) : new Set())
    if (!userId) setItems([])
  }, [userId])

  const refresh = useCallback(async () => {
    if (!userId || inFlight.current) return
    inFlight.current = true
    setLoading(true)
    try {
      const next = await loadNotifications()
      setItems(next)
      setError(null)

      // One toast per session summarising urgent unread alerts.
      let toasted = null
      try { toasted = window.sessionStorage.getItem(SESSION_TOAST_KEY) } catch { toasted = '1' }
      if (!toasted) {
        const read = readNotificationIds(userId)
        const urgent = next.filter((n) => (n.severity === 'critical' || n.severity === 'high') && !read.has(n.id))
        if (urgent.length) {
          toast.warning(`${urgent.length} urgent alert${urgent.length === 1 ? '' : 's'}: check the bell`)
        }
        try { window.sessionStorage.setItem(SESSION_TOAST_KEY, '1') } catch { /* ignore */ }
      }
    } catch (err) {
      setError(err)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [userId, toast])

  useEffect(() => {
    if (!userId) return undefined
    refresh()
    const timer = window.setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [userId, refresh])

  const markRead = useCallback((id) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      saveNotificationIds(userId, next)
      return next
    })
  }, [userId])

  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev)
      items.forEach((n) => next.add(n.id))
      saveNotificationIds(userId, next)
      return next
    })
  }, [items, userId])

  const value = useMemo(() => ({
    items: items.map((n) => ({ ...n, read: readIds.has(n.id) })),
    unreadCount: items.filter((n) => !readIds.has(n.id)).length,
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
  }), [items, readIds, loading, error, refresh, markRead, markAllRead])

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext)
  if (!ctx) throw new Error('useNotifications must be used within a NotificationsProvider')
  return ctx
}
