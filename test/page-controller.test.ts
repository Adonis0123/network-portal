import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { runInNewContext } from 'node:vm'
import type { NetworkDiagnosis } from '../src/diagnose.ts'
import { networkDiagnoseTaskFacts } from '../src/facts.ts'
import { renderNetworkPage } from '../src/page.ts'
import {
  formatLocalTime,
  NETWORK_PAGE_SCRIPT,
  networkPageController,
  targetProbeStatus,
} from '../src/page-script.ts'
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

  it('marks a connected but unhealthy WARP overview as failing', () => {
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
    assert.equal(ctx.render!(diagnosis)[0]!.chipClass, 'chip-fail')
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
      withTime: () => [],
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

  it('shows a not-applicable Linux system proxy once, as neutral "not applicable"', () => {
    for (const [lang, label, value, unavailable] of [
      ['zh', '不适用', '无统一设置', '不可用'],
      ['en', 'Not applicable', 'No single setting', 'Unavailable'],
    ] as const) {
      const ctx = scriptSlice('function probeLabel(probe)', 'function fillRegion', lang)
      const render = ctx.renderOverview as (d: NetworkDiagnosis) => Node[]
      const details = ctx.renderSystemDetails as (d: NetworkDiagnosis) => Node[]
      const card = render(LINUX)[1]!
      const text = texts(card)
      assert.equal(text.filter((v) => v === label).length, 1, text.join('\n'))
      assert.ok(text.includes(value), text.join('\n'))
      assert.match(text.join('\n'), /HTTPS_PROXY \/ ALL_PROXY/)
      assert.doesNotMatch(text.join('\n'), new RegExp(`${unavailable}|not-applicable`))
      assert.doesNotMatch(classes(card).join(' '), /fail|warn|err/)
      assert.equal(details(LINUX).length, 0)
    }
  })

  it('says each overview fact once and turns raw codes into a phrase with the code', () => {
    const ctx = scriptSlice('function probeLabel(probe)', 'function fillRegion', 'zh')
    const render = ctx.renderOverview as (d: NetworkDiagnosis) => Node[]
    const missing: NetworkDiagnosis = {
      ...LINUX,
      system: {
        ...LINUX.system,
        warp: { status: 'unavailable', state: 'unknown', error: 'not-installed' },
        dns: { status: 'error', nameservers: [], error: 'timeout' },
        route: { status: 'available', interface: 'eth0', gateway: '198.18.0.2' },
      },
    }
    const [warp, , dns, route] = render(missing).map(texts)
    assert.deepEqual(warp, ['WARP', '不可用', '未安装', '未检测到 warp-cli (not-installed)'])
    assert.deepEqual(dns, ['DNS 服务器', '出错', '超时 (timeout)'])
    assert.deepEqual(route, ['默认路由', '正常', '198.18.0.2', '网卡：eth0'])
    assert.match(classes(render(missing)[2]).join(' '), /chip-fail/)
    const pointToPoint = {
      ...missing,
      system: { ...missing.system, route: { status: 'available', interface: 'wg0' } },
    } as NetworkDiagnosis
    assert.deepEqual(render(pointToPoint).map(texts)[3], ['默认路由', '正常', '网卡：wg0'])
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
        withTime: () => [],
        fillRegion: () => {},
        clear: () => {},
        renderOverview: () => [],
        renderSystemDetails: () => [],
        candidateCard: () => ({}),
        targetCard: () => ({}),
      })
      ;(ctx.renderMain as () => void)()
      sectionHidden = elements.get('system-section')!.hidden
      warpLimitHidden = elements.get('warp-limit')!.hidden
      return elements.get('system-heading')!.textContent
    }
    let sectionHidden: unknown
    let warpLimitHidden: unknown
    const legacy = { ...DIAGNOSIS }
    delete legacy.platform
    assert.equal(heading('zh', { ...DIAGNOSIS, platform: 'darwin' }), 'macOS 系统代理')
    assert.equal(sectionHidden, false)
    assert.equal(heading('en', { ...DIAGNOSIS, platform: 'darwin' }), 'macOS system proxy')
    assert.equal(heading('zh', LINUX), '系统代理')
    assert.equal(sectionHidden, true)
    assert.equal(heading('en', LINUX), 'System proxy')
    assert.equal(heading('zh', legacy), '系统代理')
    assert.equal(heading('zh', null), '系统代理')
    assert.equal(warpLimitHidden, true)
    const connected = { status: 'available', state: 'connected' } as const
    heading('zh', { ...DIAGNOSIS, system: { ...DIAGNOSIS.system, warp: connected } })
    assert.equal(warpLimitHidden, false)
    heading('zh', {
      ...DIAGNOSIS,
      system: {
        ...DIAGNOSIS.system,
        warp: { status: 'unavailable', state: 'unknown', error: 'not-installed' },
      },
    })
    assert.equal(warpLimitHidden, true)
  })

  it('titles every port card by address and tags the process proxy beside it', () => {
    const card = (lang: 'en' | 'zh', candidate: NetworkDiagnosis['localProxyCandidates'][number]) =>
      (
        scriptSlice('function probeLabel(probe)', 'function fillRegion', lang).candidateCard as (
          c: unknown,
        ) => Node
      )(candidate)
    const base = { protocol: 'HTTP', host: '127.0.0.1', port: 10808, reachable: true }
    const matched = card('zh', { ...base, label: 'Common v2rayN SOCKS port', processProxy: 'HTTPS_PROXY' })
    assert.deepEqual(texts(matched), [
      '127.0.0.1:10808',
      'HTTPS_PROXY 指向此端口',
      '可连接',
      'HTTP · 常见于 v2rayN',
    ])
    assert.match(classes(matched).join(' '), /net-tag/)
    assert.deepEqual(
      texts(card('en', { ...base, label: 'Common v2rayN SOCKS port', processProxy: 'ALL_PROXY' })).slice(
        0,
        2,
      ),
      ['127.0.0.1:10808', 'ALL_PROXY points here'],
    )
    const refused = card('zh', {
      ...base,
      label: 'Common Clash HTTP port',
      port: 7890,
      reachable: false,
      error: 'ECONNREFUSED',
    })
    assert.deepEqual(texts(refused), [
      '127.0.0.1:7890',
      '不可连接',
      'HTTP · 常见于 Clash · 拒绝连接 (ECONNREFUSED)',
    ])
    assert.match(classes(refused).join(' '), /chip-fail/)
    assert.match(
      texts(card('zh', { ...base, label: 'Host supplied label' })).join('\n'),
      /HTTP · Host supplied label/,
    )
  })

  it('shows a status chip on target cards and keeps route details in the body', () => {
    const ctx = scriptSlice('function probeLabel(probe)', 'function fillRegion', 'zh', {
      lang: 'zh',
      formatTime: (iso: string) => `local(${iso})`,
      targetStatus: targetProbeStatus,
    })
    const card = ctx.targetCard as (t: NetworkDiagnosis['targets'][number]) => Node
    const reachable = card(DIAGNOSIS.targets[0]!)
    assert.deepEqual(texts(reachable), [
      'https://api.example.com/cdn-cgi/trace',
      '可连接',
      '路由：',
      'http://127.0.0.1:7890',
      ' · HTTP CONNECT',
      '本机监听端口 127.0.0.1:7890',
      '缓存 Guard：允许 · US',
      ' · ',
      '检查于 ',
      'local(2026-11-23T09:00:00.000Z)',
      '',
    ])
    const time = (reachable.children[3] as Node).children.find(
      (child) => (child as Node)?.tag === 'time',
    ) as Node
    assert.equal(time.attrs.datetime, '2026-11-23T09:00:00.000Z')
    assert.equal(time.attrs.title, '2026-11-23T09:00:00.000Z')
    const direct = texts(
      card({
        url: 'https://direct.example.com',
        proxy: 'direct',
        guardSupport: 'direct',
        listener: null,
        guard: { status: 'not-checked' },
      }),
    )
    assert.deepEqual(direct, ['https://direct.example.com', '未探测', '路由：', '直连', '缓存 Guard：未检查'])
  })

  it('formats times as local 24-hour time and keeps an unparseable value as is', () => {
    assert.equal(formatLocalTime('2026-11-23T16:12:44.558Z', 'zh', 'Asia/Shanghai'), '2026-11-24 00:12:44')
    assert.equal(formatLocalTime('2026-11-23T16:12:44.558Z', 'en', 'UTC'), '2026-11-23 16:12:44')
    assert.equal(formatLocalTime('2026-11-23T16:00:05.000Z', 'en', 'Asia/Shanghai'), '2026-11-24 00:00:05')
    assert.equal(formatLocalTime('not a time', 'zh'), 'not a time')
  })

  it('maps a target to one status chip, with Guard support problems first', () => {
    const listener = { host: '127.0.0.1', port: 7890 }
    const cases = [
      [
        { guardSupport: 'unsupported', listener: { ...listener, reachable: true } },
        'status.unsupported',
        'fail',
      ],
      [{ guardSupport: 'invalid', listener: null }, 'status.invalid', 'fail'],
      [
        { guardSupport: 'http-connect', listener: { ...listener, reachable: true } },
        'status.reachable',
        'ok',
      ],
      [
        { guardSupport: 'http-connect', listener: { ...listener, reachable: false } },
        'status.notReachable',
        'fail',
      ],
      [{ guardSupport: 'http-connect', listener: null }, 'status.notProbed', ''],
      [{ guardSupport: 'direct', listener: null }, 'status.notProbed', ''],
    ] as const
    for (const [target, key, tone] of cases) assert.deepEqual(targetProbeStatus(target), { key, tone })
  })
})
