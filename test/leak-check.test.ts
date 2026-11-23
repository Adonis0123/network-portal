import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../scripts/leak-check.sh', import.meta.url))

function fixture(t: { after: (fn: () => void) => void }, files: Record<string, string | null>) {
  const root = mkdtempSync(join(tmpdir(), 'network-portal-leak-check-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(dirname(join(root, 'scripts/leak-check.sh')), { recursive: true })
  copyFileSync(script, join(root, 'scripts/leak-check.sh'))
  writeFileSync(join(root, '.gitignore'), 'dist/\n')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content ?? 'removed after staging')
  }
  assert.equal(spawnSync('git', ['init', '--quiet'], { cwd: root }).status, 0)
  const tracked = Object.keys(files).filter((path) => !path.startsWith('dist/'))
  assert.equal(spawnSync('git', ['add', '--', '.gitignore', ...tracked], { cwd: root }).status, 0)
  for (const [path, content] of Object.entries(files)) if (content === null) rmSync(join(root, path))
  return root
}

function run(root: string) {
  return spawnSync('sh', ['scripts/leak-check.sh'], { cwd: root, encoding: 'utf8' })
}

describe('publishable-file leak check', () => {
  it('passes a clean readable file set', (t) => {
    const result = run(fixture(t, { 'clean.txt': 'public example\n' }))
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /clean/)
  })

  it('fails closed when a selected file cannot be read', (t) => {
    const result = run(fixture(t, { 'missing.txt': null }))
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /could not read|read every/)
  })

  it('reports only file locations, never the matched secret', (t) => {
    const privateValue = ['', 'Users', 'tester', 'private', 'token'].join('/')
    const result = run(fixture(t, { 'secret.txt': `${privateValue}\n` }))
    assert.equal(result.status, 1)
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /tester|private\/token/)
    assert.match(result.stderr, /secret\.txt/)
  })

  it('checks credential-shaped filenames in ignored dist files', (t) => {
    for (const path of ['dist/auth.json', 'dist/fixtures/auth.json']) {
      const result = run(fixture(t, { [path]: '{"value":"synthetic opaque token"}\n' }))
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, new RegExp(path.replaceAll('/', '\\/').replaceAll('.', '\\.')))
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /synthetic opaque token/)
    }
  })

  it('scans ignored dist files that would be published', (t) => {
    const privateValue = ['', 'Users', 'tester', 'private', 'dist'].join('/')
    const result = run(fixture(t, { 'dist/packed.js': `// ${privateValue}\n` }))
    assert.equal(result.status, 1)
    assert.match(result.stderr, /dist\/packed\.js/)
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /tester|private\/dist/)
  })
})
