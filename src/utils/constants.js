// CRM-6: the ONE canonical candidate stage vocabulary. The MCP server
// (mcp-server/crm_helpers.py CANONICAL_STAGES) and the DB CHECK constraint
// (supabase/migrations/002_candidate_stages.sql) must match this list exactly;
// tests/stage-vocabulary.test.mjs enforces it.
export const CANDIDATE_STAGES = [
  'New',
  'Source',
  'Screening',
  'Interview',
  'Assessment',
  'Shortlist',
  'Offer',
  'Contract Signing',
  'Visa Processing',
  'Onboarding',
  'Placed',
  'Completed',
  'Rejected',
  'Withdrawn',
  'Pending',
  'Draft',
]

// Stages where the pipeline has ended; auto-delete only sweeps these.
export const TERMINAL_STAGES = ['Completed', 'Rejected', 'Withdrawn']

// Spellings older builds wrote. Read-side only: normalizeStage() folds them
// onto canonical stages so old drafts/records still display. Never write these.
export const LEGACY_STAGE_MAP = Object.freeze({
  Interviewing: 'Interview',
  Hired: 'Placed',
})

export function isCanonicalStage(value) {
  return CANDIDATE_STAGES.includes(value)
}

/** Fold any stored/imported stage spelling onto a canonical stage, or ''. */
export function normalizeStage(value) {
  const cleaned = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!cleaned) return ''
  const lower = cleaned.toLowerCase()
  const canonical = CANDIDATE_STAGES.find((stage) => stage.toLowerCase() === lower)
  if (canonical) return canonical
  const legacy = Object.keys(LEGACY_STAGE_MAP).find((key) => key.toLowerCase() === lower)
  return legacy ? LEGACY_STAGE_MAP[legacy] : ''
}

export const STAGE_COLORS = {
  New: 'bg-blue-100 text-blue-700',
  Source: 'bg-purple-100 text-purple-700',
  Screening: 'bg-yellow-100 text-yellow-700',
  Interview: 'bg-indigo-100 text-indigo-700',
  Assessment: 'bg-cyan-100 text-cyan-700',
  Shortlist: 'bg-teal-100 text-teal-700',
  Offer: 'bg-purple-100 text-purple-700',
  'Contract Signing': 'bg-emerald-100 text-emerald-700',
  'Visa Processing': 'bg-orange-100 text-orange-700',
  Onboarding: 'bg-lime-100 text-lime-700',
  Placed: 'bg-[#d7a42a]/20 text-[#8b6914]',
  Completed: 'bg-[#8b6914]/10 text-[#6b520f]',
  Rejected: 'bg-red-100 text-red-700',
  Withdrawn: 'bg-gray-100 text-gray-600',
  Pending: 'bg-amber-100 text-amber-700',
  Draft: 'bg-slate-100 text-slate-600',
}

export const STAGE_DOTS = {
  New: 'bg-blue-500',
  Source: 'bg-purple-500',
  Screening: 'bg-yellow-400',
  Interview: 'bg-indigo-500',
  Assessment: 'bg-cyan-500',
  Shortlist: 'bg-teal-500',
  Offer: 'bg-purple-500',
  'Contract Signing': 'bg-emerald-500',
  'Visa Processing': 'bg-orange-500',
  Onboarding: 'bg-lime-500',
  Placed: 'bg-[#d7a42a]',
  Completed: 'bg-[#8b6914]',
  Rejected: 'bg-red-500',
  Withdrawn: 'bg-gray-400',
  Pending: 'bg-amber-500',
  Draft: 'bg-slate-400',
}

export const JOB_STATUSES = ['Active', 'Draft', 'Closed']

export const APPOINTMENT_STATUSES = ['Scheduled', 'Completed', 'Cancelled', 'Rescheduled']

export const TASK_STATUSES = ['Pending', 'In Progress', 'Completed', 'Overdue']

export const TASK_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']

// Phase 2: 'Visa' added for the document center checklist.
export const DOCUMENT_TYPES = [
  'Passport',
  'Qualification Certificates',
  'Good Conduct Certificate',
  'Medical Certificate',
  'Resume/CV',
  'Visa',
  'Photo',
  'Other',
]

export const COUNTRIES = [
  'Kuwait',
  'Saudi Arabia',
  'UAE',
  'Qatar',
  'Bahrain',
  'Oman',
  'Kenya',
  'Jordan',
  'Lebanon',
  'Ethiopia',
  'Philippines',
  'India',
  'Nepal',
  'Sri Lanka',
  'Bangladesh',
  'Ghana',
  'Nigeria',
  'Egypt',
]

export const CURRENCIES = [
  { code: 'KES', symbol: 'KSh', name: 'Kenyan Shilling' },
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'KWD', symbol: 'KD', name: 'Kuwaiti Dinar' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham' },
  { code: 'QAR', symbol: '﷼', name: 'Qatari Riyal' },
]

export const USER_ROLES = ['admin', 'manager', 'user']

export const RECRUITMENT_STAGES = [
  'New',
  'Source',
  'Screening',
  'Interview',
  'Assessment',
  'Shortlist',
  'Offer',
  'Contract Signing',
  'Visa Processing',
  'Onboarding',
  'Placed',
  'Completed',
]

// Hermes automation job contract (see docs/HERMES-INTEGRATION.md).
export const AUTOMATION_JOB_TYPES = ['cv_build', 'lead_enrich', 'whatsapp_send', 'doc_ocr', 'followup_sweep']
export const AUTOMATION_JOB_STATUSES = ['pending', 'claimed', 'done', 'failed']

export const PAGE_ACCESS_OPTIONS = [
  'dashboard',
  'candidates',
  'pipeline',
  'jobs',
  'appointments',
  'tasks',
  'documents',
  'reports',
  'settings',
  'associates',
  'cv-builder',
  'job-generator',
  'receptionist-view',
  'recycle-bin',
  'whatsapp',
]
