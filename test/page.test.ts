import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_NETWORK_FAVICON, jsonForScript, renderNetworkPage } from '../src/page.ts'
import { NETWORK_PAGE_SCRIPT } from '../src/page-script.ts'

describe('renderNetworkPage', () => {
  it('renders a complete bilingual page with generic styles and favicon', () => {
    const page = renderNetworkPage({ basePath: '', token: 'token' })
    assert.match(page, /<h1>Network<\/h1>/)
    assert.match(page, /id="overview"/)
    assert.match(page, /id="system-details"/)
    assert.match(page, /id="local-candidates"/)
    assert.match(page, /id="targets"[^>]*aria-live="polite"[^>]*aria-busy="true"/)
    assert.match(page, /@media \(max-width: 520px\)/)
    assert.match(page, /macOS 系统代理/)
    assert.match(page, /让 AI 诊断/)
    assert.match(page, /prefers-reduced-motion/)
    assert.ok(page.includes(DEFAULT_NETWORK_FAVICON))
    assert.doesNotMatch(page, /sideby|skills-manager|adonis-brand/i)
    const boot = JSON.parse(/id="network-portal-boot">(.*?)<\/script>/.exec(page)![1]!)
    assert.equal(boot.tokenHeader, 'x-network-portal-token')
  })

  it('accepts host CSS, favicon, token header, footer and chrome', () => {
    const page = renderNetworkPage({
      basePath: '/panel',
      token: 'host-token',
      nonce: 'nonce-value',
      version: '1.2.3',
      lang: 'zh',
      hostStyles: ':root { --accent: #123456; }',
      favicon: 'https://assets.example.test/icon.svg?a=1&b=2',
      tokenHeader: 'x-host-token',
      footer: 'Example <host>',
      chrome: { title: 'Host Network', header: 'bar' },
    })
    assert.match(page, /<html lang="zh-CN">/)
    assert.match(page, /<body class="header-bar">/)
    assert.match(page, /<h1>Host Network<\/h1>/)
    assert.match(page, /--accent: #123456/)
    assert.match(page, /icon\.svg\?a=1&amp;b=2/)
    assert.match(page, /Example &lt;host&gt;/)
    assert.match(page, /nonce="nonce-value"/)
    const boot = JSON.parse(/id="network-portal-boot" nonce="nonce-value">(.*?)<\/script>/.exec(page)![1]!)
    assert.equal(boot.basePath, '/panel')
    assert.equal(boot.token, 'host-token')
    assert.equal(boot.tokenHeader, 'x-host-token')
    assert.equal(boot.version, '1.2.3')
    assert.ok(NETWORK_PAGE_SCRIPT.includes('headers[BOOT.tokenHeader] = token'))
  })

  it('escapes script JSON and rejects a closing style tag', () => {
    const json = jsonForScript({ a: '</script><!--  &' })
    assert.equal(json.includes('</script>'), false)
    assert.equal(json.includes('<!--'), false)
    assert.equal(json.includes(' '), false)
    assert.equal(json.includes(' '), false)
    assert.deepEqual(JSON.parse(json), { a: '</script><!--  &' })
    const page = renderNetworkPage({ basePath: '', token: '</script><script>alert(1)</script>' })
    assert.doesNotMatch(page, /<script>alert\(1\)/)
    assert.throws(
      () => renderNetworkPage({ basePath: '', token: '', hostStyles: '</style><script>alert(1)</script>' }),
      /closing style tag/,
    )
  })

  it('rejects base paths that could send the session token off origin', () => {
    for (const basePath of [
      'https://other.example.test',
      '//other.example.test',
      '/\\other.example.test',
      'panel',
      '/panel?x=1',
      '/panel#x',
    ]) {
      assert.throws(() => renderNetworkPage({ basePath, token: 'host-token' }), /same-origin path/)
    }
    assert.doesNotThrow(() => renderNetworkPage({ basePath: '', token: 'host-token' }))
    assert.doesNotThrow(() => renderNetworkPage({ basePath: '/panel', token: 'host-token' }))
    const root = renderNetworkPage({ basePath: '/', token: 'host-token' })
    const boot = JSON.parse(/id="network-portal-boot">(.*?)<\/script>/.exec(root)![1]!)
    assert.equal(boot.basePath, '')
  })
})
