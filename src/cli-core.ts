import { type DiagnoseNetworkOptions, diagnoseNetwork, type NetworkDiagnosis } from './diagnose.ts'
import type { NetworkEnvironment } from './proxy.ts'

const USAGE = 'usage: network-portal diagnose [--json]'

export function formatNetworkDiagnosis(d: NetworkDiagnosis): string {
  const lines = [
    `Offline diagnosis: ${d.checkedAt}; no online trace was sent.`,
    `WARP: ${d.system.warp.status}, ${d.system.warp.state}${d.system.warp.networkHealthy === undefined ? '' : `; Network healthy: ${d.system.warp.networkHealthy ? 'yes' : 'no'}`}. Connected does not mean all traffic uses WARP.`,
  ]
  if (d.system.proxy.error === 'not-applicable')
    lines.push(
      'System proxy: not applicable. This platform has no single system proxy setting; process proxies come from HTTPS_PROXY / ALL_PROXY.',
    )
  else lines.push(d.platform === 'darwin' ? 'macOS system proxy:' : 'System proxy:')
  for (const p of d.system.proxy.protocols)
    lines.push(
      `  ${p.protocol.toUpperCase()}: ${p.enabled ? 'on' : 'off'}${p.enabled && p.host ? ` (${p.host}${p.port ? `:${p.port}` : ''})` : ''}.`,
    )
  if (
    !d.system.proxy.protocols.length &&
    d.system.proxy.status !== 'available' &&
    d.system.proxy.error !== 'not-applicable'
  )
    lines.push(`  ${d.system.proxy.status}${d.system.proxy.error ? ` (${d.system.proxy.error})` : ''}.`)
  if (d.system.proxy.status === 'available') {
    lines.push(`  PAC: ${d.system.proxy.pacEnabled ? 'on' : 'off'} (URL omitted).`)
    lines.push(`  Auto discovery: ${d.system.proxy.autoDiscoveryEnabled ? 'on' : 'off'}.`)
  }
  if (d.system.proxy.exceptionCount !== undefined)
    lines.push(`  Exceptions: ${d.system.proxy.exceptionCount} (names omitted).`)
  lines.push(
    `DNS default resolver: ${d.system.dns.nameservers.join(', ') || d.system.dns.status}${d.system.dns.error ? ` (${d.system.dns.error})` : ''}; search domains omitted.`,
    `Default route: ${d.system.route.gateway || d.system.route.status}${d.system.route.interface ? ` on ${d.system.route.interface}` : ''}${d.system.route.error ? ` (${d.system.route.error})` : ''}.`,
    'Local proxy candidates (TCP port probes only; not process identities or upstream checks):',
  )
  for (const p of d.localProxyCandidates)
    lines.push(
      `  ${p.label}: ${p.protocol} ${p.host}:${p.port} ${p.reachable ? 'reachable' : 'not reachable'}${p.error ? ` (${p.error})` : ''}${p.processProxy ? `; ${p.processProxy} points here` : ''}.`,
    )
  for (const t of d.targets) {
    lines.push(`${new URL(t.url).hostname}: ${t.proxy}`)
    if (t.listener)
      lines.push(
        `  TCP listener ${t.listener.reachable ? 'reachable' : 'not reachable'} (${t.listener.host}:${t.listener.port}${t.listener.error ? `, ${t.listener.error}` : ''}).`,
      )
    else if (t.guardSupport !== 'direct')
      lines.push('  No local TCP listener probe (remote proxy, invalid address, or no explicit port).')
    if (t.guardSupport === 'unsupported')
      lines.push(
        '  Guard supports HTTP CONNECT only; configure an HTTP proxy or direct connection before an online check.',
      )
    else if (t.guardSupport === 'invalid')
      lines.push('  The proxy address is invalid; correct it in the environment, then start a new session.')
    lines.push(
      `  Guard cache: ${t.guard.status}${t.guard.loc ? `, ${t.guard.loc}` : ''}${t.guard.checkedAt ? `, checked ${t.guard.checkedAt}` : ', not checked yet'}${t.guard.error ? `, ${t.guard.error}` : ''}.`,
    )
  }
  if (!d.targets.length) lines.push('No Guard target was supplied.')
  lines.push('A reachable TCP listener does not prove that HTTP CONNECT, SOCKS or the upstream proxy works.')
  return lines.join('\n')
}

export async function runCli(
  args: readonly string[],
  deps: {
    env?: NetworkEnvironment
    diagnose?: (opts: DiagnoseNetworkOptions) => Promise<NetworkDiagnosis>
    write?: (text: string) => void
    error?: (text: string) => void
  } = {},
): Promise<number> {
  const write = deps.write ?? console.log
  const fail = deps.error ?? console.error
  if (args[0] !== 'diagnose' || args.length > 2 || (args.length === 2 && args[1] !== '--json')) {
    fail(USAGE)
    return 1
  }
  const result = await (deps.diagnose ?? diagnoseNetwork)({ env: deps.env ?? process.env, targets: [] })
  write(args[1] === '--json' ? JSON.stringify(result, null, 2) : formatNetworkDiagnosis(result))
  return 0
}
