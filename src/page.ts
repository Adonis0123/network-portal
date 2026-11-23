import { NETWORK_PAGE_SCRIPT } from './page-script.ts'
import { fallbackNetworkStyles } from './styles.ts'

const MESSAGES = {
  en: {
    title: 'Network',
    tagline: 'WARP, DNS, default route, local proxy ports, and Guard targets.',
    intro:
      "A read-only, offline look at this machine's network setup. It sends no online probe and changes no setting or route.",
    overview: 'Overview',
    systemDetails: 'macOS system proxy',
    localCandidates: 'Local proxy candidates',
    guardTargets: 'Guard targets',
    warp: 'WARP',
    healthy: 'Network healthy',
    unhealthy: 'Network unhealthy',
    warpHealthUnknown: 'Network state not reported',
    warpBypassed: 'Traffic does not use WARP',
    warpStateUnknown: 'Connection state not reported',
    warpConnected: 'Connected',
    warpDisconnected: 'Disconnected',
    warpUnknown: 'Unknown',
    notInstalled: 'Not installed',
    warpNotInstalled: 'warp-cli not found (not-installed)',
    warpLimit: 'Connected does not mean all traffic uses WARP; this only reports the WARP client state.',
    systemProxy: 'System proxy',
    pac: 'Automatic proxy (PAC)',
    autoDiscovery: 'Automatic proxy discovery',
    pacUrlOmitted: 'PAC URL omitted',
    proxyEnabled: '{count} active',
    proxyDisabled: 'No proxy method active',
    exceptions: 'Exceptions',
    exceptionCount: '{count}; names omitted',
    notApplicable: 'Not applicable',
    proxyNoSingle: 'No single setting',
    proxyNotApplicableShort: 'Process proxies: see HTTPS_PROXY / ALL_PROXY below',
    dns: 'DNS servers',
    dnsNone: 'No DNS servers returned',
    searchOmitted: 'Search domains omitted',
    defaultRoute: 'Default route',
    routeNone: 'No route details returned',
    interfaceIs: 'Interface: {name}',
    on: 'On',
    off: 'Off',
    unavailable: 'Unavailable',
    error: 'Error',
    'status.ok': 'OK',
    'status.reachable': 'Reachable',
    'status.notReachable': 'Not reachable',
    'status.unsupported': 'Unsupported',
    'status.invalid': 'Invalid address',
    'status.notProbed': 'Not probed',
    candidateLimit:
      "These are common default ports for Clash Verge, Clash and v2rayN, not identified processes. HTTPS_PROXY / ALL_PROXY come from this page's host process environment; an older terminal session may differ, so run the host's network diagnosis CLI in that terminal.",
    processProxyTag: '{variable} points here',
    commonFor: 'common for {product}',
    'product.Common Clash Verge mixed port': 'Clash Verge',
    'product.Common Clash HTTP port': 'Clash',
    'product.Common v2rayN SOCKS port': 'v2rayN',
    diagnose: 'Diagnose connection',
    diagnoseAgain: 'Diagnose again',
    diagnosing: 'Diagnosing…',
    loading:
      'Running bounded local commands and TCP probes in parallel. No online probe is sent; this normally takes under two seconds.',
    diagnoseFailed: 'Diagnosis failed: {message}',
    checkedAt: 'Offline diagnosis at {when}',
    empty: 'No Guard targets were supplied. The host can add targets before diagnosing their routes.',
    route: 'Route: ',
    noListener: 'No local TCP probe: the proxy is remote or has no explicit port.',
    probedPort: 'Local listener {host}:{port}',
    tcpLimit:
      'A reachable TCP port does not prove that HTTP CONNECT, SOCKS, TLS, or upstream connectivity works.',
    'support.direct': 'Direct',
    'support.http-connect': 'HTTP CONNECT',
    unsupported:
      'Guard does not support this SOCKS or non-HTTP proxy route. Use HTTP CONNECT or direct before an online Guard check.',
    invalid: 'The proxy address is invalid. Correct the environment and start a new session.',
    'guard.ok': 'Cached Guard: allowed',
    'guard.blocked': 'Cached Guard: blocked',
    'guard.unknown': 'Cached Guard: unknown',
    'guard.not-checked': 'Cached Guard: not checked',
    guardChecked: 'checked {when}',
    'code.not-installed': 'not installed',
    'code.timeout': 'timed out',
    'code.failed': 'failed',
    'code.exit': 'command failed',
    'code.unsupported-platform': 'unsupported platform',
    'code.invalid-host': 'invalid host',
    'code.ECONNREFUSED': 'connection refused',
    'code.ECONNRESET': 'connection reset',
    'code.EHOSTUNREACH': 'host unreachable',
    'code.ENETUNREACH': 'network unreachable',
    'code.EACCES': 'permission denied',
    'code.connection-refused': 'connection refused',
    'code.lookup-failed': 'lookup failed',
    'code.no-country': 'no country returned',
    'code.http-error': 'HTTP error',
    'code.proxy-error': 'proxy error',
    'code.request-failed': 'request failed',
    ask: 'Let AI diagnose',
    fixedOnly:
      'This fixed task contains only the current redacted diagnostic facts above. No free text, attachments, account details, private exception names, or other context is included.',
    actualPrompt: 'Exact prompt to send',
    promptLoading: 'Preparing the actual prompt…',
    promptChanged: 'The prompt changed. Review the new prompt and confirm again; nothing was opened.',
    confirm: 'Open in Orca',
    checkingPrompt: 'Checking prompt again…',
    cancel: 'Cancel',
    close: 'Close',
    opened: 'Orca was asked to open the diagnosis.',
    copyFallback: 'Orca could not be opened. Copy this command and run it in a terminal.',
    copy: 'Copy command',
    command: 'AI diagnosis command',
    requestFailed: 'Request failed ({status})',
  },
  zh: {
    title: 'Network',
    tagline: '查看 WARP、DNS、默认路由、本地代理端口和 Guard 检查目标。',
    intro: '只读、离线查看这台机器的网络设置：不发在线探测，也不改任何设置或路由。',
    overview: '概览',
    systemDetails: 'macOS 系统代理',
    localCandidates: '本地代理候选端口',
    guardTargets: 'Guard 检查目标',
    warp: 'WARP',
    healthy: '网络正常',
    unhealthy: '网络不正常',
    warpHealthUnknown: '没有返回网络状态',
    warpBypassed: '流量不走 WARP',
    warpStateUnknown: '没有读到连接状态',
    warpConnected: '已连接',
    warpDisconnected: '未连接',
    warpUnknown: '未知',
    notInstalled: '未安装',
    warpNotInstalled: '未检测到 warp-cli (not-installed)',
    warpLimit: '已连接不代表所有流量都走 WARP，这里只看 WARP 客户端的状态。',
    systemProxy: '系统代理',
    pac: '自动代理（PAC）',
    autoDiscovery: '自动代理发现',
    pacUrlOmitted: '不显示 PAC 地址',
    proxyEnabled: '{count} 项生效',
    proxyDisabled: '没有生效的代理方式',
    exceptions: '代理例外',
    exceptionCount: '{count} 条，不显示域名',
    notApplicable: '不适用',
    proxyNoSingle: '无统一设置',
    proxyNotApplicableShort: '进程代理看下方 HTTPS_PROXY / ALL_PROXY',
    dns: 'DNS 服务器',
    dnsNone: '没有返回 DNS 服务器',
    searchOmitted: '不显示搜索域',
    defaultRoute: '默认路由',
    routeNone: '没有返回路由详情',
    interfaceIs: '网卡：{name}',
    on: '已开启',
    off: '已关闭',
    unavailable: '不可用',
    error: '出错',
    'status.ok': '正常',
    'status.reachable': '可连接',
    'status.notReachable': '不可连接',
    'status.unsupported': '不支持',
    'status.invalid': '地址无效',
    'status.notProbed': '未探测',
    candidateLimit:
      '这些是 Clash Verge、Clash 和 v2rayN 的常见默认端口，不代表认出了是哪个程序。HTTPS_PROXY / ALL_PROXY 取自本页宿主进程的环境；旧终端会话的环境可能不同，要看它就在那个终端运行宿主的网络诊断 CLI。',
    processProxyTag: '{variable} 指向此端口',
    commonFor: '常见于 {product}',
    diagnose: '诊断连接',
    diagnoseAgain: '重新诊断',
    diagnosing: '正在诊断…',
    loading: '正在并行跑本机命令和 TCP 探测，不发在线探测，一般两秒内完成。',
    diagnoseFailed: '诊断失败：{message}',
    checkedAt: '离线诊断时间：{when}',
    empty: '宿主没有提供检查目标。加上检查目标后，才能诊断它们的路由。',
    route: '路由：',
    noListener: '没有做本机 TCP 探测：代理在远程，或没写明端口。',
    probedPort: '本机监听端口 {host}:{port}',
    tcpLimit: 'TCP 能连上不代表 HTTP CONNECT、SOCKS、TLS 或上游网络可用。',
    'support.direct': '直连',
    'support.http-connect': 'HTTP CONNECT',
    unsupported: 'Guard 不支持这条 SOCKS 或非 HTTP 代理路由。在线 Guard 检查前，请改用 HTTP CONNECT 或直连。',
    invalid: '代理地址无效。请修正环境变量，再新开会话。',
    'guard.ok': '缓存 Guard：允许',
    'guard.blocked': '缓存 Guard：阻止',
    'guard.unknown': '缓存 Guard：未知',
    'guard.not-checked': '缓存 Guard：未检查',
    guardChecked: '检查于 {when}',
    'code.not-installed': '未安装',
    'code.timeout': '超时',
    'code.failed': '失败',
    'code.exit': '命令出错',
    'code.unsupported-platform': '不支持此系统',
    'code.invalid-host': '地址无效',
    'code.ECONNREFUSED': '拒绝连接',
    'code.ECONNRESET': '连接被重置',
    'code.EHOSTUNREACH': '主机不可达',
    'code.ENETUNREACH': '网络不可达',
    'code.EACCES': '没有权限',
    'code.connection-refused': '拒绝连接',
    'code.lookup-failed': '域名解析失败',
    'code.no-country': '没有返回国家',
    'code.http-error': 'HTTP 出错',
    'code.proxy-error': '代理出错',
    'code.request-failed': '请求失败',
    ask: '让 AI 诊断',
    fixedOnly:
      '固定任务只包含上方当前脱敏后的诊断信息，不含自由文本、附件、账号详情、私人例外域名或其他上下文。',
    actualPrompt: '将发送的完整提示词',
    promptLoading: '正在生成实际提示词…',
    promptChanged: '提示词有变化。请查看新提示词后再次确认；这次没有打开终端。',
    confirm: '在 Orca 中打开',
    checkingPrompt: '正在再次核对提示词…',
    cancel: '取消',
    close: '关闭',
    opened: '已请求 Orca 打开诊断任务。',
    copyFallback: '无法打开 Orca。请复制此命令到终端运行。',
    copy: '复制命令',
    command: 'AI 诊断命令',
    requestFailed: '请求失败（{status}）',
  },
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e5f1fa"/><g fill="none" stroke="#236f9f" stroke-width="3"><circle cx="32" cy="32" r="21"/><ellipse cx="32" cy="32" rx="10" ry="21"/><path d="M12 26h40M12 38h40M32 11v42"/></g></svg>`
export const DEFAULT_NETWORK_FAVICON = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

export interface NetworkPageOptions {
  basePath: string
  token: string
  nonce?: string
  version?: string
  lang?: 'auto' | 'en' | 'zh'
  /** Trusted host CSS, inserted after the complete generic fallback. */
  hostStyles?: string
  /** A favicon URL or data URL. The default is an inline generic globe. */
  favicon?: string
  /** Request header used for the token; defaults to a host-neutral name. */
  tokenHeader?: string
  footer?: string
  chrome?: { title?: string; header?: 'plain' | 'bar' }
}

const NETWORK_CSS = `
.network-main { min-width: 0; }
.network-hero { margin-bottom: 20px; }
.network-hero h2 { font-size: var(--title-size); font-weight: var(--title-weight); margin-bottom: 8px; }
.network-hero p { max-width: 760px; color: var(--muted); overflow-wrap: anywhere; }
.network-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 12px; }
.net-note { margin-top: 8px; overflow-wrap: anywhere; }
.net-section { margin-bottom: 24px; min-width: 0; }
.net-overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.net-overview-card { min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.net-card-head { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
.net-card-head h3 { font-size: var(--font-size); font-weight: var(--heading-weight); overflow-wrap: anywhere; }
.net-overview-value { font-size: var(--heading-size); font-weight: var(--strong-weight); overflow-wrap: anywhere; }
.net-detail-panel { min-width: 0; padding: 0; overflow: hidden; }
.net-detail-row { display: grid; grid-template-columns: minmax(100px, 180px) minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--border); }
.net-detail-row:first-child { border-top: 0; }
/* A single sentence (not applicable, unavailable) has no label/value/chip columns to fill. */
p.net-detail-row { display: block; margin: 0; }
.net-detail-value { min-width: 0; overflow-wrap: anywhere; }
.net-detail-row .chip { justify-self: end; }
.net-candidate-list { display: grid; gap: 12px; }
.net-candidate { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 12px; align-items: center; }
.net-candidate h3 { font-size: var(--font-size); overflow-wrap: anywhere; }
.net-tag { display: inline-block; margin-left: 8px; padding: 0 6px; border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent); font-size: var(--small); font-weight: 500; line-height: 18px; vertical-align: 1px; }
.net-candidate .net-candidate-meta { grid-column: 1 / -1; overflow-wrap: anywhere; }
#targets { display: grid; gap: 12px; min-width: 0; }
.net-target { min-width: 0; display: grid; gap: 10px; overflow: hidden; }
.net-target-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; }
.net-target h3 { min-width: 0; font-size: var(--heading-size); overflow-wrap: anywhere; }
.net-target .chip { flex: none; max-width: 100%; white-space: normal; text-align: center; }
.net-route { min-width: 0; overflow-wrap: anywhere; }
.net-route code { overflow-wrap: anywhere; }
.net-target .note { display: block; overflow-wrap: anywhere; }
.net-placeholder { min-height: 96px; }
.net-empty { color: var(--muted); }
.net-prompt { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; max-width: 100%; max-height: 320px; overflow: auto; margin: 0; padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-2); font: 12px/1.55 var(--mono); }
.net-command { width: 100%; min-height: 64px; resize: vertical; background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); border-radius: var(--radius-md); font: 12px var(--mono); }
@media (max-width: 900px) { .net-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) {
  :root { --gutter: 16px; }
  .network-top .top-in { padding-top: 20px; }
  .network-top .tagline { font-size: var(--small); }
  .net-overview { grid-template-columns: minmax(0, 1fr); }
  .net-overview-card, .net-target, .net-candidate { padding: 16px; }
  .net-detail-row { grid-template-columns: minmax(0, 1fr) auto; padding: 12px 16px; }
  .net-detail-row .net-detail-value { grid-column: 1 / -1; grid-row: 2; }
  .net-detail-row .chip { grid-column: 2; grid-row: 1; }
  .net-target-head { flex-direction: column; gap: 8px; }
  .network-actions .btn { flex: 1 1 auto; white-space: normal; min-height: var(--ctl-h); height: auto; padding-top: 8px; padding-bottom: 8px; }
  .dlg-head, .dlg-body, .dlg-foot { padding-left: 16px; padding-right: 16px; }
  .dlg-foot { flex-wrap: wrap; }
}
`

/** JSON safe inside a script element: no closing tag, HTML comment or line separator survives. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029')
}

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** A complete self-contained document. Runtime data arrives only through the host's API routes. */
export function renderNetworkPage(opts: NetworkPageOptions): string {
  if (opts.basePath && (!/^\/(?!\/)/.test(opts.basePath) || /[\\?#]/.test(opts.basePath)))
    throw new TypeError('basePath must be an empty string or a same-origin path prefix')
  const basePath = opts.basePath.replace(/\/+$/, '')
  if (opts.hostStyles && /<\/style/i.test(opts.hostStyles))
    throw new TypeError('hostStyles must not contain a closing style tag')
  const nonce = opts.nonce ? ` nonce="${attr(opts.nonce)}"` : ''
  const lang = opts.lang ?? 'auto'
  const title = opts.chrome?.title ?? 'Network'
  const favicon = opts.favicon ?? DEFAULT_NETWORK_FAVICON
  const footer = opts.footer ?? 'network-portal'
  // A header bar already shows the title as h1; a second visible heading would repeat it.
  const bar = opts.chrome?.header === 'bar'
  const boot = jsonForScript({
    basePath,
    token: opts.token,
    tokenHeader: opts.tokenHeader ?? 'x-network-portal-token',
    version: opts.version ?? '',
    lang,
    title,
  })
  return `<!doctype html>
<html lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<title>${attr(title)}</title>
<link rel="icon" type="image/svg+xml" href="${attr(favicon)}">
<style${nonce}>${fallbackNetworkStyles()}${NETWORK_CSS}${opts.hostStyles ?? ''}</style>
</head>
<body${bar ? ' class="header-bar"' : ''}>
<header class="top network-top">
  <div class="top-in">
    <div class="brand"><span class="logo" aria-hidden="true"><img src="${attr(favicon)}" alt=""></span><div><h1>${attr(title)}</h1><p id="tagline" class="tagline">WARP, DNS, default route, local proxy ports, and Guard targets.</p></div></div>
    <div class="top-actions"><button id="language" class="btn" type="button"${lang === 'auto' ? '' : ' hidden'}>中文</button></div>
  </div>
</header>
<main class="wrap network-main">
  <section class="network-hero"${bar ? ` aria-label="${attr(title)}"` : ' aria-labelledby="title"'}>
    ${bar ? '' : '<h2 id="title">Network</h2>\n    '}<p id="intro">A read-only, offline look at this machine's network setup.</p>
    <div class="network-actions"><button id="diagnose" class="btn btn-primary" type="button" aria-busy="true">Diagnosing…</button><button id="ask-open" class="btn" type="button" aria-haspopup="dialog" hidden>Let AI diagnose</button></div>
    <div id="status"><p class="note" role="status">Running an offline diagnosis. No online probe is sent.</p></div>
  </section>
  <section class="net-section" aria-labelledby="overview-heading"><div class="section-head"><h2 id="overview-heading">Overview</h2></div><div id="overview" class="net-overview" aria-busy="true"><div class="panel net-placeholder"><span class="sk sk-line w70"></span><span class="sk sk-line w50"></span></div><div class="panel net-placeholder"><span class="sk sk-line w70"></span><span class="sk sk-line w50"></span></div><div class="panel net-placeholder"><span class="sk sk-line w70"></span><span class="sk sk-line w50"></span></div><div class="panel net-placeholder"><span class="sk sk-line w70"></span><span class="sk sk-line w50"></span></div></div><p id="warp-limit" class="small muted net-note"></p></section>
  <section id="system-section" class="net-section" aria-labelledby="system-heading"><div class="section-head"><h2 id="system-heading">System proxy</h2></div><div id="system-details" class="panel net-detail-panel" aria-busy="true"><div class="net-detail-row"><span class="sk sk-line w70"></span></div></div></section>
  <section class="net-section" aria-labelledby="local-heading"><div class="section-head"><h2 id="local-heading">Local proxy candidates</h2></div><div id="local-candidates" class="net-candidate-list" aria-busy="true"><div class="panel net-placeholder"><span class="sk sk-line w70"></span><span class="sk sk-line w50"></span></div></div><p id="candidate-limit" class="small muted net-note"></p></section>
  <section class="net-section" aria-labelledby="targets-heading"><div class="section-head"><h2 id="targets-heading">Guard targets</h2></div><div id="targets" aria-live="polite" aria-busy="true"><div class="panel net-placeholder"><span class="sk sk-line w70"></span><span class="sk sk-line w50"></span></div></div><p id="tcp-limit" class="small muted net-note"></p></section>
  <footer class="foot muted small">${attr(footer)}</footer>
</main>
<dialog id="ask-dialog" class="dialog dialog-wide" aria-labelledby="ask-title">
  <div class="dlg-head"><h2 id="ask-title">Let AI diagnose</h2></div>
  <div id="ask-body" class="dlg-body"></div>
  <div class="dlg-foot"><button id="ask-cancel" class="btn" type="button">Cancel</button><button id="ask-confirm" class="btn btn-primary" type="button" disabled>Open in Orca</button></div>
</dialog>
<script type="application/json" id="network-portal-boot"${nonce}>${boot}</script>
<script type="application/json" id="network-i18n"${nonce}>${jsonForScript(MESSAGES)}</script>
<script${nonce}>const BOOT = JSON.parse(document.getElementById('network-portal-boot').textContent); const MESSAGES = JSON.parse(document.getElementById('network-i18n').textContent);${NETWORK_PAGE_SCRIPT}</script>
</body>
</html>`
}
