import type { NetworkDiagnosis } from '../src/diagnose.ts'

export const DIAGNOSIS: NetworkDiagnosis = {
  checkedAt: '2026-11-23T10:00:00.000Z',
  system: {
    warp: { status: 'available', state: 'connected', networkHealthy: true },
    proxy: {
      status: 'available',
      pacEnabled: true,
      autoDiscoveryEnabled: false,
      protocols: [
        { protocol: 'http', enabled: true, host: '127.0.0.1', port: 7897 },
        { protocol: 'https', enabled: false },
        { protocol: 'socks', enabled: true, host: 'redacted', port: 1080 },
      ],
      exceptionCount: 3,
    },
    dns: { status: 'available', nameservers: ['192.0.2.53', '2001:db8::53'] },
    route: { status: 'available', interface: 'en99', gateway: '192.0.2.1' },
  },
  localProxyCandidates: [
    { label: 'Clash mixed', protocol: 'HTTP / SOCKS', host: '127.0.0.1', port: 7897, reachable: true },
    {
      label: 'Clash HTTP',
      protocol: 'HTTP',
      host: '127.0.0.1',
      port: 7890,
      reachable: false,
      error: 'ECONNREFUSED',
    },
    {
      label: 'v2rayN SOCKS',
      protocol: 'SOCKS',
      host: '127.0.0.1',
      port: 10808,
      reachable: false,
      error: 'timeout',
    },
  ],
  targets: [
    {
      url: 'https://api.example.com/cdn-cgi/trace',
      proxy: 'http://127.0.0.1:7890',
      guardSupport: 'http-connect',
      listener: { host: '127.0.0.1', port: 7890, reachable: true },
      guard: { status: 'ok', loc: 'US', checkedAt: '2026-11-23T09:00:00.000Z' },
    },
    {
      url: 'https://other.example.com/cdn-cgi/trace',
      proxy: 'socks5://127.0.0.1:1080',
      guardSupport: 'unsupported',
      listener: null,
      guard: { status: 'not-checked' },
    },
  ],
}
