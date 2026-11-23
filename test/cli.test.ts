import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runCli } from '../src/cli-core.ts'
import { DIAGNOSIS } from './fixtures.ts'

describe('network-portal diagnose CLI', () => {
  it('emits empty-target JSON through the injected offline diagnosis', async () => {
    let output = ''
    const d = { ...DIAGNOSIS, targets: [] }
    const code = await runCli(['diagnose', '--json'], {
      env: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      diagnose: async (opts) => {
        assert.deepEqual(opts.targets, [])
        assert.equal(opts.env.HTTPS_PROXY, 'http://127.0.0.1:7890')
        return d
      },
      write: (text) => {
        output = text
      },
    })
    assert.equal(code, 0)
    const parsed = JSON.parse(output)
    assert.equal(parsed.checkedAt, d.checkedAt)
    assert.deepEqual(parsed.system, d.system)
    assert.deepEqual(parsed.localProxyCandidates, d.localProxyCandidates)
    assert.deepEqual(parsed.targets, [])
  })

  it('shows automatic proxy discovery in the default text view', async () => {
    const d = structuredClone(DIAGNOSIS)
    d.targets = []
    d.system.proxy.autoDiscoveryEnabled = true
    let output = ''
    const code = await runCli(['diagnose'], {
      diagnose: async () => d,
      write: (text) => {
        output = text
      },
    })
    assert.equal(code, 0)
    assert.match(output, /Auto discovery: on/)
  })

  it('has a readable empty-target view and rejects other commands before diagnosis', async () => {
    let output = ''
    const code = await runCli(['diagnose'], {
      diagnose: async () => ({ ...DIAGNOSIS, targets: [] }),
      write: (text) => {
        output = text
      },
    })
    assert.equal(code, 0)
    assert.match(output, /no online trace was sent/)
    assert.match(output, /No Guard target was supplied/)

    let error = ''
    let called = false
    const bad = await runCli(['trace'], {
      diagnose: async () => {
        called = true
        return DIAGNOSIS
      },
      error: (text) => {
        error = text
      },
    })
    assert.equal(bad, 1)
    assert.equal(called, false)
    assert.equal(error, 'usage: network-portal diagnose [--json]')
  })

  it('explains the Linux system proxy and marks the process proxy port in the text view', async () => {
    const d = structuredClone(DIAGNOSIS)
    d.targets = []
    d.platform = 'linux'
    d.system.proxy = {
      status: 'unavailable',
      pacEnabled: false,
      autoDiscoveryEnabled: false,
      protocols: [],
      error: 'not-applicable',
    }
    d.localProxyCandidates[2]!.processProxy = 'HTTPS_PROXY'
    let output = ''
    await runCli(['diagnose'], {
      diagnose: async () => d,
      write: (text) => {
        output = text
      },
    })
    assert.match(output, /System proxy: not applicable\. .*HTTPS_PROXY \/ ALL_PROXY/)
    assert.match(output, /10808 not reachable \(timeout\); HTTPS_PROXY points here\./)
    assert.doesNotMatch(output, /macOS|unavailable \(not-applicable\)/)
    d.platform = 'darwin'
    d.system.proxy = structuredClone(DIAGNOSIS.system.proxy)
    await runCli(['diagnose'], {
      diagnose: async () => d,
      write: (text) => {
        output = text
      },
    })
    assert.match(output, /^macOS system proxy:$/m)
  })
})
