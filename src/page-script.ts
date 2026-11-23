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

export const NETWORK_PAGE_SCRIPT = `
const createNetworkController = ${networkPageController.toString()};
const factsForTask = ${networkDiagnoseTaskFacts.toString()};
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
  return probe.status === 'available' ? '' : t(probe.status === 'unavailable' ? 'unavailable' : 'error') + (probe.error ? ' · ' + probe.error : '');
}
function overviewCard(label, value, detail, chipText, chipClass) {
  return h('article', { class: 'panel net-overview-card' },
    h('div', { class: 'net-card-head' }, h('h3', { text: label }), chipText ? h('span', { class: 'chip ' + (chipClass || ''), text: chipText }) : null),
    h('p', { class: 'net-overview-value', text: value }),
    detail ? h('p', { class: 'small muted', text: detail }) : null);
}
function renderOverview(diagnosis) {
  const system = diagnosis.system;
  const warp = system.warp;
  const warpState = warp.state === 'connected' ? t('warpConnected') : warp.state === 'disconnected' ? t('warpDisconnected') : t('warpUnknown');
  const warpHealth = warp.networkHealthy === undefined ? '' : t('networkHealthy') + ': ' + t(warp.networkHealthy ? 'healthy' : 'unhealthy');
  const enabledCount = system.proxy.protocols.filter((p) => p.enabled).length + (system.proxy.pacEnabled ? 1 : 0) + (system.proxy.autoDiscoveryEnabled ? 1 : 0);
  const proxyValue = system.proxy.status !== 'available' ? probeLabel(system.proxy) : enabledCount ? t('proxyEnabled', { count: enabledCount }) : t('proxyDisabled');
  const proxyNotApplicable = system.proxy.error === 'not-applicable';
  const proxyDetail = proxyNotApplicable ? t('proxyNotApplicableShort') : system.proxy.exceptionCount === undefined ? probeLabel(system.proxy) : t('proxyExceptions', { count: system.proxy.exceptionCount });
  const dnsValue = system.dns.nameservers.length ? system.dns.nameservers.join(', ') : system.dns.status === 'available' ? t('dnsNone') : probeLabel(system.dns);
  const routeValue = system.route.gateway || (system.route.status === 'available' ? t('routeNone') : probeLabel(system.route));
  const routeDetail = system.route.interface ? t('interface') + ': ' + system.route.interface : probeLabel(system.route);
  return [
    overviewCard(t('warp'), warp.status === 'available' ? warpState : probeLabel(warp), warpHealth || probeLabel(warp), warp.status === 'available' ? warpState : t(warp.status), warp.state === 'connected' && warp.status === 'available' && warp.networkHealthy !== false ? 'chip-ok' : ''),
    overviewCard(t('systemProxy'), proxyValue, proxyDetail, system.proxy.status === 'available' ? t(enabledCount ? 'on' : 'off') : proxyNotApplicable ? t('notApplicable') : t(system.proxy.status), enabledCount && system.proxy.status === 'available' ? 'chip-ok' : ''),
    overviewCard(t('dns'), dnsValue, t('searchOmitted'), system.dns.status === 'available' ? 'DNS' : t(system.dns.status), system.dns.nameservers.length ? 'chip-ok' : ''),
    overviewCard(t('defaultRoute'), routeValue, routeDetail, system.route.interface || t(system.route.status), system.route.gateway ? 'chip-ok' : ''),
  ];
}
function renderSystemDetails(diagnosis) {
  const proxy = diagnosis.system.proxy;
  if (proxy.error === 'not-applicable') return [h('p', { class: 'net-detail-row muted', text: t('proxyNotApplicable') })];
  if (!proxy.protocols.length && proxy.status !== 'available') return [h('p', { class: 'net-detail-row muted', text: probeLabel(proxy) || t('unavailable') })];
  const rows = proxy.protocols.map((p) => {
    const endpoint = p.enabled && p.host ? p.host + (p.port ? ':' + p.port : '') : '';
    return h('div', { class: 'net-detail-row' },
      h('strong', { text: p.protocol.toUpperCase() }),
      h('span', { class: 'net-detail-value', text: endpoint || t(p.enabled ? 'on' : 'off') }),
      h('span', { class: 'chip ' + (p.enabled ? 'chip-ok' : ''), text: t(p.enabled ? 'on' : 'off') }));
  });
  if (proxy.status === 'available') rows.push(h('div', { class: 'net-detail-row' },
    h('strong', { text: t('pac') }),
    h('span', { class: 'net-detail-value', text: t('pacUrlOmitted') }),
    h('span', { class: 'chip ' + (proxy.pacEnabled ? 'chip-ok' : ''), text: t(proxy.pacEnabled ? 'on' : 'off') })));
  if (proxy.status === 'available') rows.push(h('div', { class: 'net-detail-row' },
    h('strong', { text: t('autoDiscovery') }),
    h('span', { class: 'net-detail-value', text: t(proxy.autoDiscoveryEnabled ? 'on' : 'off') }),
    h('span', { class: 'chip ' + (proxy.autoDiscoveryEnabled ? 'chip-ok' : ''), text: t(proxy.autoDiscoveryEnabled ? 'on' : 'off') })));
  if (proxy.exceptionCount !== undefined) rows.push(h('div', { class: 'net-detail-row' },
    h('strong', { text: 'ExceptionsList' }),
    h('span', { class: 'net-detail-value', text: t('proxyExceptions', { count: proxy.exceptionCount }) })));
  return rows;
}
function candidateCard(candidate) {
  const key = 'candidate.' + candidate.label;
  const common = t(key) === key ? candidate.label : t(key);
  const processProxy = candidate.processProxy === 'HTTPS_PROXY' || candidate.processProxy === 'ALL_PROXY' ? candidate.processProxy : '';
  return h('article', { class: 'panel net-candidate' },
    h('h3', { text: processProxy ? t('processProxyCandidate', { variable: processProxy }) : common }),
    h('span', { class: 'chip ' + (candidate.reachable ? 'chip-ok' : ''), text: t(candidate.reachable ? 'reachable' : 'notReachable') }),
    h('p', { class: 'net-candidate-meta small muted', text: candidate.protocol + ' · ' + candidate.host + ':' + candidate.port + (candidate.error ? ' · ' + candidate.error : '') + (processProxy ? ' · ' + common : '') }));
}
function routeLabel(target) {
  return h('p', { class: 'net-route' }, h('span', { class: 'muted' }, t('route') + ': '), h('code', { text: target.proxy }));
}
function targetCard(target) {
  const listener = target.listener;
  const support = target.guardSupport;
  const guardBits = [t('guard.' + target.guard.status)];
  if (target.guard.loc) guardBits.push(target.guard.loc);
  guardBits.push(target.guard.checkedAt ? t('guardChecked', { when: target.guard.checkedAt }) : t('guardNever'));
  if (target.guard.error) guardBits.push(target.guard.error);
  return h('article', { class: 'panel net-target' },
    h('div', { class: 'net-target-head' }, h('h3', { text: target.url }), h('span', { class: 'chip', text: t('support.' + support) })),
    routeLabel(target),
    h('p', { class: listener && listener.reachable ? 'net-ok' : 'small muted', text: listener
      ? t(listener.reachable ? 'listenerUp' : 'listenerDown', { host: listener.host, port: listener.port, error: listener.error || t('failed') })
      : support === 'direct' ? t('direct') : t('noListener') }),
    h('p', { class: 'small muted', text: guardBits.join(' · ') }),
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
  $('title').textContent = t('title');
  $('tagline').textContent = t('tagline');
  $('intro').textContent = t('intro');
  $('scope').textContent = t('scope');
  $('not-covered').textContent = t('notCovered');
  $('overview-heading').textContent = t('overview');
  // Only macOS has one system proxy to name; older DTOs without a platform get the neutral title.
  $('system-heading').textContent = t(controller.state.diagnosis && controller.state.diagnosis.platform === 'darwin' ? 'systemDetails' : 'systemProxy');
  $('local-heading').textContent = t('localCandidates');
  $('targets-heading').textContent = t('guardTargets');
  $('warp-limit').textContent = t('warpLimit');
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
  else if (controller.state.diagnosis) status.append(h('p', { class: 'small muted', role: 'status', text: t('checkedAt', { when: controller.state.diagnosis.checkedAt }) }));
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
