import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseDefaultRoute,
  parseDns,
  parseLinuxDefaultRoute,
  parseResolvConf,
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
      platform: 'win32',
      run: async () => {
        nonMacCalls++
        return ''
      },
    })
    assert.equal(nonMacCalls, 0)
    assert.ok(Object.values(nonMac).every((item) => item.status === 'unavailable'))
  })

  it('keeps only the first Linux default route and a valid gateway and interface', () => {
    assert.deepEqual(
      parseLinuxDefaultRoute(
        'default via 192.0.2.1 dev eth0 proto kernel \ndefault via 198.51.100.1 dev eth3 proto kernel metric 35 \n',
      ),
      { gateway: '192.0.2.1', interface: 'eth0' },
    )
    assert.deepEqual(parseLinuxDefaultRoute('default via 2001:db8::1 dev wlan0 metric 600\n'), {
      gateway: '2001:db8::1',
      interface: 'wlan0',
    })
    assert.deepEqual(parseLinuxDefaultRoute('default dev wg0 scope link\n'), { interface: 'wg0' })
    assert.deepEqual(parseLinuxDefaultRoute('default via gateway.example.com dev eth0\n'), {
      interface: 'eth0',
    })
    assert.deepEqual(
      parseLinuxDefaultRoute(
        'default proto static metric 100\n\tnexthop via 192.0.2.1 dev eth0 weight 1\n\tnexthop via 192.0.2.9 dev eth1 weight 1\n192.0.2.0/24 dev eth0\n',
      ),
      { interface: 'eth0', gateway: '192.0.2.1' },
    )
    for (const output of ['', '192.0.2.0/24 dev eth0 scope link\n', 'default via example dev bad/name\n'])
      assert.throws(() => parseLinuxDefaultRoute(output), /invalid output/)
  })

  it('returns at most eight unique resolv.conf nameserver addresses and nothing else', () => {
    const many = Array.from({ length: 10 }, (_, i) => `nameserver 192.0.2.${i + 1}`).join('\n')
    assert.equal(parseResolvConf(many).length, 8)
    assert.deepEqual(
      parseResolvConf(`# nameserver 203.0.113.9
search corp.example.com
options edns0
nameserver 192.0.2.53
  nameserver\t2001:db8::53 # trailing note
nameserver 192.0.2.53
nameserver dns.example.com
nameserver fe80::1%eth0
`),
      ['192.0.2.53', '2001:db8::53'],
    )
    assert.throws(() => parseResolvConf('search corp.example.com\n'), /invalid output/)
  })

  it('reads Linux route, resolv.conf and WARP, and marks the system proxy not applicable', async () => {
    const calls: string[] = []
    const reads: { path: string; maxBytes: number }[] = []
    const info = await readNetworkSystem({
      platform: 'linux',
      run: async (command, args, opts) => {
        calls.push(`${command} ${args.join(' ')}`)
        assert.equal(opts.timeoutMs, 900)
        assert.equal(opts.maxOutput, 32768)
        if (command === 'warp-cli') return 'Status update: Disconnected\n'
        return 'default via 192.0.2.1 dev eth0 proto kernel\n'
      },
      readFile: async (path, opts) => {
        reads.push({ path, ...opts })
        return 'search corp.example.com\nnameserver 192.0.2.53\n'
      },
    })
    assert.deepEqual(calls.sort(), ['ip route show default', 'warp-cli status'])
    assert.deepEqual(reads, [{ path: '/etc/resolv.conf', maxBytes: 32768 }])
    assert.deepEqual(info, {
      warp: { status: 'available', state: 'disconnected' },
      proxy: {
        status: 'unavailable',
        pacEnabled: false,
        autoDiscoveryEnabled: false,
        protocols: [],
        error: 'not-applicable',
      },
      dns: { status: 'available', nameservers: ['192.0.2.53'] },
      route: { status: 'available', gateway: '192.0.2.1', interface: 'eth0' },
    })
    assert.doesNotMatch(JSON.stringify(info), /corp/)

    const failing = await readNetworkSystem({
      platform: 'linux',
      run: async (command) => {
        throw Object.assign(new Error('raw details'), { code: command === 'warp-cli' ? 'ENOENT' : 1 })
      },
      readFile: () => new Promise<string>(() => {}),
    })
    assert.deepEqual(failing.warp, { status: 'unavailable', state: 'unknown', error: 'not-installed' })
    assert.deepEqual(failing.route, { status: 'error', error: 'exit-1' })
    assert.deepEqual(failing.dns, { status: 'error', nameservers: [], error: 'timeout' })
    assert.equal(failing.proxy.error, 'not-applicable')
  })
})
