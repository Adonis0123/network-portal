import type { NetworkDiagnosis } from './diagnose.ts'

/**
 * Redacted, fixed facts for a Network diagnosis AI task. This function is embedded with toString(), so it must
 * remain self-contained and refer only to its parameter and local helpers.
 */
export function networkDiagnoseTaskFacts(d: NetworkDiagnosis): string[] {
  const code = (value: string | undefined) =>
    value && /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : value ? 'failed' : ''
  const guardCode = (value: string | undefined) => {
    if (!value) return ''
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
    if (Object.hasOwn(known, value)) return known[value]
    if (value.startsWith('HTTP ')) return 'http-error'
    if (value.startsWith('the proxy')) return 'proxy-error'
    return 'failed'
  }
  const local = (value: string) => {
    if (value === 'localhost' || value === '::1') return true
    const parts = value.split('.')
    return (
      parts.length === 4 &&
      parts[0] === '127' &&
      parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
    )
  }
  const ip = (value: string | undefined) =>
    Boolean(value && (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9A-Fa-f:]+$/.test(value)))
  const checked = (value: string | undefined) =>
    value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : ''
  const out = [`diagnosed: ${d.checkedAt} (offline; no trace sent)`]
  // A host can retain the original target-only Runtime DTO while the portal gains system probes.
  const system = d.system || {
    warp: { status: 'unavailable', state: 'unknown' },
    proxy: { status: 'unavailable', pacEnabled: false, autoDiscoveryEnabled: false, protocols: [] },
    dns: { status: 'unavailable', nameservers: [] },
    route: { status: 'unavailable' },
  }
  const warp = system.warp
  out.push(
    `WARP: ${warp.status}, ${warp.state}${warp.networkHealthy === undefined ? '' : `; Network healthy ${warp.networkHealthy ? 'yes' : 'no'}`}${code(warp.error) ? `; ${code(warp.error)}` : ''}; Connected does not mean all traffic uses WARP`,
  )
  const proxy = system.proxy
  const protocols = proxy.protocols
    .map((p) => {
      const host = p.host && local(p.host) ? p.host : p.host ? 'redacted' : ''
      return `${p.protocol.toUpperCase()} ${p.enabled ? 'on' : 'off'}${p.enabled && host ? ` ${host}${p.port ? `:${p.port}` : ''}` : ''}`
    })
    .join('; ')
  const pac =
    proxy.status === 'available'
      ? `; PAC ${proxy.pacEnabled ? 'on' : 'off'}; automatic proxy discovery ${proxy.autoDiscoveryEnabled ? 'on' : 'off'}; PAC URL omitted`
      : ''
  out.push(
    `macOS system proxy: ${proxy.status}${protocols ? `; ${protocols}` : ''}${pac}${proxy.exceptionCount === undefined ? '' : `; ${proxy.exceptionCount} exceptions (names omitted)`}${code(proxy.error) ? `; ${code(proxy.error)}` : ''}`,
  )
  const nameservers = system.dns.nameservers.filter(ip)
  out.push(
    `DNS default resolver: ${system.dns.status}${nameservers.length ? `; nameservers ${nameservers.join(', ')}` : '; no nameservers returned'}${code(system.dns.error) ? `; ${code(system.dns.error)}` : ''}; search domains omitted`,
  )
  const route = system.route
  const iface = route.interface && /^[A-Za-z0-9_.-]{1,64}$/.test(route.interface) ? route.interface : ''
  out.push(
    `Default route: ${route.status}${ip(route.gateway) ? `; gateway ${route.gateway}` : ''}${iface ? `; interface ${iface}` : ''}${code(route.error) ? `; ${code(route.error)}` : ''}`,
  )
  for (const p of d.localProxyCandidates || []) {
    out.push(
      `Local proxy candidate ${p.label}: ${p.protocol} TCP ${local(p.host) ? p.host : 'redacted'}:${p.port} ${p.reachable ? 'reachable' : 'not reachable'}${code(p.error) ? ` (${code(p.error)})` : ''}; a port probe does not identify the process or prove upstream availability`,
    )
  }
  for (const t of d.targets) {
    let host = 'Guard target'
    try {
      const parsedHost = new URL(t.url).hostname
      if (parsedHost === 'api.anthropic.com' || parsedHost === 'chatgpt.com') host = parsedHost
    } catch {
      // Keep the generic target name.
    }
    let selectedProxy = t.proxy ? 'invalid' : 'not reported'
    if (t.proxy === 'direct') selectedProxy = 'direct'
    else if (t.proxy && t.proxy !== 'invalid')
      try {
        const parsed = new URL(t.proxy.includes('://') ? t.proxy : `http://${t.proxy}`)
        const bare = parsed.hostname.startsWith('[') ? parsed.hostname.slice(1, -1) : parsed.hostname
        const safeHost = local(bare) ? parsed.hostname : 'redacted'
        selectedProxy = `${parsed.protocol}//${safeHost}${parsed.port ? `:${parsed.port}` : ''}`
      } catch {
        // Invalid remains invalid.
      }
    const listenerHost = t.listener && local(t.listener.host) ? t.listener.host : 'redacted'
    const listener = t.listener
      ? `TCP ${listenerHost}:${t.listener.port} ${t.listener.reachable ? 'reachable' : 'not reachable'}${code(t.listener.error) ? ` (${code(t.listener.error)})` : ''}; this does not prove the proxy protocol works`
      : t.guardSupport === 'direct'
        ? 'direct; no proxy TCP listener to test'
        : 'no local TCP listener probe (remote proxy, invalid address, or no explicit port)'
    const support =
      t.guardSupport === 'unsupported'
        ? '; Guard does not support this proxy scheme; configure HTTP CONNECT or direct before an online check'
        : t.guardSupport === 'invalid'
          ? '; proxy address invalid; correct it and start a new session'
          : ''
    const status = ['ok', 'blocked', 'unknown', 'not-checked'].includes(t.guard.status)
      ? t.guard.status
      : 'unknown'
    const loc = t.guard.loc && /^[A-Za-z]{2}$/.test(t.guard.loc) ? t.guard.loc.toUpperCase() : ''
    const checkedAt = checked(t.guard.checkedAt)
    out.push(
      `${host}: proxy ${selectedProxy}; ${listener}${support}; Guard ${status}${loc ? `, country ${loc}` : ''}${checkedAt ? `, checked ${checkedAt}` : ', not checked yet'}${guardCode(t.guard.error) ? `, ${guardCode(t.guard.error)}` : ''}`,
    )
  }
  return out.map((line) => line.replace(/@/g, '[at]'))
}
