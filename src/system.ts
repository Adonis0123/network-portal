// Read-only macOS and Linux network facts. Commands and files use fixed names, short timeouts and output caps.
// Raw output, stderr and error messages never cross this module's boundary.
import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { isIP } from 'node:net'
import { loopbackHost } from './loopback.ts'

export type NetworkProbeStatus = 'available' | 'unavailable' | 'error'
export type NetworkProxyProtocol = 'http' | 'https' | 'socks'

export interface NetworkSystemInfo {
  warp: {
    status: NetworkProbeStatus
    state: 'connected' | 'disconnected' | 'unknown'
    networkHealthy?: boolean
    error?: string
  }
  proxy: {
    status: NetworkProbeStatus
    pacEnabled: boolean
    autoDiscoveryEnabled: boolean
    protocols: {
      protocol: NetworkProxyProtocol
      enabled: boolean
      /** Loopback addresses are shown; every other hostname or address is redacted. */
      host?: string
      port?: number
    }[]
    exceptionCount?: number
    error?: string
  }
  dns: { status: NetworkProbeStatus; nameservers: string[]; error?: string }
  route: { status: NetworkProbeStatus; interface?: string; gateway?: string; error?: string }
}

export type NetworkCommandRunner = (
  command: string,
  args: readonly string[],
  opts: { timeoutMs: number; maxOutput: number },
) => Promise<string>

export type NetworkFileReader = (path: string, opts: { maxBytes: number }) => Promise<string>

export interface NetworkSystemDeps {
  platform?: NodeJS.Platform
  run?: NetworkCommandRunner
  readFile?: NetworkFileReader
}

/** The platform family whose probes produced a NetworkSystemInfo. */
export type NetworkPlatform = 'darwin' | 'linux' | 'other'

export function networkPlatform(platform: NodeJS.Platform = process.platform): NetworkPlatform {
  return platform === 'darwin' || platform === 'linux' ? platform : 'other'
}

const TIMEOUT_MS = 900
const MAX_OUTPUT = 32 * 1024

function errorCode(err: unknown): { unavailable: boolean; code: string } {
  const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string }
  if (e?.code === 'ENOENT') return { unavailable: true, code: 'not-installed' }
  if (e?.code === 'ETIMEDOUT' || e?.killed || e?.signal === 'SIGTERM' || e?.message === 'timeout')
    return { unavailable: false, code: 'timeout' }
  if (typeof e?.code === 'number') return { unavailable: false, code: `exit-${e.code}` }
  if (typeof e?.code === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(e.code))
    return { unavailable: false, code: e.code }
  return { unavailable: false, code: 'failed' }
}

const runCommand: NetworkCommandRunner = (command, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: 'utf8',
        timeout: opts.timeoutMs,
        maxBuffer: opts.maxOutput,
        windowsHide: true,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin',
          LANG: 'C',
          LC_ALL: 'C',
        },
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout.slice(0, opts.maxOutput))),
    )
  })

const readFileHead: NetworkFileReader = async (path, opts) => {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(opts.maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, opts.maxBytes, 0)
    return buffer.toString('utf8', 0, bytesRead)
  } finally {
    await handle.close()
  }
}

async function bounded(start: () => Promise<string>): Promise<string> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
  })
  try {
    const output = await Promise.race([start(), timeout])
    return output.slice(0, MAX_OUTPUT)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function unavailable(error = 'unsupported-platform'): NetworkSystemInfo {
  return {
    warp: { status: 'unavailable', state: 'unknown', error },
    proxy: {
      status: 'unavailable',
      pacEnabled: false,
      autoDiscoveryEnabled: false,
      protocols: [],
      error,
    },
    dns: { status: 'unavailable', nameservers: [], error },
    route: { status: 'unavailable', error },
  }
}

export function parseWarpStatus(output: string): Pick<NetworkSystemInfo['warp'], 'state' | 'networkHealthy'> {
  const state = /^Status update:\s*Connected\s*$/im.test(output)
    ? 'connected'
    : /^Status update:\s*Disconnected\s*$/im.test(output)
      ? 'disconnected'
      : 'unknown'
  const health = /^\s*Network\s*:?\s*(healthy|unhealthy)\b/im.exec(output)?.[1]?.toLowerCase()
  return { state, ...(health ? { networkHealthy: health === 'healthy' } : {}) }
}

function redactedHost(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const host = raw.trim().replace(/^\[|\]$/g, '')
  return loopbackHost(host) ?? 'redacted'
}

function invalidOutput(): Error {
  return Object.assign(new Error('invalid output'), { code: 'invalid-output' })
}

export function parseSystemProxy(
  output: string,
): Pick<NetworkSystemInfo['proxy'], 'protocols' | 'pacEnabled' | 'autoDiscoveryEnabled' | 'exceptionCount'> {
  const validDictionary = /^\s*<(?:dict|dictionary)>\s*\{[\s\S]*\}\s*$/.test(output)
  const hasProxySwitch = /^\s*(?:HTTP|HTTPS|SOCKS|ProxyAutoConfig|ProxyAutoDiscovery)Enable\s*:/im.test(
    output,
  )
  const validRows = output.split('\n').every((line) => {
    const row = line.trim()
    return !row || /^(?:<(?:dict|dictionary)>\s*\{|\}|\)|(?:[A-Za-z][A-Za-z0-9-]*|\d+)\s*:\s*.*)$/.test(row)
  })
  if ((!validDictionary && !hasProxySwitch) || !validRows) throw invalidOutput()
  const value = (key: string): string | undefined =>
    new RegExp(`^\\s*${key}\\s*:\\s*(.*?)\\s*$`, 'im').exec(output)?.[1]
  for (const prefix of ['HTTP', 'HTTPS', 'SOCKS', 'ProxyAutoConfig', 'ProxyAutoDiscovery']) {
    const enabled = value(`${prefix}Enable`)
    if (enabled !== undefined && enabled !== '0' && enabled !== '1') throw invalidOutput()
  }
  const definitions = [
    ['http', 'HTTP'],
    ['https', 'HTTPS'],
    ['socks', 'SOCKS'],
  ] as const
  const protocols = definitions.map(([protocol, prefix]) => {
    const enabled = value(`${prefix}Enable`) === '1'
    const rawPort = Number(value(`${prefix}Port`))
    const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : undefined
    const host = enabled ? redactedHost(value(`${prefix}Proxy`)) : undefined
    return {
      protocol,
      enabled,
      ...(host ? { host } : {}),
      ...(enabled && port ? { port } : {}),
    }
  })
  const match = /^\s*ExceptionsList\s*:\s*(?:\(([\s\S]*?)\)|<array>\s*\{([\s\S]*?)^\s*\})/im.exec(output)
  const list = match?.[1] ?? match?.[2]
  const exceptionCount =
    list === undefined ? undefined : list.split('\n').filter((line) => /^\s*\d+\s*:/.test(line)).length
  return {
    protocols,
    pacEnabled: value('ProxyAutoConfigEnable') === '1',
    autoDiscoveryEnabled: value('ProxyAutoDiscoveryEnable') === '1',
    ...(exceptionCount !== undefined ? { exceptionCount } : {}),
  }
}

export function parseDns(output: string): string[] {
  const first = /(?:^|\n)resolver #1\s*\n([\s\S]*?)(?=\nresolver #\d+\s*(?:\n|$)|$)/.exec(output)?.[1] ?? ''
  const out: string[] = []
  for (const match of first.matchAll(/^\s*nameserver\[\d+\]\s*:\s*(\S+)\s*$/gim)) {
    const address = match[1]!
    if (isIP(address) && !out.includes(address)) out.push(address)
  }
  if (!out.length) throw invalidOutput()
  return out
}

/** Nameserver addresses from resolv.conf; comments, search domains and options are never returned. */
export function parseResolvConf(output: string): string[] {
  const out: string[] = []
  for (const match of output.matchAll(/^[ \t]*nameserver[ \t]+(\S+)/gm)) {
    const address = match[1]!
    // A zone id (fe80::1%eth0) passes isIP but the AI facts drop it, so the page and facts would disagree.
    if (isIP(address) && !address.includes('%') && !out.includes(address)) out.push(address)
    if (out.length === 8) break
  }
  if (!out.length) throw invalidOutput()
  return out
}

/** The first `ip route show default` entry; a missing `via` is a point-to-point default with no gateway. */
export function parseLinuxDefaultRoute(
  output: string,
): Pick<NetworkSystemInfo['route'], 'interface' | 'gateway'> {
  // A multipath default puts `via`/`dev` on indented `nexthop` lines under the `default` line.
  const line = /^default\b.*(?:\n[ \t]+.*)*/m.exec(output)?.[0]
  if (!line) throw invalidOutput()
  const iface = /\sdev\s+([A-Za-z0-9_.-]{1,64})(?:\s|$)/.exec(line)?.[1]
  const rawGateway = /\svia\s+(\S+)/.exec(line)?.[1]
  const gateway = rawGateway && isIP(rawGateway) ? rawGateway : undefined
  if (!iface && !gateway) throw invalidOutput()
  return { ...(iface ? { interface: iface } : {}), ...(gateway ? { gateway } : {}) }
}

export function parseDefaultRoute(output: string): Pick<NetworkSystemInfo['route'], 'interface' | 'gateway'> {
  const iface = /^\s*interface:\s*([A-Za-z0-9_.-]{1,64})\s*$/m.exec(output)?.[1]
  const rawGateway = /^\s*gateway:\s*(\S+)\s*$/m.exec(output)?.[1]
  const gateway = rawGateway && (isIP(rawGateway) || /^link#\d+$/.test(rawGateway)) ? rawGateway : undefined
  if (!iface && !gateway) throw invalidOutput()
  return { ...(iface ? { interface: iface } : {}), ...(gateway ? { gateway } : {}) }
}

/**
 * All four reads run together. A missing command, timeout, bad output or failed item changes only that item.
 * Linux has no single system proxy setting, so its proxy item is `not-applicable` rather than a failed read.
 */
export async function readNetworkSystem(deps: NetworkSystemDeps = {}): Promise<NetworkSystemInfo> {
  const platform = networkPlatform(deps.platform)
  if (platform === 'other') return unavailable()
  const run = deps.run ?? runCommand
  const readFile = deps.readFile ?? readFileHead
  const read = async <T>(
    start: () => Promise<string>,
    empty: T,
    parse: (output: string) => T,
  ): Promise<T & { status: NetworkProbeStatus; error?: string }> => {
    try {
      return { status: 'available', ...parse(await bounded(start)) }
    } catch (err) {
      const failure = errorCode(err)
      return {
        ...empty,
        status: failure.unavailable ? 'unavailable' : 'error',
        error: failure.code,
      }
    }
  }
  const command = (name: string, args: readonly string[]) => () =>
    run(name, args, { timeoutMs: TIMEOUT_MS, maxOutput: MAX_OUTPUT })
  const warp = read(command('warp-cli', ['status']), { state: 'unknown' as const }, parseWarpStatus)
  if (platform === 'linux') {
    const [warpInfo, dns, route] = await Promise.all([
      warp,
      read(
        () => readFile('/etc/resolv.conf', { maxBytes: MAX_OUTPUT }),
        { nameservers: [] },
        (output) => ({ nameservers: parseResolvConf(output) }),
      ),
      read(command('ip', ['route', 'show', 'default']), {}, parseLinuxDefaultRoute),
    ])
    return { warp: warpInfo, proxy: unavailable('not-applicable').proxy, dns, route }
  }
  const [warpInfo, proxy, dns, route] = await Promise.all([
    warp,
    read(
      command('scutil', ['--proxy']),
      { protocols: [], pacEnabled: false, autoDiscoveryEnabled: false },
      parseSystemProxy,
    ),
    read(command('scutil', ['--dns']), { nameservers: [] }, (output) => ({ nameservers: parseDns(output) })),
    read(command('route', ['-n', 'get', 'default']), {}, parseDefaultRoute),
  ])
  return { warp: warpInfo, proxy, dns, route }
}
