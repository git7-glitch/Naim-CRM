import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeSearch, ilikeAny, SEARCH_MAX_LENGTH } from '../src/utils/sanitizeSearch.js'

test('plain names, emails and phones pass through', () => {
  assert.equal(sanitizeSearch('Amina Ali'), 'Amina Ali')
  assert.equal(sanitizeSearch('john.doe@naim.co.ke'), 'john.doe@naim.co.ke')
  assert.equal(sanitizeSearch('+254 720-931164'), '+254 720-931164')
  assert.equal(sanitizeSearch('أمينة علي'), 'أمينة علي')
})

test('PostgREST filter syntax is neutralised', () => {
  for (const ch of [',', '(', ')', '%', '*', ':', '"', "'", '\\']) {
    assert.ok(!sanitizeSearch(`a${ch}b`).includes(ch), `leaked ${ch}`)
  }
  const attack = 'x%,id.not.is.null),or(role.eq.admin'
  const filter = ilikeAny(['name', 'email'], attack)
  assert.equal(filter.split(',').length, 2, 'attacker cannot add extra OR branches')
  assert.doesNotMatch(filter, /[()]/)
})

test('empty or junk input yields no filter', () => {
  assert.equal(sanitizeSearch(null), '')
  assert.equal(sanitizeSearch('   '), '')
  assert.equal(ilikeAny(['name'], '(),%*'), null)
})

test('input is length-capped', () => {
  assert.equal(sanitizeSearch('a'.repeat(500)).length, SEARCH_MAX_LENGTH)
})
