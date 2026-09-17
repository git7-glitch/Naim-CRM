import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function service(client) {
  const context = vm.createContext({ console })
  const dependency = new vm.SyntheticModule(['supabase'], function () { this.setExport('supabase', client) }, { context })
  const source = await readFile(new URL('../src/services/documentService.js', import.meta.url), 'utf8')
  const module = new vm.SourceTextModule(source, { context })
  await module.link(() => dependency)
  await module.evaluate()
  return module.namespace
}

test('signed URL uses private bucket, default 600s and propagates denial', async () => {
  let denied = false
  const api = await service({ storage: { from(bucket) {
    assert.equal(bucket, 'documents')
    return { async createSignedUrl(path, ttl) {
      assert.equal(path, 'candidate/manual/passport.pdf'); assert.equal(ttl, 600)
      return denied ? { error: new Error('Access denied') } : { data: { signedUrl: 'https://example.test/signed' } }
    } }
  } } })
  assert.equal(await api.getSignedUrl('candidate/manual/passport.pdf'), 'https://example.test/signed')
  denied = true
  await assert.rejects(api.getSignedUrl('candidate/manual/passport.pdf'), /Access denied/)
  await assert.rejects(api.getSignedUrl('https://example.test/public'), /valid storage/)
  await assert.rejects(api.getSignedUrl('../passport.pdf'), /valid storage/)
  await assert.rejects(api.getSignedUrl('passport.pdf', 601), /lifetime/)
})

test('uploads store path but never public URL, rolling storage back on DB failure', async () => {
  let fail = false, inserted, uploaded, removed
  const api = await service({
    storage: { from: () => ({
      async upload(path) { uploaded = path; return {} },
      async remove(paths) { removed = paths[0]; return {} },
    }) },
    from: () => ({ insert(row) { inserted = row; return { select: () => ({ single: async () => fail ? { error: new Error('DB failure') } : { data: row } }) } } }),
  })
  const file = { name: 'passport.pdf', type: 'application/pdf', size: 10 }
  const result = await api.uploadDocument(file, 'candidate', 'Passport')
  assert.equal(result.file_url, null)
  assert.equal(inserted.file_path, uploaded)
  fail = true
  await assert.rejects(api.uploadDocument(file, 'candidate', 'Passport'), /DB failure/)
  assert.equal(removed, uploaded)
})

test('no permanent URL consumers remain and private migration is present', async () => {
  for (const path of ['src/components/documents/DocumentPreview.jsx', 'src/pages/DocumentsPage.jsx']) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /record\.file_url|record\.fileUrl|getPublicUrl/)
  }
  const sql = await readFile(new URL('../supabase/migrations/001_security.sql', import.meta.url), 'utf8')
  assert.match(sql, /SET public = false/)
  assert.match(sql, /FOR SELECT TO authenticated/)
})
