import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildChecklist, expiryStatus, checklistKeyFor, REQUIRED_DOCUMENTS } from '../src/utils/documentChecklist.js'

const TODAY = '2026-09-28'

test('checklist covers passport, CV, medical, good conduct and visa', () => {
  assert.deepEqual(REQUIRED_DOCUMENTS.map((d) => d.key), ['passport', 'cv', 'medical', 'good_conduct', 'visa'])
})

test('document types map onto checklist items case-insensitively', () => {
  assert.equal(checklistKeyFor('Resume/CV'), 'cv')
  assert.equal(checklistKeyFor('good conduct certificate'), 'good_conduct')
  assert.equal(checklistKeyFor('Medical Examination Report'), 'medical')
  assert.equal(checklistKeyFor('Photo'), null)
})

test('expiry thresholds: expired, critical <=30d, warning <=90d, valid', () => {
  assert.equal(expiryStatus('2026-09-27', TODAY).status, 'expired')
  assert.equal(expiryStatus('2026-10-28', TODAY).status, 'critical')
  assert.equal(expiryStatus('2026-12-01', TODAY).status, 'warning')
  assert.equal(expiryStatus('2027-06-01', TODAY).status, 'valid')
  assert.equal(expiryStatus(null, TODAY).status, 'no-expiry')
})

test('missing items and the newest renewal win', () => {
  const docs = [
    { id: 1, document_type: 'Passport', expiry_date: '2026-10-01' },
    { id: 2, document_type: 'Passport', expiry_date: '2031-10-01' },
    { id: 3, document_type: 'Medical Certificate', expiry_date: '2026-09-01' },
    { id: 4, document_type: 'Resume/CV' },
    { id: 5, document_type: 'Visa', expiry_date: '2027-01-01', deleted_at: '2026-09-01T00:00:00Z' },
  ]
  const c = buildChecklist(docs, TODAY)
  const by = Object.fromEntries(c.items.map((i) => [i.key, i]))
  assert.equal(by.passport.status, 'valid')
  assert.equal(by.passport.document.id, 2)
  assert.equal(by.medical.status, 'expired')
  assert.equal(by.cv.status, 'valid')
  assert.equal(by.good_conduct.status, 'missing')
  assert.equal(by.visa.status, 'missing', 'soft-deleted documents do not count')
  assert.equal(c.missing, 2)
  assert.equal(c.problems, 1)
})
