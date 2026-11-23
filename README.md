# network-portal

[中文](README.zh-CN.md)

Zero-runtime-dependency network diagnosis and a host-embeddable bilingual Network page for Node.js 22 and native browsers.

## What it does

- Reads WARP, macOS system proxy, default DNS resolver and default route with bounded, read-only commands.
- Probes three common loopback proxy ports and selected loopback proxy listeners over TCP.
- Combines structured targets with cached Guard facts supplied by the host.
- Selects and redacts `HTTPS_PROXY` / `ALL_PROXY` routes, including `NO_PROXY` handling.
- Renders a complete English and Chinese page with loading, empty and error states, an exact AI prompt preview and second-prompt confirmation.

Diagnosis is offline. It sends no online trace, writes no cache, changes no network setting and reads no host account or config files. A reachable TCP listener does not prove the proxy protocol or upstream connectivity works.

## Install and build

```sh
pnpm install
pnpm build
pnpm test
```

The runtime dependency list is empty. The package exports `network-portal` and the lightweight `network-portal/proxy` entry point. The proxy entry point loads no package modules or third-party code.

## Core API

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

The host owns target discovery and Guard caching. It passes only `{ url, guard? }`; the package never discovers accounts or opens a cache itself. The diagnosis DTO reduces targets to origins, selects only bounded Guard fields and maps errors to an allowlist of reason codes. Use `now`, `probe` and `system.run` to inject deterministic fakes in tests.

The root exports `readNetworkSystem`, `diagnoseNetwork`, `probeListener`, `proxyFor`, `redactedProxy`, `routeLabel`, `networkDiagnoseTaskFacts`, `renderNetworkPage` and their DTO types.

## Page API and host contract

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

`hostStyles` optionally replaces the visual theme with trusted host CSS; `favicon` accepts a URL or data URL. `basePath` must be empty or a same-origin absolute path prefix such as `/panel`; requests use same-origin credentials and reject redirects. The package supplies working generic fallback styles and an inline globe favicon, so neither a design system nor a static asset server is required.

The browser calls these host routes:

- `POST {basePath}/api/network/diagnose` with `{}`, returning `NetworkDiagnosis`.
- `POST {basePath}/api/ask/prompt` with the fixed task body, returning `{ prompt }`.
- `POST {basePath}/api/ask` with the fixed task body plus `confirmedPrompt`, returning `{ opened, command? }`. Before opening a task, the host must regenerate the actual prompt and require an exact match with `confirmedPrompt`.
- `GET {basePath}/api/session` after a `bad-token` response, returning `{ token }`.

The host must provide authentication, Host/Origin checks and a Content Security Policy. The page accepts a nonce and serializes boot JSON with `<`, `>`, `&` and JavaScript line separators escaped, preventing `</script>` injection.

## CLI

```sh
network-portal diagnose --json
network-portal diagnose
```

The standalone CLI supplies no targets. Its JSON therefore contains `checkedAt`, `system`, `localProxyCandidates` and an empty `targets` array. Embed the library when a host needs to add targets and cached Guard facts.

## License

MIT
