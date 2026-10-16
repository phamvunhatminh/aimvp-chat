import { PROVIDERS } from './meta'
import type { ProviderId } from './types'

export class ProviderError extends Error {
  readonly status: number | null
  readonly provider: ProviderId | null

  constructor(message: string, status: number | null = null, provider: ProviderId | null = null) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
    this.provider = provider
  }

  /** The key is missing, invalid or revoked: the fix is in Settings. */
  get isAuthError() {
    return this.status === 401
  }
}

/**
 * A readable error for an HTTP failure. Callers normalize provider quirks first
 * (e.g. "out of credits" is 402 here whatever status the provider used).
 */
export function httpError(provider: ProviderId, status: number | null, apiMessage?: string): ProviderError {
  const { name, billingHint } = PROVIDERS[provider]
  const message = (() => {
    switch (status) {
      case 401:
        return `Your ${name} API key is invalid or was revoked. Update it in Settings.`
      case 402:
        return `Your ${name} account is out of credits. ${billingHint}`
      case 403:
        if (provider === 'openrouter') {
          return apiMessage ? `Request blocked by moderation: ${apiMessage}` : 'Request blocked by moderation.'
        }
        return apiMessage || `Your ${name} key is not allowed to use this model.`
      case 404:
        return `This model is not available on ${name}. Pick a different model.`
      case 408:
        return 'The model took too long to respond. Try again.'
      case 429:
        return `Rate limited by ${name}. Wait a moment, or pick a different model.`
      case 500:
      case 502:
      case 503:
      case 529:
        return `${name} is unavailable or overloaded right now. Try again, or pick a different model.`
      default:
        return apiMessage || `${name} request failed${status ? ` (HTTP ${status})` : ''}.`
    }
  })()
  return new ProviderError(message, status, provider)
}

export interface ApiErrorBody {
  message?: string
  code?: number | string
  type?: string
  status?: string
}

/** Reads the `{ error: {...} }` body most providers send with a failed response. */
export async function readErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const body = await res.json()
    return typeof body?.error === 'object' && body.error ? body.error : {}
  } catch {
    return {}
  }
}

export function networkError(provider: ProviderId): ProviderError {
  return new ProviderError(`Could not reach ${PROVIDERS[provider].name}. Check your connection and try again.`, null, provider)
}
