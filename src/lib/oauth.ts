import { OPENROUTER_API, OpenRouterError } from './openrouter'

// OAuth PKCE flow: https://openrouter.ai/docs/guides/overview/auth/oauth
const VERIFIER_KEY = 'aimvp.oauth.verifier'
export const CALLBACK_PATH = '/auth/callback'

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function createCodeVerifier(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)))
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(digest))
}

export async function buildAuthUrl(origin: string, verifier: string): Promise<string> {
  const url = new URL('https://openrouter.ai/auth')
  url.searchParams.set('callback_url', new URL(CALLBACK_PATH, origin).toString())
  url.searchParams.set('code_challenge', await createCodeChallenge(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

/** Sends the user to OpenRouter to approve a key for this app. */
export async function startOpenRouterAuth(): Promise<void> {
  const verifier = createCodeVerifier()
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  window.location.assign(await buildAuthUrl(window.location.origin, verifier))
}

let pendingExchange: { code: string; promise: Promise<string> } | null = null

/** Exchanges the `code` from the callback URL for a user-controlled API key. */
export function completeOpenRouterAuth(code: string): Promise<string> {
  // React StrictMode runs effects twice in dev; a code can only be redeemed once.
  if (pendingExchange?.code === code) return pendingExchange.promise
  const promise = exchangeCode(code)
  pendingExchange = { code, promise }
  return promise
}

async function exchangeCode(code: string): Promise<string> {
  const verifier = sessionStorage.getItem(VERIFIER_KEY)
  if (!verifier) {
    throw new OpenRouterError('This sign-in link has expired. Please connect again.')
  }
  const res = await fetch(`${OPENROUTER_API}/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  })
  sessionStorage.removeItem(VERIFIER_KEY)
  if (!res.ok) {
    throw new OpenRouterError('OpenRouter could not complete the sign-in. Please try again.', res.status)
  }
  const body = (await res.json()) as { key?: string }
  if (!body.key) throw new OpenRouterError('OpenRouter did not return a key. Please try again.')
  return body.key
}
