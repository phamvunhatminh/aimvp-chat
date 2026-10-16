import { afterEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse } from '@/test/sse-response'
import { buildAuthUrl, completeOpenRouterAuth, createCodeChallenge, createCodeVerifier } from './oauth'

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('PKCE', () => {
  it('matches the RFC 7636 S256 test vector', async () => {
    expect(await createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('creates URL-safe verifiers of the required length', () => {
    const verifier = createCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createCodeVerifier()).not.toBe(verifier)
  })

  it('builds the OpenRouter authorization URL', async () => {
    const url = new URL(await buildAuthUrl('https://aimvp.app', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth')
    expect(url.searchParams.get('callback_url')).toBe('https://aimvp.app/auth/callback')
    expect(url.searchParams.get('code_challenge')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('completeOpenRouterAuth', () => {
  it('exchanges the code with the stored verifier, once per code', async () => {
    sessionStorage.setItem('aimvp.oauth.verifier', 'verifier-1')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ key: 'sk-or-new', user_id: null }))
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([completeOpenRouterAuth('code-1'), completeOpenRouterAuth('code-1')])
    expect(a).toBe('sk-or-new')
    expect(b).toBe('sk-or-new')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/auth/keys')
    expect(JSON.parse(init.body)).toEqual({ code: 'code-1', code_verifier: 'verifier-1', code_challenge_method: 'S256' })
    expect(sessionStorage.getItem('aimvp.oauth.verifier')).toBeNull()
  })

  it('fails clearly when the verifier is missing', async () => {
    await expect(completeOpenRouterAuth('code-2')).rejects.toThrow(/expired/)
  })
})
