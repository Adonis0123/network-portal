import { createConnection } from 'node:net'
import { loopbackHosts } from './loopback.ts'
import { type NetworkEnvironment, proxyFor, routeLabel } from './proxy.ts'
import { type NetworkSystemDeps, type NetworkSystemInfo, readNetworkSystem } from './system.ts'

export type NetworkGuardStatus = 'ok' | 'blocked' | 'unknown' | 'not-checked'

export interface NetworkGuardFact {
  status: NetworkGuardStatus
  loc?: string
  checkedAt?: string
  error?: string
}

/** A target and its already-known Guard state. The package never reads accounts, config or a Guard cache. */
export interface NetworkDiagnoseTarget {
  url: string
  guard?: NetworkGuardFact
}

export type ListenerProbe = (
  host: string,
  port: number,
  timeoutMs: number,
) => Promise<{ reachable: boolean; error?: string }>

/** A local TCP connection attempt; its result says nothing about proxy protocol or upstream connectivity. */
const probeOne: ListenerProbe = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port })
    let done = false
    const finish = (reachable: boolean, error?: string) => {
      if (done) return
      done = true
      socket.destroy()
      resolve({ reachable, ...(error ? { error } : {}) })
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false, 'timeout'))
    socket.once('error', (e) => finish(false, (e as NodeJS.ErrnoException).code || 'failed'))
  })

export const probeListener: ListenerProbe = async (host, port, timeoutMs) => {
  const locals = loopbackHosts(host)
  if (!locals.length) return { reachable: false, error: 'invalid-host' }
  const results = await Promise.all(locals.map((local) => probeOne(local, port, timeoutMs)))
  return results.find((result) => result.reachable) ?? results[0]!
}

export interface NetworkLocalProxyCandidate {
  /** The common configuration associated with this port, not an identified process. */
  label: string
  protocol: string
  host: string
  port: number
  reachable: boolean
  error?: string
}

export interface NetworkDiagnosis {
  checkedAt: string
  system: NetworkSystemInfo
  localProxyCandidates: NetworkLocalProxyCandidate[]
  targets: {
    url: string
    proxy: string
    guardSupport: 'direct' | 'http-connect' | 'unsupported' | 'invalid'
    listener: null | { host: string; port: number; reachable: boolean; error?: string }
    guard: NetworkGuardFact
  }[]
}

export interface DiagnoseNetworkOptions {
  env: NetworkEnvironment
  targets: readonly NetworkDiagnoseTarget[]
  now?: () => Date
  probe?: ListenerProbe
  system?: NetworkSystemDeps
}

const LOCAL_PROXY_CANDIDATES = [
  { label: 'Clash mixed', protocol: 'HTTP / SOCKS', port: 7897 },
  { label: 'Clash HTTP', protocol: 'HTTP', port: 7890 },
  { label: 'v2rayN SOCKS', protocol: 'SOCKS', port: 10808 },
] as const

function safeCode(error: string | undefined): string | undefined {
  return error && /^[A-Za-z0-9_-]{1,40}$/.test(error) ? error : error ? 'failed' : undefined
}

function guardError(error: string | undefined): string | undefined {
  if (!error) return undefined
  const known: Record<string, string> = {
    timeout: 'timeout',
    ETIMEDOUT: 'timeout',
    'no answer within 3 seconds': 'timeout',
    ECONNREFUSED: 'connection-refused',
    'connection-refused': 'connection-refused',
    'the connection was refused (is the proxy running?)': 'connection-refused',
    ENOTFOUND: 'lookup-failed',
    EAI_AGAIN: 'lookup-failed',
    'lookup-failed': 'lookup-failed',
    'the address could not be looked up (offline?)': 'lookup-failed',
    'the answer named no country': 'no-country',
    'no-country': 'no-country',
    'http-error': 'http-error',
    'proxy-error': 'proxy-error',
    'request-failed': 'request-failed',
    'the request failed': 'request-failed',
    failed: 'failed',
  }
  if (Object.hasOwn(known, error)) return known[error]
  if (error.startsWith('HTTP ')) return 'http-error'
  if (error.startsWith('the proxy')) return 'proxy-error'
  return 'failed'
}

function safeTargetUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    parsed.username = ''
    parsed.password = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.origin
  } catch {
    return null
  }
}

function safeGuard(guard: NetworkGuardFact | undefined): NetworkGuardFact {
  if (!guard) return { status: 'not-checked' }
  const status = ['ok', 'blocked', 'unknown', 'not-checked'].includes(guard.status) ? guard.status : 'unknown'
  const loc = guard.loc && /^[A-Za-z]{2}$/.test(guard.loc) ? guard.loc.toUpperCase() : undefined
  let checkedAt: string | undefined
  if (guard.checkedAt && !Number.isNaN(Date.parse(guard.checkedAt)))
    checkedAt = new Date(guard.checkedAt).toISOString()
  const error = guardError(guard.error)
  return {
    status,
    ...(loc ? { loc } : {}),
    ...(checkedAt ? { checkedAt } : {}),
    ...(error ? { error } : {}),
  }
}

async function probeResult(probe: ListenerProbe, host: string, port: number) {
  const result = await probe(host, port, 700).catch(() => ({ reachable: false, error: 'failed' }))
  const error = safeCode(result.error)
  return { reachable: result.reachable, ...(error ? { error } : {}) }
}

/** Offline, read-only diagnosis. It never sends a trace, resolves a remote proxy or writes a cache entry. */
export async function diagnoseNetwork(opts: DiagnoseNetworkOptions): Promise<NetworkDiagnosis> {
  const probe = opts.probe ?? probeListener
  const system = readNetworkSystem(opts.system)
  const localProxyCandidates = Promise.all(
    LOCAL_PROXY_CANDIDATES.map(async (candidate) => ({
      ...candidate,
      host: '127.0.0.1',
      ...(await probeResult(probe, '127.0.0.1', candidate.port)),
    })),
  )
  const targets = await Promise.all(
    opts.targets.map(async (target): Promise<NetworkDiagnosis['targets'][number]> => {
      const url = safeTargetUrl(target.url)
      const raw = url ? proxyFor(url, opts.env) : null
      const proxy = url ? routeLabel(url, opts.env) : 'invalid'
      let guardSupport: NetworkDiagnosis['targets'][number]['guardSupport'] = !url
        ? 'invalid'
        : raw
          ? 'invalid'
          : 'direct'
      let listener: NetworkDiagnosis['targets'][number]['listener'] = null
      if (raw && proxy !== 'invalid') {
        // Parse the redacted route at the output boundary, never the raw credential-bearing value.
        const parsed = new URL(proxy.includes('://') ? proxy : `http://${proxy}`)
        guardSupport = parsed.protocol === 'http:' ? 'http-connect' : 'unsupported'
        const host = parsed.hostname.startsWith('[') ? parsed.hostname.slice(1, -1) : parsed.hostname
        const locals = loopbackHosts(host)
        const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'http:' ? 80 : null
        if (locals.length && port !== null) {
          const results = await Promise.all(
            locals.map(async (local) => ({ local, ...(await probeResult(probe, local, port)) })),
          )
          const selected = results.find((result) => result.reachable) ?? results[0]!
          listener = {
            host: selected.local,
            port,
            reachable: selected.reachable,
            ...(selected.error ? { error: selected.error } : {}),
          }
        }
      }
      return {
        url: url ?? 'invalid-target',
        proxy,
        guardSupport,
        listener,
        guard: safeGuard(target.guard),
      }
    }),
  )
  return {
    checkedAt: (opts.now?.() ?? new Date()).toISOString(),
    system: await system,
    localProxyCandidates: await localProxyCandidates,
    targets,
  }
}
