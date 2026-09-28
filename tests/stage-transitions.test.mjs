// Phase 2: stage-transition validation. The JS rules (UI feedback) and the DB
// trigger function (the real guard) must agree exactly.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { canTransition, transitionError, allowedTargets, PIPELINE_STAGES, GATE_STAGES } from '../src/utils/stageTransitions.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))

test('cannot jump from New straight to Placed (the spec example)', () => {
  assert.equal(canTransition('New', 'Placed'), false)
  assert.match(transitionError('New', 'Placed'), /Interview/)
})

test('optional stages may be skipped, gates may not', () => {
  assert.equal(canTransition('New', 'Screening'), true)
  assert.equal(canTransition('New', 'Interview'), true)
  assert.equal(canTransition('New', 'Offer'), false)
  assert.equal(canTransition('Interview', 'Offer'), true)
  assert.equal(canTransition('Offer', 'Visa Processing'), true)
  assert.equal(canTransition('Offer', 'Placed'), false)
  assert.equal(canTransition('Visa Processing', 'Placed'), true)
  assert.equal(canTransition('Onboarding', 'Completed'), false)
  assert.equal(canTransition('Placed', 'Completed'), true)
})

test('moving backwards, exiting and parking are allowed; completed is final', () => {
  assert.equal(canTransition('Offer', 'Screening'), true)
  assert.equal(canTransition('Visa Processing', 'Rejected'), true)
  assert.equal(canTransition('Interview', 'Withdrawn'), true)
  assert.equal(canTransition('Screening', 'Pending'), true)
  assert.equal(canTransition('Completed', 'Rejected'), false)
  assert.equal(canTransition('Completed', 'Placed'), true)
  assert.equal(canTransition('Completed', 'New'), false)
})

test('exited candidates reopen only to New / Screening / Pending', () => {
  assert.equal(canTransition('Rejected', 'New'), true)
  assert.equal(canTransition('Rejected', 'Screening'), true)
  assert.equal(canTransition('Withdrawn', 'Offer'), false)
  assert.equal(canTransition('Rejected', 'Placed'), false)
})

test('parked candidates behave like New; legacy spellings fold', () => {
  assert.equal(canTransition('Pending', 'Interview'), true)
  assert.equal(canTransition('Draft', 'Offer'), false)
  assert.equal(canTransition('Interviewing', 'Offer'), true)
  assert.equal(canTransition(null, 'Screening'), true)
  assert.equal(canTransition('New', 'Bogus'), false)
})

test('allowedTargets lists only legal moves', () => {
  const targets = allowedTargets('New')
  assert.ok(targets.includes('Interview'))
  assert.ok(!targets.includes('Placed'))
  assert.ok(!targets.includes('New'))
})

test('DB function uses the same pipeline and gates as the JS rules', async () => {
  const sql = await readFile(join(ROOT, 'supabase/migrations/004_phase2.sql'), 'utf8')
  const arr = (name) => {
    const m = sql.match(new RegExp(`${name} TEXT\\[\\] := ARRAY\\[([^\\]]*)\\]`))
    assert.ok(m, `${name} array not found`)
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
  }
  assert.deepEqual(arr('pipeline'), PIPELINE_STAGES)
  assert.deepEqual(arr('gates'), GATE_STAGES)
  assert.match(sql, /CREATE TRIGGER enforce_stage_transition BEFORE UPDATE OF stage ON public\.candidates/)
})
