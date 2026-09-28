import { createClient } from '@supabase/supabase-js'

// Browser bundle: ONLY the anon key. The service_role key lives exclusively in
// server environments (mcp-server/.env, Netlify functions env).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('http') &&
  !supabaseUrl.includes('your_supabase')
)

// CRM-10: demo mode is a dev-only convenience. A production build without
// Supabase config is a deployment error and must hard-fail, never fall back
// to a demo admin session.
export const isDemoMode = !isSupabaseConfigured && !import.meta.env.PROD
export const isMisconfiguredProduction = !isSupabaseConfigured && Boolean(import.meta.env.PROD)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : createClient('https://placeholder.supabase.co', 'placeholder-key')
