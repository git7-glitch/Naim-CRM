import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'

export default function Layout({ title, children }) {
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { pathname } = useLocation()

  useEffect(() => { setMobileOpen(false) }, [pathname])

  return (
    <div className="min-h-screen bg-cream-light">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary focus:shadow">
        Skip to content
      </a>
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded(!sidebarExpanded)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className={`transition-all duration-300 ${sidebarExpanded ? 'md:ml-64' : 'md:ml-14'}`}>
        <Header title={title} onMenu={() => setMobileOpen(true)} />
        <main id="main-content" tabIndex={-1} className="p-3 outline-none sm:p-6">{children}</main>
      </div>
    </div>
  )
}
