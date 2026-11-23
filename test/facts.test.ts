import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diagnoseNetwork } from '../src/diagnose.ts'
import { networkDiagnoseTaskFacts } from '../src/facts.ts'
import { DIAGNOSIS } from './fixtures.ts'

describe('networkDiagnoseTaskFacts', () => {
  it('includes WARP, PAC, DNS, route, candidates and Guard limitations', () => {
    const facts = networkDiagnoseTaskFacts({
      checkedAt: '2026-11-23T01:00:00Z',
      platform: 'darwin',
      system: {
        warp: { status: 'available', state: 'connected', networkHealthy: true },
        proxy: {
          status: 'available',
          pacEnabled: true,
          autoDiscoveryEnabled: false,
          protocols: [
            { protocol: 'http', enabled: true, host: '127.0.0.1', port: 7897 },
            { protocol: 'https', enabled: true, host: 'private-proxy.example.com', port: 8080 },
            { protocol: 'socks', enabled: false },
          ],
          exceptionCount: 2,
        },
        dns: { status: 'available', nameservers: ['192.0.2.53', 'private-dns.example.com'] },
        route: { status: 'available', interface: 'en99', gateway: '192.0.2.1' },
      },
      localProxyCandidates: [
        { label: 'Clash mixed', protocol: 'HTTP / SOCKS', host: '127.0.0.1', port: 7897, reachable: true },
      ],
      targets: [
        {
          url: 'https://api.anthropic.com/cdn-cgi/trace',
          proxy: 'socks5://127.0.0.1:10808',
          guardSupport: 'unsupported',
          listener: { host: '127.0.0.1', port: 10808, reachable: false, error: 'ECONNREFUSED' },
          guard: {
            status: 'unknown',
            checkedAt: '2026-11-23T00:59:00Z',
            error: 'the connection was refused (is the proxy running?)',
          },
        },
      ],
    })
    const text = facts.join('\n')
    assert.match(text, /WARP: available, connected; Network healthy yes/)
    assert.match(text, /Connected does not mean all traffic uses WARP/)
    assert.match(text, /macOS system proxy: available; HTTP on 127\.0\.0\.1:7897; HTTPS on redacted:8080/)
    assert.match(text, /PAC on; automatic proxy discovery off; PAC URL omitted/)
    assert.match(text, /2 exceptions \(names omitted\)/)
    assert.match(text, /DNS default resolver: available; nameservers 192\.0\.2\.53/)
    assert.match(text, /Default route: available; gateway 192\.0\.2\.1; interface en99/)
    assert.match(text, /Local proxy candidate Clash mixed: HTTP \/ SOCKS TCP 127\.0\.0\.1:7897 reachable/)
    assert.match(text, /does not identify the process or prove upstream availability/)
    assert.match(text, /socks5:\/\/127\.0\.0\.1:10808/)
    assert.match(text, /ECONNREFUSED/)
    assert.match(text, /HTTP CONNECT/)
    assert.doesNotMatch(text, /@|private-proxy|private-dns/)
  })

  it('redacts target hosts, URLs, credentials and malformed error details', () => {
    const facts = networkDiagnoseTaskFacts({
      checkedAt: '2026-11-23T01:00:00Z',
      system: {
        warp: { status: 'error', state: 'unknown', error: 'raw private error' },
        proxy: {
          status: 'error',
          pacEnabled: false,
          autoDiscoveryEnabled: false,
          protocols: [],
          error: 'raw private error',
        },
        dns: { status: 'error', nameservers: [], error: 'raw private error' },
        route: { status: 'error', error: 'raw private error' },
      },
      localProxyCandidates: [],
      targets: [
        {
          url: 'https://private.example.com/cdn-cgi/trace',
          proxy: 'http://user:password@proxy.example.com:8080/private',
          guardSupport: 'http-connect',
          listener: null,
          guard: {
            status: 'unknown',
            error: 'visit https://user:password@private.example.com/a or mail a@b.example.com',
          },
        },
      ],
    })
    const text = facts.join('\n')
    assert.match(text, /Guard target: proxy http:\/\/redacted:8080/)
    assert.match(text, /; failed/)
    assert.doesNotMatch(text, /private\.example|proxy\.example|user|password|@|visit|mail/)
  })

  it('keeps invalid proxy routes distinct and accepts only bounded Guard fields', () => {
    const diagnosis = {
      ...JSON.parse(
        JSON.stringify({
          checkedAt: '2026-11-23T01:00:00Z',
          system: {
            warp: { status: 'unavailable', state: 'unknown' },
            proxy: { status: 'unavailable', pacEnabled: false, protocols: [] },
            dns: { status: 'unavailable', nameservers: [] },
            route: { status: 'unavailable' },
          },
          localProxyCandidates: [],
        }),
      ),
      targets: [
        {
          url: 'https://private.example.com/path',
          proxy: 'invalid',
          guardSupport: 'invalid',
          listener: null,
          guard: {
            status: 'unknown',
            loc: 'private-location',
            checkedAt: 'not-a-date',
            error: ['', 'Users', 'tester', 'private'].join('/'),
          },
        },
      ],
    }
    const text = networkDiagnoseTaskFacts(diagnosis).join('\n')
    assert.match(text, /Guard target: proxy invalid/)
    assert.doesNotMatch(text, /http:\/\/redacted|private-location|not-a-date|tester/)
  })

  it('formats a legacy target-only diagnosis with unavailable system facts', () => {
    const legacy = {
      checkedAt: '2026-11-23T01:00:00Z',
      targets: [{ url: 'https://api.anthropic.com/cdn-cgi/trace', guard: { status: 'not-checked' } }],
    }
    const facts = networkDiagnoseTaskFacts(
      legacy as unknown as Parameters<typeof networkDiagnoseTaskFacts>[0],
    )
    const text = facts.join('\n')
    assert.match(text, /WARP: unavailable, unknown/)
    assert.match(text, /^System proxy: unavailable/m)
    assert.doesNotMatch(text, /macOS/)
    assert.match(text, /api\.anthropic\.com: proxy not reported/)
    assert.match(text, /Guard not-checked, not checked yet/)
  })

  it('preserves canonical Guard reason codes and rejects inherited object keys', async () => {
    for (const [input, expected] of [
      ['ECONNREFUSED', 'connection-refused'],
      ['ENOTFOUND', 'lookup-failed'],
      ['connection-refused', 'connection-refused'],
      ['constructor', 'failed'],
    ]) {
      const diagnosis = await diagnoseNetwork({
        env: {},
        targets: [{ url: 'https://api.anthropic.com', guard: { status: 'unknown', error: input } }],
        system: { platform: 'win32' },
      })
      assert.equal(diagnosis.targets[0]!.guard.error, expected)
      const text = networkDiagnoseTaskFacts(diagnosis).join('\n')
      assert.match(text, new RegExp(`, ${expected}(?:\\n|$)`))
    }
  })

  it('names the Linux platform, explains the missing system proxy and marks the process proxy port', () => {
    const text = networkDiagnoseTaskFacts({
      ...DIAGNOSIS,
      platform: 'linux',
      system: {
        ...DIAGNOSIS.system,
        proxy: {
          status: 'unavailable',
          pacEnabled: false,
          autoDiscoveryEnabled: false,
          protocols: [],
          error: 'not-applicable',
        },
      },
      localProxyCandidates: [
        {
          label: 'Common v2rayN SOCKS port',
          protocol: 'HTTP',
          host: '127.0.0.1',
          port: 10808,
          reachable: true,
          processProxy: 'HTTPS_PROXY',
        },
      ],
    }).join('\n')
    assert.match(text, /^Platform: Linux$/m)
    assert.match(text, /^System proxy: not applicable on Linux; .*HTTPS_PROXY \/ ALL_PROXY$/m)
    assert.match(text, /10808 reachable; this is the port HTTPS_PROXY points at;/)
    assert.doesNotMatch(text, /macOS|unavailable; not-applicable/)
  })
})
