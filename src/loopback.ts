import { isIP } from 'node:net'

/** Canonical numeric loopback, or null when connecting could resolve or reach another host. */
export function loopbackHost(raw: string): string | null {
  const host = raw === 'localhost' ? '127.0.0.1' : raw
  if (host === '::1') return host
  if (isIP(host) !== 4) return null
  const parts = host.split('.').map(Number)
  return parts[0] === 127 && parts.every((part) => part >= 0 && part <= 255) ? host : null
}

/** Both numeric families for localhost, without asking the resolver which one is available. */
export function loopbackHosts(raw: string): string[] {
  if (raw === 'localhost') return ['127.0.0.1', '::1']
  const host = loopbackHost(raw)
  return host ? [host] : []
}
