// CRM-12: templates come from the whatsapp_templates table. The fallback list
// is only used in dev demo mode (no Supabase).
import { supabase, isSupabaseConfigured } from '../supabase/client'

export const FALLBACK_TEMPLATES = Object.freeze([
  { key: 'interview', name: 'Interview Invitation', body: 'Dear {name},\n\nWe are pleased to invite you for an interview for the position of {position}.\n\nDate: {date}\nTime: {time}\nLocation: {location}\n\nPlease bring your original documents.\n\nBest regards,\nNaim Investments' },
  { key: 'offer', name: 'Job Offer', body: 'Dear {name},\n\nCongratulations! We are pleased to offer you the position of {position} in {country}.\n\nSalary: {salary}\n\nPlease confirm your acceptance within 48 hours.\n\nBest regards,\nNaim Investments' },
  { key: 'documents', name: 'Document Request', body: 'Dear {name},\n\nPlease submit the following documents for your application:\n\n{documents}\n\nKindly send them at your earliest convenience.\n\nBest regards,\nNaim Investments' },
  { key: 'followup', name: 'Follow-up', body: 'Dear {name},\n\nWe hope this message finds you well. We wanted to follow up on your application for {position}.\n\nPlease let us know if you have any questions.\n\nBest regards,\nNaim Investments' },
  { key: 'rejection', name: 'Rejection', body: 'Dear {name},\n\nThank you for your interest in the {position} role. After careful consideration, we have decided to move forward with other candidates.\n\nWe wish you all the best in your future endeavors.\n\nBest regards,\nNaim Investments' },
])

function toTemplate(row) {
  return { id: row.key, key: row.key, name: row.name, message: row.body, language: row.language || 'en' }
}

export async function listWhatsAppTemplates() {
  if (!isSupabaseConfigured) {
    return { templates: FALLBACK_TEMPLATES.map(toTemplate), demo: true }
  }
  const { data, error } = await supabase
    .from('whatsapp_templates')
    .select('key, name, body, language')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return { templates: (data || []).map(toTemplate), demo: false }
}

export function templateVariables(body) {
  return [...new Set((String(body || '').match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1)))]
}

export function fillTemplate(body, variables = {}) {
  return String(body || '').replace(/\{(\w+)\}/g, (match, key) => {
    const value = variables[key]
    return value === undefined || value === '' ? match : String(value)
  })
}

/** Digits-only international number; Kenyan 07xx/01xx becomes 2547xx/2541xx. '' if invalid. */
export function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 10 && digits.startsWith('0')) digits = `254${digits.slice(1)}`
  return digits.length >= 8 && digits.length <= 15 ? digits : ''
}
