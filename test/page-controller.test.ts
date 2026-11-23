import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import type { NetworkDiagnosis } from '../src/diagnose.ts'
import { networkDiagnoseTaskFacts } from '../src/facts.ts'
import { NETWORK_PAGE_SCRIPT, networkPageController } from '../src/page-script.ts'
import { DIAGNOSIS } from './fixtures.ts'

async function controller(api: (path: string, body: unknown) => Promise<unknown>) {
  const ctx: { make?: typeof networkPageController } = {}
  Object.assign(ctx, { AbortController })
  runInNewContext(`${networkPageController.toString()}; this.make = networkPageController`, ctx)
  return ctx.make!({ api, facts: networkDiagnoseTaskFacts, version: '1.2.3', lang: 'en' })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('Network page controller', () => {
  it('starts with offline diagnosis only and renders empty and error states', async () => {
    const paths: string[] = []
    const c = await controller(async (path) => {
      paths.push(path)
      if (path === '/api/network/diagnose')
        return {
          checkedAt: DIAGNOSIS.checkedAt,
          system: DIAGNOSIS.system,
          localProxyCandidates: [],
          targets: [],
        }
      throw new Error(`unexpected ${path}`)
    })
    await c.start()
    assert.deepEqual(paths, ['/api/network/diagnose'])
    assert.deepEqual(c.state.diagnosis!.targets, [])
    const failed = await controller(async () => {
      throw new Error('offline failed')
    })
    await failed.start()
    assert.equal(failed.state.error, 'offline failed')
  })

  it('coalesces concurrent diagnosis requests', async () => {
    const pending = deferred<NetworkDiagnosis>()
    let calls = 0
    const c = await controller(async () => {
      calls++
      return pending.promise
    })
    const first = c.diagnose()
    const second = c.diagnose()
    assert.equal(c.state.loading, true)
    pending.resolve(DIAGNOSIS)
    await Promise.all([first, second])
    assert.equal(calls, 1)
    assert.equal(c.state.loading, false)
    assert.equal(c.state.diagnosis, DIAGNOSIS)
  })

  it('counts PAC as an enabled system proxy in the overview', () => {
    const start = NETWORK_PAGE_SCRIPT.indexOf('function renderOverview(diagnosis)')
    const end = NETWORK_PAGE_SCRIPT.indexOf('function renderSystemDetails', start)
    const diagnosis = {
      ...DIAGNOSIS,
      system: {
        ...DIAGNOSIS.system,
        proxy: {
          ...DIAGNOSIS.system.proxy,
          pacEnabled: true,
          protocols: DIAGNOSIS.system.proxy.protocols.map((p) => ({ protocol: p.protocol, enabled: false })),
        },
      },
    }
    const ctx: { render?: (d: NetworkDiagnosis) => { value: string; chipText: string }[] } = {}
    Object.assign(ctx, {
      t: (key: string, vars?: { count?: number }) =>
        key === 'proxyEnabled' ? `enabled ${vars?.count}` : key,
      probeLabel: () => '',
      overviewCard: (label: string, value: string, detail: string, chipText: string, chipClass: string) => ({
        label,
        value,
        detail,
        chipText,
        chipClass,
      }),
    })
    runInNewContext(`${NETWORK_PAGE_SCRIPT.slice(start, end)}; this.render = renderOverview`, ctx)
    const proxy = ctx.render!(diagnosis)[1]!
    assert.equal(proxy.value, 'enabled 1')
    assert.equal(proxy.chipText, 'on')
  })

  it('does not mark an unhealthy connected WARP overview as ok', () => {
    const start = NETWORK_PAGE_SCRIPT.indexOf('function renderOverview(diagnosis)')
    const end = NETWORK_PAGE_SCRIPT.indexOf('function renderSystemDetails', start)
    const diagnosis = {
      ...DIAGNOSIS,
      system: { ...DIAGNOSIS.system, warp: { ...DIAGNOSIS.system.warp, networkHealthy: false } },
    }
    const ctx: { render?: (d: NetworkDiagnosis) => { chipClass: string }[] } = {}
    Object.assign(ctx, {
      t: (key: string) => key,
      probeLabel: () => '',
      overviewCard: (label: string, value: string, detail: string, chipText: string, chipClass: string) => ({
        label,
        value,
        detail,
        chipText,
        chipClass,
      }),
    })
    runInNewContext(`${NETWORK_PAGE_SCRIPT.slice(start, end)}; this.render = renderOverview`, ctx)
    assert.equal(ctx.render!(diagnosis)[0]!.chipClass, '')
  })

  it('clears target-list busy state after the first diagnosis completes', () => {
    const start = NETWORK_PAGE_SCRIPT.indexOf('function renderMain()')
    const end = NETWORK_PAGE_SCRIPT.indexOf('function renderAsk()', start)
    const source = NETWORK_PAGE_SCRIPT.slice(start, end)
    const element = () => ({
      attrs: {} as Record<string, string>,
      children: [] as unknown[],
      textContent: '',
      hidden: false,
      disabled: false,
      append(...children: unknown[]) {
        this.children.push(...children)
      },
      setAttribute(name: string, value: string) {
        this.attrs[name] = value
      },
    })
    const elements = new Map<string, ReturnType<typeof element>>()
    const targets = element()
    targets.attrs['aria-busy'] = 'true'
    elements.set('targets', targets)
    const state: { diagnosis: NetworkDiagnosis | null; loading: boolean } = { diagnosis: null, loading: true }
    const ctx: { render?: () => void } = {}
    Object.assign(ctx, {
      BOOT: { lang: 'zh', title: 'Network' },
      lang: 'zh',
      controller: { state },
      document: { documentElement: {}, title: '' },
      $: (id: string) => {
        if (!elements.has(id)) elements.set(id, element())
        return elements.get(id)
      },
      t: (key: string) => key,
      h: () => ({}),
      placeholder: () => ({}),
      fillRegion: () => {},
      renderOverview: () => [],
      renderSystemDetails: () => [],
      candidateCard: () => ({}),
      targetCard: () => ({}),
      clear: (el: ReturnType<typeof element>) => {
        el.children = []
      },
    })
    runInNewContext(`${source}; this.render = renderMain`, ctx)
    ctx.render!()
    assert.equal(targets.attrs['aria-busy'], 'true')
    state.diagnosis = {
      checkedAt: DIAGNOSIS.checkedAt,
      system: DIAGNOSIS.system,
      localProxyCandidates: [],
      targets: [],
    }
    state.loading = false
    ctx.render!()
    assert.equal(targets.attrs['aria-busy'], 'false')
  })

  it('shows the actual prompt and sends only fixed redacted facts', async () => {
    const bodies: unknown[] = []
    const c = await controller(async (path, body) => {
      bodies.push(body)
      if (path === '/api/network/diagnose') return DIAGNOSIS
      if (path === '/api/ask/prompt') return { prompt: 'actual complete prompt\nline two' }
      throw new Error(`unexpected ${path}`)
    })
    await c.start()
    await c.openAsk()
    assert.equal(c.state.ask!.prompt, 'actual complete prompt\nline two')
    const body = bodies[1] as Record<string, unknown>
    assert.equal(body.task, 'network-diagnose')
    assert.equal(body.text, undefined)
    assert.equal(body.attachments, undefined)
    assert.equal(body.account, undefined)
    assert.equal(body.family, undefined)
    assert.deepEqual(JSON.parse(JSON.stringify(body.context)), {
      networkDiagnose: networkDiagnoseTaskFacts(DIAGNOSIS),
      version: '1.2.3',
    })
    assert.equal(JSON.stringify(body).includes('password'), false)
  })

  it('requires confirmation again when the second prompt differs', async () => {
    let prompts = 0
    let asks = 0
    const bodies: unknown[] = []
    const c = await controller(async (path, body) => {
      if (path === '/api/network/diagnose') return DIAGNOSIS
      if (path === '/api/ask/prompt') {
        bodies.push(body)
        prompts++
        return { prompt: prompts === 1 ? 'first prompt' : 'changed prompt' }
      }
      if (path === '/api/ask') {
        asks++
        return { opened: true }
      }
      throw new Error(`unexpected ${path}`)
    })
    await c.start()
    await c.openAsk()
    await c.confirmAsk()
    assert.equal(asks, 0)
    assert.equal(c.state.ask!.prompt, 'changed prompt')
    assert.equal(c.state.ask!.promptChanged, true)
    assert.deepEqual(bodies[0], bodies[1])
  })

  it('submits an identical second prompt and keeps the copy-command fallback', async () => {
    const bodies: unknown[] = []
    const c = await controller(async (path, body) => {
      if (path === '/api/network/diagnose') return DIAGNOSIS
      if (path === '/api/ask/prompt') {
        bodies.push(body)
        return { prompt: 'same prompt' }
      }
      if (path === '/api/ask') {
        bodies.push(body)
        return { opened: false, command: 'example-agent run' }
      }
      throw new Error(`unexpected ${path}`)
    })
    await c.start()
    await c.openAsk()
    await c.confirmAsk()
    assert.equal(c.state.ask!.result!.opened, false)
    assert.equal(c.state.ask!.result!.command, 'example-agent run')
    assert.deepEqual(bodies[0], bodies[1])
    assert.deepEqual(JSON.parse(JSON.stringify(bodies[2])), {
      ...JSON.parse(JSON.stringify(bodies[1])),
      confirmedPrompt: 'same prompt',
    })
  })

  it('does not call ask when the dialog closes during the delayed second check', async () => {
    let prompts = 0
    let asks = 0
    const second = deferred<{ prompt: string }>()
    const c = await controller(async (path) => {
      if (path === '/api/network/diagnose') return DIAGNOSIS
      if (path === '/api/ask/prompt') {
        prompts++
        return prompts === 1 ? { prompt: 'same prompt' } : second.promise
      }
      if (path === '/api/ask') {
        asks++
        return { opened: true }
      }
      throw new Error(`unexpected ${path}`)
    })
    await c.start()
    await c.openAsk()
    const confirming = c.confirmAsk()
    await new Promise<void>((r) => setImmediate(r))
    assert.equal(prompts, 2)
    c.closeAsk()
    second.resolve({ prompt: 'same prompt' })
    await confirming
    assert.equal(asks, 0)
    assert.equal(c.state.ask, null)
  })

  it('does not retry ask after the dialog closes during token refresh', async () => {
    const start = NETWORK_PAGE_SCRIPT.indexOf('let token = BOOT.token;')
    const end = NETWORK_PAGE_SCRIPT.indexOf('const dialog =', start)
    const session = deferred<{ token: string }>()
    const sessionStarted = deferred<void>()
    let asks = 0
    const response = (status: number, data: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    })
    const ctx: {
      api?: (path: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
    } = {}
    Object.assign(ctx, {
      BOOT: { token: 'old-token', basePath: '', tokenHeader: 'x-test-token' },
      t: () => 'request failed',
      fetch: async (url: string, options: { mode?: string; redirect?: string }) => {
        assert.equal(options.mode, 'same-origin')
        assert.equal(options.redirect, 'error')
        if (url === '/api/session') {
          sessionStarted.resolve()
          return response(200, await session.promise)
        }
        if (url === '/api/ask') {
          asks++
          return response(403, { error: 'bad token', code: 'bad-token' })
        }
        if (url === '/api/ask/prompt') return response(200, { prompt: 'same prompt' })
        if (url === '/api/network/diagnose') return response(200, DIAGNOSIS)
        throw new Error(`unexpected ${url}`)
      },
    })
    runInNewContext(`${NETWORK_PAGE_SCRIPT.slice(start, end)}; this.api = api`, ctx)
    const c = await controller(ctx.api!)
    await c.start()
    await c.openAsk()
    const confirming = c.confirmAsk()
    await sessionStarted.promise
    c.closeAsk()
    session.resolve({ token: 'new-token' })
    await confirming
    assert.equal(asks, 1)
    assert.equal(c.state.ask, null)
  })
})
