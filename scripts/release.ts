// `pnpm release <patch|minor>` (docs/release.md): bumps the version with `npm version` and pushes the commit and
// its tag. The tag starts .github/workflows/release.yml, which checks, builds and publishes through npm trusted
// publishing. This script never publishes by itself.
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const BUMPS = ['patch', 'minor'] as const

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

function step(cmd: string, args: string[]): void {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0)
    throw new Error(`\`${cmd} ${args.join(' ')}\` failed; fix it and run pnpm release again`)
}

/** Why the checkout cannot be released now, or null. */
export function releaseProblem(s: { branch: string; dirty: string; behind: number }): string | null {
  if (s.branch !== 'main') return `releases go from main, and this is ${s.branch}; switch to main first`
  if (s.dirty) return 'the working tree has changes; commit or stash them first'
  if (s.behind) return `main is ${s.behind} commit(s) behind origin/main; pull first`
  return null
}

function main(argv: string[]): void {
  const bump = argv[0] as (typeof BUMPS)[number]
  if (!BUMPS.includes(bump)) throw new Error('usage: pnpm release <patch|minor>  (minor for new features)')
  git('fetch', '-q', 'origin')
  const problem = releaseProblem({
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain'),
    behind: Number(git('rev-list', '--count', 'HEAD..origin/main')),
  })
  if (problem) throw new Error(problem)
  step('npm', ['version', bump, '-m', '🔖 chore(release): v%s'])
  step('git', ['push', '--follow-tags', 'origin', 'main'])
  const version = (JSON.parse(git('show', 'HEAD:package.json')) as { version: string }).version
  console.log(
    `Pushed v${version}. The Release workflow on GitHub publishes it; check with \`npm view network-portal version\`.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2))
  } catch (e) {
    console.error(`pnpm release: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  }
}
