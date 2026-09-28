import { LogOut, User, Menu } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import GlobalSearch from './GlobalSearch'
import NotificationBell from './NotificationBell'

export default function Header({ title, onMenu }) {
  const { user, userProfile, logout } = useAuth()

  const email = user?.email || ''
  const displayEmail = email.length > 22 ? email.slice(0, 20) + '…' : email
  const roleLabel = userProfile?.role === 'admin' ? 'Admin' : userProfile ? 'Staff' : ''

  return (
    <header id="app-header" className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-2">
        {onMenu && (
          <button
            type="button"
            onClick={onMenu}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-cream-warm hover:text-primary md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <h1 className="truncate text-base font-bold text-primary sm:text-lg">{title}</h1>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <GlobalSearch />
        <NotificationBell />

        <div className="hidden items-center gap-1.5 lg:flex" title={email}>
          <User className="h-4 w-4 text-gray-500" aria-hidden="true" />
          <span className="text-sm text-text-secondary">{displayEmail}</span>
          {roleLabel && (
            <span className="rounded-full bg-cream-light px-2 py-0.5 text-[11px] font-medium text-primary">{roleLabel}</span>
          )}
        </div>

        <button
          id="logout-button"
          type="button"
          onClick={logout}
          aria-label="Logout"
          className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm font-medium text-text-primary transition-colors hover:border-primary hover:bg-cream-warm hover:text-primary sm:px-3.5"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  )
}
