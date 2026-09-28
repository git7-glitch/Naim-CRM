import { CANDIDATE_STATUSES } from '../components/candidates/StatusDropdown'
import { normalizeStage } from '../utils/constants'

export const CV_BUILDER_STORAGE_KEY = 'naim-cv-builder-draft'

// Dropdown choices for the CV Builder form, spelled exactly as the reference
// form lists them.
export const CV_SELECT_OPTIONS = Object.freeze({
  religion: ['MUSLIM', 'CHRISTIAN', 'HINDU', 'BUDDHIST', 'OTHER'],
  civilStatus: ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'],
  educationLevel: [
    'PRIMARY SCHOOL LEVEL',
    'SECONDARY SCHOOL LEVEL',
    'HIGH SCHOOL LEVEL',
    'COLLEGE LEVEL',
    'UNIVERSITY LEVEL',
  ],
  englishLevel: ['BASIC', 'GOOD', 'FLUENT', 'EXCELLENT'],
  arabicLevel: ['NONE', 'LITTLE', 'BASIC', 'GOOD', 'FLUENT'],
  // CRM-6: Stage offers exactly the canonical CANDIDATE_STAGES (via the
  // Candidates page dropdown), so the two lists cannot drift.
  stage: CANDIDATE_STATUSES.map((status) => status.label),
})

// Wording earlier versions of these dropdowns saved, plus the spellings
// candidate records carry, folded onto the choices above — so a saved draft
// keeps its answer instead of quietly dropping back to the placeholder.
// Stage spellings are folded centrally by normalizeStage() in constants.js.
const LEGACY_SELECT_VALUES = {
  religion: {
    islam: 'MUSLIM',
    islamic: 'MUSLIM',
    christianity: 'CHRISTIAN',
    catholic: 'CHRISTIAN',
    protestant: 'CHRISTIAN',
    hinduism: 'HINDU',
    buddhism: 'BUDDHIST',
  },
  civilStatus: { single: 'SINGLE', separated: 'DIVORCED', widow: 'WIDOWED', widower: 'WIDOWED' },
  educationLevel: {
    primary: 'PRIMARY SCHOOL LEVEL',
    secondary: 'SECONDARY SCHOOL LEVEL',
    'high school': 'HIGH SCHOOL LEVEL',
    certificate: 'COLLEGE LEVEL',
    diploma: 'COLLEGE LEVEL',
    college: 'COLLEGE LEVEL',
    degree: 'UNIVERSITY LEVEL',
    bachelor: 'UNIVERSITY LEVEL',
    university: 'UNIVERSITY LEVEL',
  },
  englishLevel: { poor: 'BASIC', little: 'BASIC', beginner: 'BASIC', fair: 'GOOD' },
  arabicLevel: { poor: 'NONE', beginner: 'LITTLE', fair: 'GOOD', excellent: 'FLUENT' },
}

/**
 * Fold a stored or imported value onto one of the dropdown choices.
 *
 * Returns '' when nothing matches, so the field shows its placeholder instead
 * of holding a value its dropdown cannot display.
 */
export function standardCVSelectValue(field, value) {
  const cleaned = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!cleaned) return ''
  if (field === 'stage') {
    const stage = normalizeStage(cleaned)
    return CV_SELECT_OPTIONS.stage.includes(stage) ? stage : ''
  }
  const exact = CV_SELECT_OPTIONS[field].find((option) => option.toLowerCase() === cleaned.toLowerCase())
  return exact || LEGACY_SELECT_VALUES[field]?.[cleaned.toLowerCase()] || ''
}

export const DEFAULT_CV_BUILDER_DRAFT = Object.freeze({
  template: '3',
  autoSave: true,
  companyName: 'NAIM INVESTMENT OFFICE',
  companyNameArabic: 'مكتب نعيم للاستثمار',
  companyLocation: 'P O Box 80249-80100 Mombasa, Kenya',
  companyPhone: '+254720931164',
  position: 'DOMESTIC WORKER',
  positionArabic: 'الوظيفة',
  salary: '1100',
  passportNumber: 'AK0597068',
  dateIssued: '',
  dateExpiry: '',
  placeIssued: '',
  fullName: 'AMINA ALI KAKAWA',
  fullNameArabic: 'أمينة علي كاكاوا',
  address: '',
  nationality: '',
  religion: '',
  dateOfBirth: '',
  placeOfBirth: '',
  fatherName: '',
  motherName: '',
  age: '',
  height: '',
  weight: '',
  civilStatus: '',
  spouse: '',
  numberOfKids: '',
  educationLevel: '',
  englishLevel: '',
  arabicLevel: '',
  workPosition: 'DOMESTIC WORKER',
  workCountry: '',
  workYears: '',
  contact: '+000-000-0000',
  email: '1783949273605@temp.com',
  emergencyContact: '',
  workCompany: '',
  workCity: 'TANA DELTA, KENYA',
  stage: 'Onboarding',
  referenceNumber: '',
  referenceDate: '',
  destination: '',
  nextOfKin: '',
  kinship: '',
  otherEmergencyInfo: '',
  idNumber: '',
  complexion: '',
  educationPeriod: '',
  additionalEducation: '',
  hobbies: '1. COOKING\n2. GOING OUT\n3. HOUSE CHORES',
  medicalHistory: '',
  remarks: 'COOPERATIVE / HIGHLY DISCIPLINE / HARDWORKING & EXPERIENCED, WORKED IN IRAQ FOR 8 YEARS  AS A DOMESTIC WORKER',
  newSkill: '',
  skills: [
    'ARABIC DISH COOKING',
    'CLEANING',
    'WASHING',
    'IRONING',
    'BABYSITTING',
    'CARING ELDERS',
  ],
  files: {},
})

export function createDefaultCVBuilderDraft() {
  return {
    ...DEFAULT_CV_BUILDER_DRAFT,
    skills: [...DEFAULT_CV_BUILDER_DRAFT.skills],
    files: {},
  }
}

function normalizeDraft(value) {
  const defaults = createDefaultCVBuilderDraft()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  return {
    ...defaults,
    ...value,
    template: ['1', '2', '3', '4', '5'].includes(String(value.template)) ? String(value.template) : defaults.template,
    autoSave: value.autoSave !== false,
    religion: standardCVSelectValue('religion', value.religion),
    civilStatus: standardCVSelectValue('civilStatus', value.civilStatus),
    educationLevel: standardCVSelectValue('educationLevel', value.educationLevel),
    englishLevel: standardCVSelectValue('englishLevel', value.englishLevel),
    arabicLevel: standardCVSelectValue('arabicLevel', value.arabicLevel),
    // Stage has no placeholder choice, so it falls back to the first stage.
    stage: standardCVSelectValue('stage', value.stage) || defaults.stage,
    skills: Array.isArray(value.skills)
      ? value.skills.filter((skill) => typeof skill === 'string' && skill.trim()).map((skill) => skill.trim())
      : defaults.skills,
    files: value.files && typeof value.files === 'object' && !Array.isArray(value.files) ? value.files : {},
  }
}

export function loadCVBuilderDraft(storage = window.localStorage) {
  try {
    const raw = storage.getItem(CV_BUILDER_STORAGE_KEY)
    return raw === null ? createDefaultCVBuilderDraft() : normalizeDraft(JSON.parse(raw))
  } catch {
    return createDefaultCVBuilderDraft()
  }
}

export function saveCVBuilderDraft(draft, storage = window.localStorage) {
  const normalized = normalizeDraft(draft)
  storage.setItem(CV_BUILDER_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function clearCVBuilderDraft(storage = window.localStorage) {
  storage.removeItem(CV_BUILDER_STORAGE_KEY)
  return createDefaultCVBuilderDraft()
}

/**
 * Map a candidate record onto CV Builder draft fields.
 *
 * Used by the Candidates page "Create/Edit CV" action so the builder opens
 * pre-filled with that candidate. Only fields the candidate actually has are
 * returned, letting the caller merge over an existing draft without wiping
 * work with blanks.
 */
export function cvDraftFromCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return {}

  const jobTitle = candidate.position || candidate.job_title || candidate.work_position
  // Candidate salaries arrive formatted ("Ksh 1,100.00"); the builder wants digits.
  const salaryDigits = String(candidate.salary ?? '').replace(/[^\d.]/g, '').replace(/\.0+$/, '')

  const mapped = {
    fullName: candidate.name,
    email: candidate.email,
    contact: candidate.phone,
    passportNumber: candidate.passport_number,
    salary: salaryDigits,
    position: jobTitle,
    workPosition: jobTitle,
    // These four feed dropdowns, so a candidate's wording has to be folded onto
    // a real choice; anything unrecognized drops out with the empties below.
    stage: standardCVSelectValue('stage', candidate.stage || candidate.status),
    nationality: candidate.nationality,
    religion: standardCVSelectValue('religion', candidate.religion),
    dateOfBirth: candidate.date_of_birth,
    placeOfBirth: candidate.place_of_birth,
    civilStatus: standardCVSelectValue('civilStatus', candidate.civil_status),
    educationLevel: standardCVSelectValue('educationLevel', candidate.education_level),
    workCompany: candidate.work_company || (candidate.company === 'N/A' ? '' : candidate.company),
    workCity: candidate.city === 'N/A' ? '' : candidate.city,
    workCountry: candidate.country,
    emergencyContact: candidate.emergency_contact === 'N/A' ? '' : candidate.emergency_contact,
    destination: candidate.country_applying_to,
    remarks: candidate.notes,
  }

  // Drop empties so a merge never blanks out fields the candidate lacks.
  return Object.fromEntries(
    Object.entries(mapped).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}
