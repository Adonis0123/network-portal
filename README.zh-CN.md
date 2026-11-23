# network-portal

[English](README.md)

面向 Node.js 22 和原生浏览器的零运行时依赖网络诊断库，提供可嵌入宿主的完整中英文 Network 页面。

## 功能

- 用有界只读命令读取 WARP、系统代理、默认 DNS resolver 和默认路由。
  - macOS：`warp-cli status`、`scutil --proxy`、`scutil --dns` 和 `route -n get default`。
  - Linux：`warp-cli status`、`ip route show default` 和 `/etc/resolv.conf` 的 `nameserver` 行。Linux 没有统一的系统代理设置，代理项返回 `error: 'not-applicable'`；进程代理看 `HTTPS_PROXY` / `ALL_PROXY`。
  - 其他平台各项都返回 unavailable。`NetworkDiagnosis.platform`（`'darwin' | 'linux' | 'other'`）标明走的是哪一套。
- 通过 TCP 探测三个常见 loopback 代理端口，以及选中路由的 loopback listener。`HTTPS_PROXY` / `ALL_PROXY` 指向的常见端口会带上 `processProxy` 标记。
- 组合宿主编入的结构化 target 和缓存 Guard facts。
- 选择并脱敏 `HTTPS_PROXY` / `ALL_PROXY` 路由，支持 `NO_PROXY`。
- 生成完整中英文页面，包含加载、空数据、错误状态、AI 实际 prompt 预览和二次核对。

诊断全程离线，不发在线 trace、不写缓存、不改网络设置，也不读取宿主账号或凭据文件。唯一读取的文件是 Linux 上的 `/etc/resolv.conf`，最多读 32 KiB，只保留 nameserver 地址。TCP listener 可连接不代表代理协议或上游网络可用。

## 安装与构建

```sh
pnpm install
pnpm build
pnpm test
```

运行时依赖为 0。包提供 `network-portal` 和轻量 `network-portal/proxy` 两个入口；后者不加载其他包模块或第三方代码。

## 核心 API

```ts
import { diagnoseNetwork } from 'network-portal'

const diagnosis = await diagnoseNetwork({
  env: process.env,
  targets: [
    {
      url: 'https://api.example.com/cdn-cgi/trace',
      guard: { status: 'not-checked' },
    },
  ],
})
```

宿主负责发现 target 和读取 Guard 缓存，只传 `{ url, guard? }`。库本身不会发现账号或打开缓存。诊断 DTO 只保留 target 的 origin 和有界 Guard 字段，并把错误映射到白名单原因码。测试可通过 `now`、`probe`、`system.platform`、`system.run` 和 `system.readFile` 注入确定性 fake。

根入口导出 `readNetworkSystem`、`diagnoseNetwork`、`probeListener`、`proxyFor`、`redactedProxy`、`routeLabel`、`networkDiagnoseTaskFacts`、`renderNetworkPage` 及 DTO 类型。

## 页面 API 与宿主合同

```ts
import { renderNetworkPage } from 'network-portal'

const html = renderNetworkPage({
  basePath: '',
  token: sessionToken,
  tokenHeader: 'x-host-token',
  nonce: cspNonce,
  lang: 'auto',
  chrome: { title: 'Network', header: 'bar' },
  footer: 'Example host',
})
```

`hostStyles` 可注入可信宿主 CSS；`favicon` 接收 URL 或 data URL。`basePath` 必须为空或 `/panel` 这类同源绝对路径前缀；请求只携带同源凭据并拒绝重定向。包自带通用 fallback 样式和内联地球 favicon，不依赖设计系统或静态资源服务。

浏览器调用以下宿主路由：

- `POST {basePath}/api/network/diagnose`，body 为 `{}`，返回 `NetworkDiagnosis`。
- `POST {basePath}/api/ask/prompt`，body 为固定任务，返回 `{ prompt }`。
- `POST {basePath}/api/ask`，body 为固定任务加 `confirmedPrompt`，返回 `{ opened, command? }`。宿主打开任务前必须重新生成实际 prompt，并要求它与 `confirmedPrompt` 逐字一致。
- 收到 `bad-token` 后调用 `GET {basePath}/api/session`，返回 `{ token }`。

宿主负责身份验证、Host/Origin 检查和 Content Security Policy。页面支持 nonce；启动 JSON 会转义 `<`、`>`、`&` 和 JavaScript 行分隔符，防止 `</script>` 注入。

## CLI

```sh
network-portal diagnose --json
network-portal diagnose
```

独立 CLI 不提供 target。JSON 因此包含 `checkedAt`、`system`、`localProxyCandidates` 和空 `targets` 数组。需要 target 和缓存 Guard facts 时，由宿主调用库 API。

## 许可证

MIT
