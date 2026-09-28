import { createContext, useContext, useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured, isDemoMode } from '../supabase/client'

const AuthContext = createContext(null)

// CRM-10: only ever used when isDemoMode (dev build, no Supabase). Production
// builds without Supabase render ConfigErrorScreen before this provider mounts.
const DEMO_USER = { id: 'demo-admin', email: 'admin@naiminvestments.com' }
const DEMO_PROFILE = {
  id: 'demo-admin',
  display_name: 'Demo Admin',
  role: 'admin',
  page_permissions: ['dashboard', 'candidates', 'jobs', 'appointments', 'tasks', 'documents', 'reports', 'settings', 'associates', 'cv-builder', 'job-generator', 'receptionist-view', 'recycle-bin', 'whatsapp'],
}

export const INVITE_ONLY_MESSAGE = 'Naim CRM accounts are invite-only. Ask an administrator to send you an invitation.'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(isDemoMode ? DEMO_USER : null)
  const [userProfile, setUserProfile] = useState(isDemoMode ? DEMO_PROFILE : null)
  const [loading, setLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else {
        setUserProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('users_profiles')
      .select('*')
      .eq('id', userId)
      .single()
    // A failed profile load must never grant privileges: no profile, no role.
    setUserProfile(error ? null : data)
    setLoading(false)
  }

  async function login(email, password) {
    if (!isSupabaseConfigured) {
      if (!isDemoMode) throw new Error('This deployment is not connected to its database.')
      setUser(DEMO_USER)
      setUserProfile(DEMO_PROFILE)
      return { user: DEMO_USER }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  // Public sign-up is disabled (Phase 4: invite-only). Admins invite users from
  // the Supabase dashboard; handle_new_user() creates their profile row.
  async function register() {
    throw new Error(INVITE_ONLY_MESSAGE)
  }

  async function logout() {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut()
    }
    setUser(null)
    setUserProfile(null)
  }

  async function updateProfile(updates) {
    if (!user) return
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('users_profiles')
        .update(updates)
        .eq('id', user.id)
      if (error) throw error
    }
    setUserProfile((prev) => ({ ...prev, ...updates }))
  }

  const isAdmin = userProfile?.role === 'admin'
  const isManager = userProfile?.role === 'manager' || isAdmin

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        loading,
        login,
        register,
        logout,
        updateProfile,
        isAdmin,
        isManager,
        isDemoMode,
        refreshProfile: () => isSupabaseConfigured && user && fetchProfile(user.id),
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within an AuthProvider')
  return context
}
