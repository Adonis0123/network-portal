import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { proxyFor, redactedProxy, routeLabel } from '../src/proxy.ts'

const URL_A = 'https://api.anthropic.com/cdn-cgi/trace'

describe('proxy selection', () => {
  it('takes HTTPS_PROXY first, then ALL_PROXY, and honours NO_PROXY', () => {
    assert.equal(proxyFor(URL_A, {}), null)
    assert.equal(proxyFor(URL_A, { HTTPS_PROXY: 'http://127.0.0.1:7890' }), 'http://127.0.0.1:7890')
    assert.equal(proxyFor(URL_A, { https_proxy: 'http://a:1', ALL_PROXY: 'http://b:2' }), 'http://a:1')
    assert.equal(proxyFor(URL_A, { ALL_PROXY: 'http://b:2' }), 'http://b:2')
    assert.equal(proxyFor(URL_A, { HTTPS_PROXY: 'http://a:1', NO_PROXY: 'localhost,.anthropic.com' }), null)
    assert.equal(proxyFor(URL_A, { HTTPS_PROXY: 'http://a:1', NO_PROXY: 'anthropic.com:443' }), null)
    assert.equal(proxyFor(URL_A, { HTTPS_PROXY: 'http://a:1', NO_PROXY: '*' }), null)
    assert.equal(proxyFor(URL_A, { HTTPS_PROXY: 'http://a:1', NO_PROXY: 'openai.com' }), 'http://a:1')
  })

  it('redacts credentials and paths and labels direct and invalid routes', () => {
    assert.equal(
      redactedProxy('http://user:password@127.0.0.1:10809/path?token=secret#fragment'),
      'http://127.0.0.1:10809',
    )
    assert.equal(redactedProxy('socks5://user:password@127.0.0.1:10808/private'), 'socks5://127.0.0.1:10808')
    assert.equal(redactedProxy(null), 'direct')
    assert.equal(redactedProxy('http://user:password@not a host'), 'invalid')
    assert.equal(
      routeLabel(URL_A, { HTTPS_PROXY: 'user:password@127.0.0.1:7890/private' }),
      'http://127.0.0.1:7890',
    )
  })

  it('honours NO_PROXY ports, default ports and bracketed IPv6', () => {
    const env = { HTTPS_PROXY: 'http://proxy.example.com:8080', NO_PROXY: 'example.com:8443' }
    assert.equal(proxyFor('https://example.com:8443/path', env), null)
    assert.equal(proxyFor('https://example.com/path', env), 'http://proxy.example.com:8080')
    assert.equal(proxyFor('https://example.com:443/path', { ...env, NO_PROXY: 'example.com:443' }), null)
    assert.equal(proxyFor('https://example.com/path', { ...env, NO_PROXY: 'example.com:443' }), null)
    assert.equal(proxyFor('https://example.com/path', { ...env, NO_PROXY: 'example.com:0443' }), null)
    assert.equal(proxyFor('https://[::1]/path', { ...env, NO_PROXY: '[0:0:0:0:0:0:0:1]:443' }), null)
    assert.equal(proxyFor('https://[::1]:8443/path', { ...env, NO_PROXY: '[::1]:8443' }), null)
    assert.equal(proxyFor('https://[::1]/path', { ...env, NO_PROXY: '[::1]:8443' }), env.HTTPS_PROXY)
  })
})
