// CRM-6 audit, executable: run `npm test`. This is the grep evidence.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANDIDATE_STAGES } from '../src/utils/constants.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const SCANNED_DIRS = ['src', 'mcp-server', 'supabase']
const EXTENSIONS = /\.(jsx?|mjs|py|sql)$/
const GHOST_STAGE = /['"](Hired|Interviewing)['"]/
// The only places allowed to name legacy spellings: the read-side fold map,
// the migration that rewrites old rows, and test files asserting rejection.
const ALLOWED = new Set(['src/utils/constants.js', 'supabase/migrations/002_candidate_stages.sql'])

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else if (EXTENSIONS.test(entry.name)) out.push(full)
  }
  return out
}

function quoted(source) {
  return [...source.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1])
}

test('no ghost stage literals anywhere in frontend, MCP server or SQL', async () => {
  const offenders = []
  for (const dir of SCANNED_DIRS) {
    for (const file of await walk(join(ROOT, dir))) {
      const rel = relative(ROOT, file).replaceAll('\\', '/')
      if (ALLOWED.has(rel) || /(^|\/)test_[^/]+\.py$/.test(rel)) continue
      const source = await readFile(file, 'utf8')
      source.split('\n').forEach((line, i) => {
        if (GHOST_STAGE.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
  }
  assert.deepEqual(offenders, [], `Ghost stages found:\n${offenders.join('\n')}`)
})

test('MCP server stage list matches CANDIDATE_STAGES exactly', async () => {
  const py = await readFile(join(ROOT, 'mcp-server/crm_helpers.py'), 'utf8')
  const block = py.match(/CANONICAL_STAGES = \(([\s\S]*?)\)/)
  assert.ok(block, 'CANONICAL_STAGES tuple not found')
  assert.deepEqual(quoted(block[1]), CANDIDATE_STAGES)
})

test('DB CHECK constraint matches CANDIDATE_STAGES exactly', async () => {
  const sql = await readFile(join(ROOT, 'supabase/migrations/002_candidate_stages.sql'), 'utf8')
  const block = sql.match(/ADD CONSTRAINT candidates_stage_check CHECK \(stage IN \(([\s\S]*?)\)\)/)
  assert.ok(block, 'candidates_stage_check not found')
  assert.deepEqual(quoted(block[1]), CANDIDATE_STAGES)
})

test('StatusDropdown derives its options from CANDIDATE_STAGES', async () => {
  const src = await readFile(join(ROOT, 'src/components/candidates/StatusDropdown.jsx'), 'utf8')
  assert.match(src, /CANDIDATE_STAGES\.map\(/)
})
