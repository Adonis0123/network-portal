// Proxy selection and redaction. This entry point deliberately loads no package code or non-built-in dependency.

export type NetworkEnvironment = Record<string, string | undefined>

function noProxyEntry(raw: string): { host: string; port?: string } | '*' | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  if (value === '*') return '*'
  let host = value
  let port: string | undefined
  if (value.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(value)
    if (!match) return null
    host = match[1]!
    port = match[2]
  } else {
    const colon = value.lastIndexOf(':')
    if (colon > 0 && value.indexOf(':') === colon && /^\d+$/.test(value.slice(colon + 1))) {
      host = value.slice(0, colon)
      port = value.slice(colon + 1)
    }
  }
  host = host.replace(/^\*?\./, '')
  if (port) {
    const numeric = Number(port)
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return null
    port = String(numeric)
  }
  if (host.includes(':')) {
    try {
      host = new URL(`http://[${host}]`).hostname.replace(/^\[|\]$/g, '')
    } catch {
      return null
    }
  }
  return host ? { host, ...(port ? { port } : {}) } : null
}

/** The proxy a request to `url` goes through under `env`, or null for a direct connection. */
export function proxyFor(url: string, env: NetworkEnvironment): string | null {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const port =
    parsed.port ||
    (parsed.protocol === 'https:' || parsed.protocol === 'wss:'
      ? '443'
      : parsed.protocol === 'http:' || parsed.protocol === 'ws:'
        ? '80'
        : '')
  const no = env.NO_PROXY ?? env.no_proxy ?? ''
  for (const raw of no.split(',')) {
    const entry = noProxyEntry(raw)
    if (!entry) continue
    if (entry === '*') return null
    if (entry.port && entry.port !== port) continue
    if (host === entry.host || host.endsWith(`.${entry.host}`)) return null
  }
  return processProxy(env)?.value ?? null
}

/** The process-wide proxy variable that wins, before any per-target `NO_PROXY` exclusion. */
export function processProxy(
  env: NetworkEnvironment,
): { variable: 'HTTPS_PROXY' | 'ALL_PROXY'; value: string } | null {
  const https = env.HTTPS_PROXY || env.https_proxy
  const value = https || env.ALL_PROXY || env.all_proxy
  return value ? { variable: https ? 'HTTPS_PROXY' : 'ALL_PROXY', value: value.trim() } : null
}

/** The selected route safe to show: scheme, hostname and port only, or `direct`; never credentials or a path. */
export function redactedProxy(proxy: string | null): string {
  if (!proxy) return 'direct'
  try {
    const parsed = new URL(proxy.includes('://') ? proxy : `http://${proxy}`)
    if (!parsed.hostname) return 'invalid'
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return 'invalid'
  }
}

/** The route `url` selects under `env`, safe for an error, diagnostic result or AI fact. */
export const routeLabel = (url: string, env: NetworkEnvironment): string => redactedProxy(proxyFor(url, env))
