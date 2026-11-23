// Browser behaviour for the host-embeddable Network page. Tests also run the controller in a VM.
import type { NetworkDiagnosis } from './diagnose.ts'
import { networkDiagnoseTaskFacts } from './facts.ts'

type Api = (path: string, body: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
type AskResult = { opened: boolean; command?: string | null; reason?: string; detail?: string }
type AskState = {
  body: Record<string, unknown>
  abort: AbortController
  prompt: string
  loading: boolean
  busy: boolean
  promptChanged: boolean
  error: string | null
  result: AskResult | null
}

/** One controller per document; a null Ask is a closed dialog and invalidates every pending continuation. */
export function networkPageController(opts: {
  api: Api
  facts?: typeof networkDiagnoseTaskFacts
  version: string
  lang: string
  onChange?: () => void
}) {
  const facts = opts.facts ?? networkDiagnoseTaskFacts
  const state: {
    diagnosis: NetworkDiagnosis | null
    loading: boolean
    error: string | null
    ask: AskState | null
  } = { diagnosis: null, loading: false, error: null, ask: null }
  let diagnosisRun: object | null = null
  const changed = () => opts.onChange?.()
  const message = (err: unknown) => (err as { message?: string })?.message || String(err)

  return {
    state,
    async start() {
      return this.diagnose()
    },
    async diagnose() {
      if (diagnosisRun) return
      const mine = {}
      diagnosisRun = mine
      state.loading = true
      state.error = null
      changed()
      try {
        const result = (await opts.api('/api/network/diagnose', {})) as NetworkDiagnosis
        if (diagnosisRun !== mine) return
        state.diagnosis = result
      } catch (err) {
        if (diagnosisRun !== mine) return
        state.error = message(err)
      } finally {
        if (diagnosisRun === mine) {
          diagnosisRun = null
          state.loading = false
          changed()
        }
      }
    },
    async openAsk() {
      if (!state.diagnosis || state.ask) return
      const ask: AskState = {
        body: {
          task: 'network-diagnose',
          lang: opts.lang,
          context: { networkDiagnose: facts(state.diagnosis), version: opts.version },
        },
        abort: new AbortController(),
        prompt: '',
        loading: true,
        busy: false,
        promptChanged: false,
        error: null,
        result: null,
      }
      state.ask = ask
      changed()
      try {
        const preview = (await opts.api('/api/ask/prompt', ask.body, ask.abort.signal)) as { prompt: string }
        if (state.ask !== ask) return
        ask.prompt = preview.prompt
        ask.loading = false
        changed()
      } catch (err) {
        if (state.ask !== ask) return
        ask.error = message(err)
        ask.loading = false
        changed()
      }
    },
    closeAsk() {
      state.ask?.abort.abort()
      state.ask = null
      changed()
    },
    async confirmAsk() {
      const ask = state.ask
      if (!ask || ask.loading || ask.busy || ask.result) return
      ask.busy = true
      ask.error = null
      changed()
      try {
        // The body is identical to the preview's. A new preview always wins over this confirmation.
        const check = (await opts.api('/api/ask/prompt', ask.body, ask.abort.signal)) as { prompt: string }
        if (state.ask !== ask) return
        if (check.prompt !== ask.prompt) {
          ask.prompt = check.prompt
          ask.promptChanged = true
          ask.busy = false
          changed()
          return
        }
        ask.promptChanged = false
        const result = (await opts.api(
          '/api/ask',
          { ...ask.body, confirmedPrompt: ask.prompt },
          ask.abort.signal,
        )) as AskResult
        if (state.ask !== ask) return
        ask.result = result
        ask.busy = false
        changed()
      } catch (err) {
        if (state.ask !== ask) return
        ask.error = message(err)
        ask.busy = false
        changed()
      }
    },
  }
}

/** Local time as YYYY-MM-DD HH:mm:ss (24-hour) in the page language; an unparseable value is returned unchanged. */
export function formatLocalTime(iso: string, lang: string, timeZone?: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts: Record<string, string> = {}
  const format = new Intl.DateTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  for (const part of format.formatToParts(date)) parts[part.type] = part.value
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

/** The target card's status chip: Guard support problems win, then the loopback TCP probe, else not probed. */
export function targetProbeStatus(
  target: Pick<NetworkDiagnosis['targets'][number], 'guardSupport' | 'listener'>,
): {
  key: string
  tone: '' | 'ok' | 'fail'
} {
  if (target.guardSupport === 'unsupported') return { key: 'status.unsupported', tone: 'fail' }
  if (target.guardSupport === 'invalid') return { key: 'status.invalid', tone: 'fail' }
  if (target.listener)
    return target.listener.reachable
      ? { key: 'status.reachable', tone: 'ok' }
      : { key: 'status.notReachable', tone: 'fail' }
  return { key: 'status.notProbed', tone: '' }
}

export const NETWORK_PAGE_SCRIPT = `
const createNetworkController = ${networkPageController.toString()};
const factsForTask = ${networkDiagnoseTaskFacts.toString()};
const formatTime = ${formatLocalTime.toString()};
const targetStatus = ${targetProbeStatus.toString()};
const $ = (id) => document.getElementById(id);
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child && typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
  return el;
}
let lang = BOOT.lang === 'auto' ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en') : BOOT.lang;
const t = (key, vars = {}) => {
  let value = (MESSAGES[lang] && MESSAGES[lang][key]) || MESSAGES.en[key] || key;
  for (const [name, replacement] of Object.entries(vars)) value = value.split('{' + name + '}').join(String(replacement));
  return value;
};
let token = BOOT.token;
async function api(path, body, signal) {
  const send = async () => {
    if (signal && signal.aborted) throw new Error('cancelled');
    const headers = { 'content-type': 'application/json' };
    headers[BOOT.tokenHeader] = token;
    const response = await fetch(BOOT.basePath + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || t('requestFailed', { status: response.status }));
      error.code = data.code;
      throw error;
    }
    return data;
  };
  try { return await send(); } catch (error) {
    if (error.code !== 'bad-token') throw error;
    if (signal && signal.aborted) throw error;
    const response = await fetch(BOOT.basePath + '/api/session', {
      credentials: 'same-origin',
      mode: 'same-origin',
      redirect: 'error',
      signal,
    });
    if (!response.ok) throw error;
    const next = (await response.json()).token;
    if (typeof next !== 'string' || !next || (signal && signal.aborted)) throw error;
    token = next;
    return send();
  }
}
const dialog = $('ask-dialog');
const controller = createNetworkController({
  api,
  facts: factsForTask,
  version: BOOT.version,
  get lang() { return lang; },
  onChange: render,
});
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
function placeholder() {
  return h('div', { class: 'panel net-placeholder', 'aria-busy': 'true' }, h('span', { class: 'sk sk-line w70' }), h('span', { class: 'sk sk-line w50' }));
}
function probeLabel(probe) {
  if (probe.error === 'not-applicable') return t('notApplicable');
  return errorText(probe.error) || t(probe.status === 'error' ? 'error' : 'unavailable');
}
// A raw code stays visible after its phrase so users can search for it; unknown codes show as-is.
function errorText(code) {
  if (!code) return '';
  const key = 'code.' + (/^exit-\\d+$/.test(code) ? 'exit' : code);
  const phrase = t(key);
  return phrase === key ? code : phrase + ' (' + code + ')';
}
function chip(text, tone) {
  return h('span', { class: 'chip' + (tone ? ' chip-' + tone : ''), text });
}
function withTime(key, iso) {
  const [before, after] = t(key).split('{when}');
  return [before, h('time', { datetime: iso, title: iso, text: formatTime(iso, lang) }), after || ''];
}
function overviewCard(label, value, detail, chipText, chipClass) {
  return h('article', { class: 'panel net-overview-card' },
    h('div', { class: 'net-card-head' }, h('h3', { text: label }), chipText ? h('span', { class: 'chip ' + (chipClass || ''), text: chipText }) : null),
    h('p', { class: 'net-overview-value', text: value }),
    detail ? h('p', { class: 'small muted', text: detail }) : null);
}
function renderOverview(diagnosis) {
  const system = diagnosis.system;
  const failTone = (probe) => probe.status === 'error' ? 'chip-fail' : '';
  const warp = system.warp;
  let warpCard;
  if (warp.status === 'available') {
    const connected = warp.state === 'connected';
    const value = connected
      ? (warp.networkHealthy === undefined ? t('warpHealthUnknown') : t(warp.networkHealthy ? 'healthy' : 'unhealthy'))
      : t(warp.state === 'disconnected' ? 'warpBypassed' : 'warpStateUnknown');
    const state = t(connected ? 'warpConnected' : warp.state === 'disconnected' ? 'warpDisconnected' : 'warpUnknown');
    warpCard = [value, '', state, !connected ? '' : warp.networkHealthy === false ? 'chip-fail' : 'chip-ok'];
  } else if (warp.error === 'not-installed') warpCard = [t('notInstalled'), t('warpNotInstalled'), t(warp.status), failTone(warp)];
  else warpCard = [probeLabel(warp), '', t(warp.status), failTone(warp)];
  const proxy = system.proxy;
  const enabledCount = proxy.protocols.filter((p) => p.enabled).length + (proxy.pacEnabled ? 1 : 0) + (proxy.autoDiscoveryEnabled ? 1 : 0);
  const proxyCard = proxy.error === 'not-applicable'
    ? [t('proxyNoSingle'), t('proxyNotApplicableShort'), t('notApplicable'), '']
    : proxy.status === 'available'
      ? [enabledCount ? t('proxyEnabled', { count: enabledCount }) : t('proxyDisabled'), '', t(enabledCount ? 'on' : 'off'), enabledCount ? 'chip-ok' : '']
      : [probeLabel(proxy), '', t(proxy.status), failTone(proxy)];
  const dns = system.dns;
  const dnsCard = dns.nameservers.length
    ? [dns.nameservers.join(', '), t('searchOmitted'), t('status.ok'), 'chip-ok']
    : dns.status === 'available' ? [t('dnsNone'), '', t('unavailable'), ''] : [probeLabel(dns), '', t(dns.status), failTone(dns)];
  const route = system.route;
  const routeDetail = route.interface ? t('interfaceIs', { name: route.interface }) : '';
  // A default with no gateway (a point-to-point link such as wg0) is still a route; its interface is the answer.
  const routeCard = route.gateway
    ? [route.gateway, routeDetail, t('status.ok'), 'chip-ok']
    : route.status === 'available'
      ? route.interface ? [routeDetail, '', t('status.ok'), 'chip-ok'] : [t('routeNone'), '', t('unavailable'), '']
      : [probeLabel(route), '', t(route.status), failTone(route)];
  return [
    overviewCard(t('warp'), ...warpCard),
    overviewCard(t('systemProxy'), ...proxyCard),
    overviewCard(t('dns'), ...dnsCard),
    overviewCard(t('defaultRoute'), ...routeCard),
  ];
}
function renderSystemDetails(diagnosis) {
  const proxy = diagnosis.system.proxy;
  // Without rows the overview card already says everything (not applicable, unavailable, error); the section is hidden.
  if (!proxy.protocols.length && proxy.status !== 'available') return [];
  const row = (label, value, enabled) => h('div', { class: 'net-detail-row' },
    h('strong', { text: label }),
    h('span', { class: 'net-detail-value', text: value }),
    enabled === undefined ? null : chip(t(enabled ? 'on' : 'off'), enabled ? 'ok' : ''));
  const rows = proxy.protocols.map((p) => row(p.protocol.toUpperCase(), p.enabled && p.host ? p.host + (p.port ? ':' + p.port : '') : '', p.enabled));
  if (proxy.status === 'available') {
    rows.push(row(t('pac'), proxy.pacEnabled ? t('pacUrlOmitted') : '', proxy.pacEnabled));
    rows.push(row(t('autoDiscovery'), '', proxy.autoDiscoveryEnabled));
  }
  if (proxy.exceptionCount !== undefined) rows.push(row(t('exceptions'), t('exceptionCount', { count: proxy.exceptionCount })));
  return rows;
}
function candidateCard(candidate) {
  const productKey = 'product.' + candidate.label;
  const product = t(productKey) === productKey ? '' : t(productKey);
  const processProxy = candidate.processProxy === 'HTTPS_PROXY' || candidate.processProxy === 'ALL_PROXY' ? candidate.processProxy : '';
  const meta = [candidate.protocol, product ? t('commonFor', { product }) : candidate.label];
  if (!candidate.reachable && candidate.error) meta.push(errorText(candidate.error));
  return h('article', { class: 'panel net-candidate' },
    h('h3', { text: candidate.host + ':' + candidate.port }, processProxy ? h('span', { class: 'net-tag', text: t('processProxyTag', { variable: processProxy }) }) : null),
    chip(t(candidate.reachable ? 'status.reachable' : 'status.notReachable'), candidate.reachable ? 'ok' : 'fail'),
    h('p', { class: 'net-candidate-meta small muted', text: meta.filter(Boolean).join(' · ') }));
}
function targetCard(target) {
  const listener = target.listener;
  const support = target.guardSupport;
  const status = targetStatus(target);
  const route = support === 'direct'
    ? h('p', { class: 'net-route' }, h('span', { class: 'muted', text: t('route') }), t('support.direct'))
    : h('p', { class: 'net-route' }, h('span', { class: 'muted', text: t('route') }), h('code', { text: target.proxy }), support === 'http-connect' ? ' · ' + t('support.http-connect') : null);
  const probe = listener
    ? t('probedPort', { host: listener.host, port: listener.port }) + (listener.reachable ? '' : ' · ' + errorText(listener.error || 'failed'))
    : support === 'http-connect' ? t('noListener') : '';
  const guardBits = [t('guard.' + target.guard.status)];
  if (target.guard.loc) guardBits.push(target.guard.loc);
  if (target.guard.error) guardBits.push(errorText(target.guard.error));
  return h('article', { class: 'panel net-target' },
    h('div', { class: 'net-target-head' }, h('h3', { text: target.url }), chip(t(status.key), status.tone)),
    route,
    probe ? h('p', { class: 'small muted', text: probe }) : null,
    h('p', { class: 'small muted' }, guardBits.join(' · '), target.guard.checkedAt ? [' · ', ...withTime('guardChecked', target.guard.checkedAt)] : null),
    support === 'unsupported' ? h('p', { class: 'note note-warn', text: t('unsupported') }) : null,
    support === 'invalid' ? h('p', { class: 'note note-warn', text: t('invalid') }) : null);
}
function fillRegion(id, diagnosis, renderItems) {
  const region = $(id);
  region.setAttribute('aria-busy', controller.state.loading && !diagnosis ? 'true' : 'false');
  clear(region);
  if (controller.state.loading && !diagnosis) region.append(placeholder());
  else if (diagnosis) for (const item of renderItems(diagnosis)) region.append(item);
  else region.append(h('p', { class: 'panel net-empty', text: t('unavailable') }));
}
function renderMain() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = BOOT.title === t('title') ? t('title') : BOOT.title + ' · ' + t('title');
  const title = $('title');
  if (title) title.textContent = t('title');
  $('tagline').textContent = t('tagline');
  $('intro').textContent = t('intro');
  $('overview-heading').textContent = t('overview');
  // Only macOS has one system proxy to name; older DTOs without a platform get the neutral title.
  $('system-heading').textContent = t(controller.state.diagnosis && controller.state.diagnosis.platform === 'darwin' ? 'systemDetails' : 'systemProxy');
  const proxy = controller.state.diagnosis && controller.state.diagnosis.system.proxy;
  $('system-section').hidden = Boolean(proxy && proxy.status !== 'available' && !proxy.protocols.length);
  $('local-heading').textContent = t('localCandidates');
  $('targets-heading').textContent = t('guardTargets');
  $('warp-limit').textContent = t('warpLimit');
  // The caveat is about a connected client; with no client or a disconnected one it contradicts the card.
  const warp = controller.state.diagnosis && controller.state.diagnosis.system.warp;
  $('warp-limit').hidden = !(warp && warp.status === 'available' && warp.state === 'connected');
  $('candidate-limit').textContent = t('candidateLimit');
  $('tcp-limit').textContent = t('tcpLimit');
  $('diagnose').textContent = controller.state.loading ? t('diagnosing') : controller.state.diagnosis ? t('diagnoseAgain') : t('diagnose');
  $('diagnose').disabled = controller.state.loading;
  $('diagnose').setAttribute('aria-busy', controller.state.loading ? 'true' : 'false');
  $('language').textContent = lang === 'zh' ? 'English' : '中文';
  $('language').hidden = BOOT.lang !== 'auto';
  const status = $('status');
  clear(status);
  if (controller.state.loading) status.append(h('p', { class: 'note', role: 'status', text: t('loading') }));
  else if (controller.state.error) status.append(h('p', { class: 'note note-fail', role: 'alert', text: t('diagnoseFailed', { message: controller.state.error }) }));
  else if (controller.state.diagnosis) status.append(h('p', { class: 'small muted', role: 'status' }, withTime('checkedAt', controller.state.diagnosis.checkedAt)));
  const diagnosis = controller.state.diagnosis;
  fillRegion('overview', diagnosis, renderOverview);
  fillRegion('system-details', diagnosis, renderSystemDetails);
  fillRegion('local-candidates', diagnosis, (d) => d.localProxyCandidates.length ? d.localProxyCandidates.map(candidateCard) : [h('p', { class: 'panel net-empty', text: t('unavailable') })]);
  const list = $('targets');
  list.setAttribute('aria-busy', controller.state.loading && !diagnosis ? 'true' : 'false');
  clear(list);
  if (controller.state.loading && !diagnosis) list.append(placeholder());
  else if (diagnosis && !diagnosis.targets.length) list.append(h('p', { class: 'panel net-empty', text: t('empty') }));
  else if (diagnosis) for (const target of diagnosis.targets) list.append(targetCard(target));
  else list.append(h('p', { class: 'panel net-empty', text: t('unavailable') }));
  $('ask-open').hidden = !diagnosis;
  $('ask-open').textContent = t('ask');
}
function renderAsk() {
  const ask = controller.state.ask;
  if (!ask) {
    if (dialog.open) dialog.close();
    return;
  }
  if (!dialog.open) dialog.showModal();
  const body = $('ask-body');
  clear(body);
  $('ask-title').textContent = t('ask');
  body.append(h('p', { class: 'small muted', text: t('fixedOnly') }));
  if (ask.loading) body.append(h('p', { class: 'note', role: 'status', text: t('promptLoading') }));
  else {
    body.append(h('span', { class: 'small muted', text: t('actualPrompt') }));
    if (ask.promptChanged) body.append(h('p', { class: 'note note-warn', role: 'status', text: t('promptChanged') }));
    body.append(h('pre', { class: 'net-prompt', text: ask.prompt }));
  }
  if (ask.error) body.append(h('p', { class: 'note note-fail', role: 'alert', text: ask.error }));
  if (ask.result) {
    body.append(h('p', { class: ask.result.opened ? 'note note-ok' : 'note note-warn', role: 'status', text: ask.result.opened ? t('opened') : t('copyFallback') }));
    if (ask.result.command) {
      body.append(h('pre', { class: 'net-prompt', text: ask.result.command }));
      body.append(h('button', { class: 'btn', type: 'button', onclick: async () => {
        try { await navigator.clipboard.writeText(ask.result.command); } catch { $('command').value = ask.result.command; $('command').select(); }
      }, text: t('copy') }));
      body.append(h('textarea', { id: 'command', class: 'net-command', readonly: true, 'aria-label': t('command'), text: ask.result.command }));
    }
  }
  $('ask-confirm').hidden = Boolean(ask.result);
  $('ask-confirm').disabled = ask.loading || ask.busy || !ask.prompt;
  $('ask-confirm').textContent = ask.busy ? t('checkingPrompt') : t('confirm');
  $('ask-cancel').textContent = ask.result ? t('close') : t('cancel');
}
function render() { renderMain(); renderAsk(); }
$('diagnose').addEventListener('click', () => controller.diagnose());
$('ask-open').addEventListener('click', () => controller.openAsk());
$('ask-confirm').addEventListener('click', () => controller.confirmAsk());
$('ask-cancel').addEventListener('click', () => controller.closeAsk());
dialog.addEventListener('close', () => { if (controller.state.ask) controller.closeAsk(); });
dialog.addEventListener('cancel', () => controller.closeAsk());
$('language').addEventListener('click', () => { lang = lang === 'zh' ? 'en' : 'zh'; render(); });
render();
void controller.start();
`
