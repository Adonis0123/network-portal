import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseDefaultRoute,
  parseDns,
  parseSystemProxy,
  parseWarpStatus,
  readNetworkSystem,
} from '../src/system.ts'

describe('offline system details', () => {
  it('parses WARP connection and Network health without inferring full-tunnel routing', () => {
    assert.deepEqual(parseWarpStatus('Status update: Connected\nNetwork healthy\n'), {
      state: 'connected',
      networkHealthy: true,
    })
    assert.deepEqual(parseWarpStatus('Status update: Connected\nNetwork: healthy\n'), {
      state: 'connected',
      networkHealthy: true,
    })
    assert.deepEqual(parseWarpStatus('Status update: Connected\nNetwork: unhealthy\n'), {
      state: 'connected',
      networkHealthy: false,
    })
    assert.deepEqual(parseWarpStatus('Status update: Disconnected\nReason: unavailable\n'), {
      state: 'disconnected',
    })
    assert.deepEqual(parseWarpStatus('Status update: Connecting\nNetwork unhealthy\n'), {
      state: 'unknown',
      networkHealthy: false,
    })
  })

  it('parses switches, redacts non-loopback proxy hosts and counts exceptions without names', () => {
    const parsed = parseSystemProxy(`HTTPEnable : 1
HTTPProxy : 127.0.0.1
HTTPPort : 7897
HTTPSEnable : 1
HTTPSProxy : private-proxy.example.com
HTTPSPort : 8080
SOCKSEnable : 0
SOCKSProxy : ignored.example.com
ProxyAutoConfigEnable : 1
ExceptionsList : (
  0 : private.example.com
  1 : another.internal
)
ProxyAutoConfigURLString : https://private.example.com/config.pac
`)
    assert.deepEqual(parsed, {
      protocols: [
        { protocol: 'http', enabled: true, host: '127.0.0.1', port: 7897 },
        { protocol: 'https', enabled: true, host: 'redacted', port: 8080 },
        { protocol: 'socks', enabled: false },
      ],
      pacEnabled: true,
      autoDiscoveryEnabled: false,
      exceptionCount: 2,
    })
    assert.doesNotMatch(JSON.stringify(parsed), /private|ignored|config\.pac|@/)
  })

  it('counts PAC and indexed array exceptions without returning their domains', () => {
    const parsed = parseSystemProxy(`HTTPEnable : 0
HTTPSEnable : 0
SOCKSEnable : 0
ProxyAutoConfigEnable : 1
ProxyAutoConfigURLString : https://private.example.com/config.pac
ExceptionsList : <array> {
  0 : private.example.com
  1 : another.internal
  not-an-index : ignored.example.com
}
`)
    assert.equal(parsed.pacEnabled, true)
    assert.ok(parsed.protocols.every((p) => !p.enabled))
    assert.equal(parsed.exceptionCount, 2)
    assert.doesNotMatch(JSON.stringify(parsed), /private|another|ignored|config\.pac|@/)
  })

  it('accepts valid proxy dictionaries whose omitted switches mean off', () => {
    for (const output of [
      '<dict> {\n}\n',
      '<dictionary> {\n}\n',
      '<dictionary> {\n  ExceptionsList : <array> {\n  }\n}\n',
    ]) {
      const parsed = parseSystemProxy(output)
      assert.equal(parsed.pacEnabled, false)
      assert.equal(parsed.autoDiscoveryEnabled, false)
      assert.deepEqual(
        parsed.protocols.map((p) => ({ protocol: p.protocol, enabled: p.enabled })),
        [
          { protocol: 'http', enabled: false },
          { protocol: 'https', enabled: false },
          { protocol: 'socks', enabled: false },
        ],
      )
    }
  })

  it('recognizes automatic proxy discovery and rejects invalid known switch values', () => {
    const parsed = parseSystemProxy('<dictionary> {\n  ProxyAutoDiscoveryEnable : 1\n}\n')
    assert.equal(parsed.autoDiscoveryEnabled, true)
    assert.equal(parsed.pacEnabled, false)
    assert.throws(() => parseSystemProxy('<dictionary> {\n  HTTPEnable : unexpected\n}\n'), /invalid output/)
    assert.throws(
      () => parseSystemProxy('<dictionary> {\n  ProxyAutoConfigEnable : 2\n}\n'),
      /invalid output/,
    )
  })

  it('rejects malformed proxy, DNS and route output instead of claiming no configuration', async () => {
    assert.throws(() => parseSystemProxy(''), /invalid output/)
    assert.throws(() => parseSystemProxy('UnrelatedKey : 1'), /invalid output/)
    assert.throws(() => parseSystemProxy('<dictionary> {\n  not a valid row\n}\n'), /invalid output/)
    const info = await readNetworkSystem({
      platform: 'darwin',
      run: async (command) => (command === 'warp-cli' ? 'Status update: Connected\nNetwork: healthy\n' : ''),
    })
    for (const item of [info.proxy, info.dns, info.route]) {
      assert.equal(item.status, 'error')
      assert.equal(item.error, 'invalid-output')
    }
    assert.deepEqual(info.proxy.protocols, [])
    assert.deepEqual(info.dns.nameservers, [])
    assert.equal(info.route.gateway, undefined)
  })

  it('keeps only first-resolver nameservers and the default route', () => {
    const dns = parseDns(`DNS configuration

resolver #1
  search domain[0] : private.example.com
  nameserver[0] : 192.0.2.53
  nameserver[1] : 2001:db8::53

resolver #2
  nameserver[0] : 198.51.100.53
`)
    assert.deepEqual(dns, ['192.0.2.53', '2001:db8::53'])
    assert.deepEqual(
      parseDefaultRoute(
        '   route to: default\ndestination: default\n    gateway: 192.0.2.1\n  interface: en99\n',
      ),
      { gateway: '192.0.2.1', interface: 'en99' },
    )
  })

  it('uses fixed commands in parallel and degrades missing commands, errors and timeouts independently', async () => {
    const calls: string[] = []
    const info = await readNetworkSystem({
      platform: 'darwin',
      run: async (command, args, opts) => {
        calls.push(`${command} ${args.join(' ')}`)
        assert.equal(opts.timeoutMs, 900)
        assert.equal(opts.maxOutput, 32768)
        if (command === 'warp-cli') return 'Status update: Connected\nNetwork healthy\n'
        if (args[0] === '--proxy') return 'HTTPEnable : 0\nHTTPSEnable : 0\nSOCKSEnable : 0\n'
        if (args[0] === '--dns') return 'resolver #1\n  nameserver[0] : 192.0.2.53\n'
        return 'gateway: 192.0.2.1\ninterface: en99\n'
      },
    })
    assert.deepEqual(calls.sort(), [
      'route -n get default',
      'scutil --dns',
      'scutil --proxy',
      'warp-cli status',
    ])
    assert.equal(info.warp.state, 'connected')
    assert.equal(info.dns.nameservers[0], '192.0.2.53')
    assert.equal(info.route.interface, 'en99')

    const missing = await readNetworkSystem({
      platform: 'darwin',
      run: async (command) => {
        throw Object.assign(new Error('raw private output must not escape'), {
          code: command === 'warp-cli' ? 'ENOENT' : 'EACCES',
        })
      },
    })
    assert.deepEqual(missing.warp, { status: 'unavailable', state: 'unknown', error: 'not-installed' })
    assert.equal(missing.proxy.status, 'error')
    assert.equal(missing.proxy.error, 'EACCES')
    assert.doesNotMatch(JSON.stringify(missing), /raw|private|output|escape/)

    const timedOut = await readNetworkSystem({
      platform: 'darwin',
      run: (command) =>
        command === 'warp-cli'
          ? new Promise<string>(() => {})
          : Promise.reject(Object.assign(new Error('not returned'), { code: 'ENOENT' })),
    })
    assert.equal(timedOut.warp.status, 'error')
    assert.equal(timedOut.warp.error, 'timeout')
    assert.equal(timedOut.dns.status, 'unavailable')

    let nonMacCalls = 0
    const nonMac = await readNetworkSystem({
      platform: 'linux',
      run: async () => {
        nonMacCalls++
        return ''
      },
    })
    assert.equal(nonMacCalls, 0)
    assert.ok(Object.values(nonMac).every((item) => item.status === 'unavailable'))
  })
})
