import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { diagnoseNetwork, probeListener } from '../src/diagnose.ts'

const now = () => new Date('2026-11-23T10:00:00.000Z')
const target = { url: 'https://api.example.com/cdn-cgi/trace' }

describe('diagnoseNetwork', () => {
  it('returns system facts, three candidates and no targets without reading host state', async () => {
    const d = await diagnoseNetwork({
      env: {},
      targets: [],
      now,
      probe: async () => ({ reachable: false, error: 'ECONNREFUSED' }),
      system: { platform: 'win32' },
    })
    assert.equal(d.checkedAt, '2026-11-23T10:00:00.000Z')
    assert.deepEqual(d.targets, [])
    assert.deepEqual(
      d.localProxyCandidates.map((p) => p.port),
      [7897, 7890, 10808],
    )
    assert.equal(d.system.route.status, 'unavailable')
  })

  it('keeps supplied cached Guard facts and uses direct without a listener', async () => {
    const d = await diagnoseNetwork({
      env: {},
      targets: [{ ...target, guard: { status: 'ok', loc: 'US', checkedAt: '2026-11-23T09:00:00Z' } }, target],
      now,
      probe: async () => ({ reachable: false }),
      system: { platform: 'win32' },
    })
    assert.equal(d.targets[0]!.guard.status, 'ok')
    assert.equal(d.targets[0]!.guard.loc, 'US')
    assert.deepEqual(d.targets[1]!.guard, { status: 'not-checked' })
    assert.ok(
      d.targets.every((t) => t.proxy === 'direct' && t.guardSupport === 'direct' && t.listener === null),
    )
  })

  it('supports HTTP CONNECT, marks SOCKS unsupported and probes only loopback listeners', async () => {
    const cases = [
      {
        proxy: 'http://user:password@proxy.example.com:8080/private?token=secret',
        wantProxy: 'http://proxy.example.com:8080',
        support: 'http-connect',
        probe: null,
      },
      {
        proxy: 'user:password@127.0.0.1:10809/private?token=secret',
        wantProxy: 'http://127.0.0.1:10809',
        support: 'http-connect',
        probe: { host: '127.0.0.1', port: 10809 },
      },
      { proxy: 'socks5://127.0.0.1', wantProxy: 'socks5://127.0.0.1', support: 'unsupported', probe: null },
      {
        proxy: 'https://proxy.example.com',
        wantProxy: 'https://proxy.example.com',
        support: 'unsupported',
        probe: null,
      },
      {
        proxy: 'http://[::1]:10809',
        wantProxy: 'http://[::1]:10809',
        support: 'http-connect',
        probe: { host: '::1', port: 10809 },
      },
    ] as const
    for (const item of cases) {
      const probes: { host: string; port: number; timeout: number }[] = []
      const d = await diagnoseNetwork({
        env: { HTTPS_PROXY: item.proxy },
        targets: [target],
        now,
        probe: async (host, port, timeout) => {
          probes.push({ host, port, timeout })
          return { reachable: true }
        },
        system: { platform: 'win32' },
      })
      assert.equal(d.targets[0]!.proxy, item.wantProxy)
      assert.equal(d.targets[0]!.guardSupport, item.support)
      if (item.probe) {
        assert.equal(
          probes.filter((p) => p.port === item.probe!.port).length,
          Number(item.probe.port) === 10808 ? 2 : 1,
        )
        assert.deepEqual(d.targets[0]!.listener, { ...item.probe, reachable: true })
        assert.ok(probes.every((p) => p.timeout === 700))
      } else {
        assert.deepEqual(
          probes.map((p) => p.port).sort((a, b) => a - b),
          [7890, 7897, 10808],
        )
        assert.equal(d.targets[0]!.listener, null)
      }
      assert.doesNotMatch(JSON.stringify(d), /user|password|private|token|secret/)
    }
  })

  it('labels invalid proxies and sanitizes thrown or malformed probe errors', async () => {
    const invalid = await diagnoseNetwork({
      env: { HTTPS_PROXY: 'http://not a host' },
      targets: [target],
      probe: async () => {
        throw new Error('private raw socket error')
      },
      system: { platform: 'win32' },
    })
    assert.equal(invalid.targets[0]!.guardSupport, 'invalid')
    assert.equal(invalid.targets[0]!.listener, null)
    assert.ok(invalid.localProxyCandidates.every((p) => p.error === 'failed'))

    const malformed = await diagnoseNetwork({
      env: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      targets: [target],
      probe: async () => ({ reachable: false, error: 'private raw socket error' }),
      system: { platform: 'win32' },
    })
    assert.equal(malformed.targets[0]!.listener!.error, 'failed')
    assert.doesNotMatch(JSON.stringify(malformed), /private|raw|socket/)
  })

  it('refuses public listener probes for non-loopback or invalid hosts', async () => {
    for (const host of ['example.com', '127.0.0.1.example.com', '127.999.0.1', '192.0.2.1', '::2']) {
      assert.deepEqual(await probeListener(host, 80, 10), { reachable: false, error: 'invalid-host' })
    }
  })

  it('checks both numeric loopback families for localhost and reports the reachable address', async () => {
    const hosts: string[] = []
    const d = await diagnoseNetwork({
      env: { HTTPS_PROXY: 'http://localhost:7891' },
      targets: [target],
      now,
      probe: async (host, port) => {
        if (port === 7891) hosts.push(host)
        return host === '::1' && port === 7891
          ? { reachable: true }
          : { reachable: false, error: 'ECONNREFUSED' }
      },
      system: { platform: 'win32' },
    })
    assert.deepEqual(hosts.sort(), ['127.0.0.1', '::1'])
    assert.deepEqual(d.targets[0]!.listener, { host: '::1', port: 7891, reachable: true })
  })

  it('projects target URLs and Guard facts through a strict safe DTO boundary', async () => {
    const guard = {
      status: 'unknown' as const,
      loc: 'private-location',
      checkedAt: 'not-a-date',
      error: 'syntheticCredential123',
      account: 'private-account',
    }
    const d = await diagnoseNetwork({
      env: {},
      targets: [
        { url: 'https://user:password@private.example.com/path?token=secret#fragment', guard },
        { url: 'https://api.example.com/private/path', guard: { status: 'unknown', error: 'timeout' } },
        {
          url: 'https://api.example.com/private/path',
          guard: { status: 'unknown', error: 'the connection was refused (is the proxy running?)' },
        },
      ],
      now,
      probe: async () => ({ reachable: false }),
      system: { platform: 'win32' },
    })
    assert.equal(d.targets[0]!.url, 'https://private.example.com')
    assert.deepEqual(d.targets[0]!.guard, { status: 'unknown', error: 'failed' })
    assert.equal(d.targets[1]!.url, 'https://api.example.com')
    assert.equal(d.targets[1]!.guard.error, 'timeout')
    assert.equal(d.targets[2]!.guard.error, 'connection-refused')
    const json = JSON.stringify(d)
    assert.doesNotMatch(
      json,
      /user|password|token|secret|fragment|private-location|tester|private-account|syntheticCredential|private\/path/,
    )
  })

  it('marks the common port that the process proxy points at and labels the rest as common ports', async () => {
    const run = async (env: Record<string, string>) =>
      diagnoseNetwork({
        env,
        targets: [],
        now,
        probe: async () => ({ reachable: true }),
        system: { platform: 'win32' },
      })
    const https = await run({ HTTPS_PROXY: 'http://127.0.0.1:10808', ALL_PROXY: 'socks5://127.0.0.1:7897' })
    assert.deepEqual(
      https.localProxyCandidates.map((p) => [p.label, p.protocol, p.processProxy]),
      [
        ['Common Clash Verge mixed port', 'HTTP / SOCKS', undefined],
        ['Common Clash HTTP port', 'HTTP', undefined],
        ['Common v2rayN SOCKS port', 'HTTP', 'HTTPS_PROXY'],
      ],
    )
    const all = await run({ all_proxy: 'socks5h://localhost:7897', NO_PROXY: '*' })
    assert.equal(all.localProxyCandidates[0]!.processProxy, 'ALL_PROXY')
    assert.equal(all.localProxyCandidates[0]!.protocol, 'SOCKS5H')
    const envs: Record<string, string>[] = [
      { HTTPS_PROXY: 'http://192.0.2.1:10808' },
      { HTTPS_PROXY: 'http://127.0.0.1' },
      { HTTPS_PROXY: 'http://[::1]:10808' },
      { HTTPS_PROXY: 'http://127.0.0.2:10808' },
      {},
    ]
    for (const env of envs) {
      const d = await run(env)
      assert.ok(d.localProxyCandidates.every((p) => p.processProxy === undefined))
      assert.equal(d.localProxyCandidates[2]!.protocol, 'SOCKS')
    }
  })

  it('reports the platform family that produced the system facts', async () => {
    const base = { env: {}, targets: [], now, probe: async () => ({ reachable: false }) }
    assert.equal((await diagnoseNetwork({ ...base, system: { platform: 'win32' } })).platform, 'other')
    const linux = await diagnoseNetwork({
      ...base,
      system: {
        platform: 'linux',
        run: async (command) => {
          if (command === 'ip') return 'default via 192.0.2.1 dev eth0\n'
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
        readFile: async () => 'nameserver 192.0.2.53\n',
      },
    })
    assert.equal(linux.platform, 'linux')
    assert.equal(linux.system.route.status, 'available')
    assert.equal(linux.system.proxy.error, 'not-applicable')
  })
})
