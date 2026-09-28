// Phase 2: candidate stage-transition rules. ONE rule set, mirrored exactly by
// public.is_valid_stage_transition() in supabase/migrations/004_phase2.sql
// (tests/stage-transitions.test.mjs keeps the two in lockstep). The DB trigger
// is the real guard; this module gives the UI instant feedback.
import { RECRUITMENT_STAGES, normalizeStage } from './constants.js'

// The forward pipeline, in order.
export const PIPELINE_STAGES = RECRUITMENT_STAGES

// Checkpoints a candidate may never skip when moving forward. Everything else
// (Source, Screening, Assessment, Shortlist, Contract Signing, Onboarding) is
// optional. So New -> Interview is fine; New -> Offer or New -> Placed is not.
export const GATE_STAGES = ['Interview', 'Offer', 'Visa Processing', 'Placed']

// Off-pipeline stages.
export const EXIT_STAGES = ['Rejected', 'Withdrawn']
export const PARKING_STAGES = ['Pending', 'Draft']
export const REOPEN_TARGETS = ['New', 'Screening', 'Pending']

/**
 * Why a move is illegal, or '' when it is allowed.
 * Mirrors public.is_valid_stage_transition(); keep both in sync.
 */
export function transitionError(fromStage, toStage) {
  const to = normalizeStage(toStage)
  if (!to) return 'Unknown target stage'
  let from = normalizeStage(fromStage) || 'New'
  if (from === to) return ''

  if (EXIT_STAGES.includes(to)) {
    return from === 'Completed' ? 'A completed placement cannot be rejected or withdrawn' : ''
  }
  if (to === 'Pending') {
    return from === 'Completed' ? 'A completed placement cannot be parked as Pending' : ''
  }
  if (to === 'Draft') {
    return ['New', 'Draft', 'Pending'].includes(from) ? '' : 'Only new or pending candidates can go back to Draft'
  }
  if (EXIT_STAGES.includes(from)) {
    return REOPEN_TARGETS.includes(to) ? '' : `A ${from.toLowerCase()} candidate can only be reopened to New, Screening or Pending`
  }
  if (from === 'Completed') {
    return to === 'Placed' ? '' : 'A completed placement can only be moved back to Placed'
  }
  if (PARKING_STAGES.includes(from)) from = 'New'

  const fi = PIPELINE_STAGES.indexOf(from)
  const ti = PIPELINE_STAGES.indexOf(to)
  if (fi === -1 || ti === -1) return 'Unknown stage'
  if (ti <= fi) return ''

  const skipped = GATE_STAGES.find((gate) => {
    const gi = PIPELINE_STAGES.indexOf(gate)
    return gi > fi && gi < ti
  })
  return skipped ? `Can't jump from ${normalizeStage(fromStage) || 'New'} to ${to}: the candidate must pass ${skipped} first` : ''
}

export function canTransition(fromStage, toStage) {
  return transitionError(fromStage, toStage) === ''
}

/** Stages a candidate in `fromStage` may legally move to (excluding itself). */
export function allowedTargets(fromStage, stages = [...PIPELINE_STAGES, ...EXIT_STAGES, ...PARKING_STAGES]) {
  const from = normalizeStage(fromStage) || 'New'
  return stages.filter((stage) => stage !== from && canTransition(from, stage))
}
