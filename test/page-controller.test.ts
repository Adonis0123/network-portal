import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import type { NetworkDiagnosis } from '../src/diagnose.ts'
import { networkDiagnoseTaskFacts } from '../src/facts.ts'
import { renderNetworkPage } from '../src/page.ts'
import { NETWORK_PAGE_SCRIPT, networkPageController } from '../src/page-script.ts'
import { DIAGNOSIS } from './fixtures.ts'

async function controller(api: (path: string, body: unknown) => Promise<unknown>) {
  const ctx: { make?: typeof networkPageController } = {}
  Object.assign(ctx, { AbortController })
  runInNewContext(`${networkPageController.toString()}; this.make = networkPageController`, ctx)
  return ctx.make!({ api, facts: networkDiagnoseTaskFacts, version: '1.2.3', lang: 'en' })
}

type Node = { tag: string; attrs: Record<string, unknown>; children: unknown[] }

/** The page's own message table and translator, so assertions see the strings users see. */
function translator(lang: 'en' | 'zh') {
  const page = renderNetworkPage({ basePath: '', token: 'x' })
  const messages = JSON.parse(/id="network-i18n">(.*?)<\/script>/.exec(page)![1]!)
  return (key: string, vars: Record<string, unknown> = {}) => {
    let value: string = messages[lang][key] || messages.en[key] || key
    for (const [name, replacement] of Object.entries(vars))
      value = value.split(`{${name}}`).join(String(replacement))
    return value
  }
}

function scriptSlice(from: string, to: string, lang: 'en' | 'zh', extra: Record<string, unknown> = {}) {
  const start = NETWORK_PAGE_SCRIPT.indexOf(from)
  const end = NETWORK_PAGE_SCRIPT.indexOf(to, start)
  const ctx: Record<string, unknown> = {
    t: translator(lang),
    h: (tag: string, attrs: Record<string, unknown>, ...children: unknown[]): Node => ({
      tag,
      attrs: attrs || {},
      children: children.flat(),
    }),
    ...extra,
  }
  runInNewContext(`${NETWORK_PAGE_SCRIPT.slice(start, end)}`, ctx)
  return ctx
}

function texts(node: unknown): string[] {
  if (!node || typeof node !== 'object') return typeof node === 'string' ? [node] : []
  const n = node as Node
  return [...(typeof n.attrs.text === 'string' ? [n.attrs.text] : []), ...n.children.flatMap(texts)]
}

function classes(node: unknown): string[] {
  if (!node || typeof node !== 'object') return []
  const n = node as Node
  return [String(n.attrs.class ?? ''), ...n.children.flatMap(classes)]
}

const LINUX: NetworkDiagnosis = {
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
      api?: (path: string, body: unknown, signal?: AbortSignal) => Promise<unknown>
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

  it('shows a not-applicable Linux system proxy as neutral "not applicable", not unavailable', () => {
    for (const [lang, label, unavailable] of [
      ['zh', '不适用', '不可用'],
      ['en', 'Not applicable', 'Unavailable'],
    ] as const) {
      const ctx = scriptSlice('function probeLabel(probe)', 'function candidateCard', lang)
      const render = ctx.renderOverview as (d: NetworkDiagnosis) => Node[]
      const details = ctx.renderSystemDetails as (d: NetworkDiagnosis) => Node[]
      const card = render(LINUX)[1]!
      const text = texts(card).join('\n')
      assert.ok(texts(card).filter((value) => value === label).length >= 2, text)
      assert.match(text, /HTTPS_PROXY \/ ALL_PROXY/)
      assert.doesNotMatch(text, new RegExp(`${unavailable}|not-applicable`))
      assert.doesNotMatch(classes(card).join(' '), /fail|warn|err/)
      const rows = details(LINUX)
      assert.equal(rows.length, 1)
      assert.match(
        texts(rows[0]).join(''),
        lang === 'zh' ? /Linux 没有统一的系统代理设置/ : /Linux has no single/,
      )
      assert.doesNotMatch(classes(rows[0]).join(' '), /fail|warn|err/)
    }
  })

  it('titles the system proxy section by platform and stays neutral for older DTOs', () => {
    const heading = (lang: 'en' | 'zh', diagnosis: NetworkDiagnosis | null) => {
      const elements = new Map<string, Record<string, unknown>>()
      const ctx = scriptSlice('function renderMain()', 'function renderAsk()', lang, {
        BOOT: { lang, title: 'Network' },
        lang,
        controller: { state: { diagnosis, loading: false, error: null } },
        document: { documentElement: {}, title: '' },
        $: (id: string) => {
          if (!elements.has(id))
            elements.set(id, { textContent: '', append() {}, setAttribute() {} } as Record<string, unknown>)
          return elements.get(id)
        },
        placeholder: () => ({}),
        fillRegion: () => {},
        clear: () => {},
        renderOverview: () => [],
        renderSystemDetails: () => [],
        candidateCard: () => ({}),
        targetCard: () => ({}),
      })
      ;(ctx.renderMain as () => void)()
      return elements.get('system-heading')!.textContent
    }
    const legacy = { ...DIAGNOSIS }
    delete legacy.platform
    assert.equal(heading('zh', { ...DIAGNOSIS, platform: 'darwin' }), 'macOS 系统代理')
    assert.equal(heading('en', { ...DIAGNOSIS, platform: 'darwin' }), 'macOS system proxy')
    assert.equal(heading('zh', LINUX), '系统代理')
    assert.equal(heading('en', LINUX), 'System proxy')
    assert.equal(heading('zh', legacy), '系统代理')
    assert.equal(heading('zh', null), '系统代理')
  })

  it('titles the process proxy port and words other candidates as common ports', () => {
    const card = (lang: 'en' | 'zh', candidate: NetworkDiagnosis['localProxyCandidates'][number]) =>
      texts(
        (
          scriptSlice('function candidateCard', 'function routeLabel', lang).candidateCard as (
            c: unknown,
          ) => Node
        )(candidate),
      )
    const base = { protocol: 'HTTP', host: '127.0.0.1', port: 10808, reachable: true }
    const matched = card('zh', { ...base, label: 'Common v2rayN SOCKS port', processProxy: 'HTTPS_PROXY' })
    assert.equal(matched[0], '进程代理（HTTPS_PROXY）')
    assert.match(matched.join('\n'), /HTTP · 127\.0\.0\.1:10808 · 常见端口：v2rayN SOCKS/)
    assert.equal(
      card('en', { ...base, label: 'Common v2rayN SOCKS port', processProxy: 'ALL_PROXY' })[0],
      'Process proxy (ALL_PROXY)',
    )
    assert.equal(
      card('zh', { ...base, label: 'Common Clash HTTP port', port: 7890 })[0],
      '常见端口：Clash HTTP',
    )
    assert.equal(
      card('en', { ...base, label: 'Common Clash HTTP port', port: 7890 })[0],
      'Common Clash HTTP port',
    )
    assert.equal(card('zh', { ...base, label: 'Host supplied label' })[0], 'Host supplied label')
  })
})
