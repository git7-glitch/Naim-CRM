import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildNotifications } from '../src/utils/notificationRules.js'

const TODAY = '2026-09-28'

test('expiring documents, stale candidates and due tasks become notifications', () => {
  const items = buildNotifications({
    today: TODAY,
    documents: [
      { id: 'd1', candidate_id: 'c1', candidate_name: 'Amina', document_type: 'Medical Certificate', expiry_date: '2026-10-05' },
      { id: 'd2', candidate_id: 'c1', candidate_name: 'Amina', document_type: 'Passport', expiry_date: '2030-01-01' },
      { id: 'd3', candidate_id: 'c2', candidate_name: 'Lydia', document_type: 'Good Conduct Certificate', expiry_date: '2026-09-20' },
    ],
    candidates: [
      { id: 'c1', name: 'Amina', stage: 'Interview', updated_at: '2026-09-01T09:00:00Z' },
      { id: 'c2', name: 'Lydia', stage: 'Completed', updated_at: '2026-01-01T09:00:00Z' },
      { id: 'c3', name: 'Fresh', stage: 'New', updated_at: '2026-09-27T09:00:00Z' },
    ],
    tasks: [
      { id: 't1', title: 'Call embassy', due_date: TODAY, status: 'Pending', priority: 'Medium' },
      { id: 't2', title: 'Old task', due_date: '2026-09-20', status: 'In Progress' },
      { id: 't3', title: 'Done task', due_date: TODAY, status: 'Completed' },
      { id: 't4', title: 'Future', due_date: '2026-10-20', status: 'Pending' },
    ],
  })
  const ids = items.map((i) => i.id.split(':').slice(0, 2).join(':'))
  assert.ok(ids.includes('doc:d1'))
  assert.ok(ids.includes('doc:d3'))
  assert.ok(!ids.includes('doc:d2'))
  assert.ok(ids.includes('stale:c1'))
  assert.ok(!ids.includes('stale:c2'), 'terminal candidates are never stale')
  assert.ok(!ids.includes('stale:c3'))
  assert.ok(ids.includes('task:t1'))
  assert.ok(ids.includes('task:t2'))
  assert.ok(!ids.includes('task:t3'))
  assert.ok(!ids.includes('task:t4'))
  assert.equal(items[0].severity, 'critical', 'expired documents sort first')
  assert.equal(items.find((i) => i.id.startsWith('doc:d1')).to, '/candidates/c1?tab=documents')
})
