import type { BrowserContext, Route } from '@playwright/test'
import { makePng } from './files'

/** The project the e2e build points at (see playwright.config.ts). */
export const SUPABASE_URL = 'https://e2e.supabase.co'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': '*',
}

interface FakeUser {
  id: string
  email: string
  password: string | null
  metadata: Record<string, unknown>
  provider: string
}

interface StoredRecord {
  kind: string
  id: string
  data: unknown
  updated_at: number
  modified_at: string
}

export const GITHUB_USER = { email: 'octo@example.com', name: 'Octo Cat', avatar: 'https://avatars.githubusercontent.com/u/1' }

/** base64url of JSON, for a JWT-shaped access token. */
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

/**
 * Supabase as the app uses it: email and GitHub sign-in, `sync_records` with the
 * last-write-wins `push_records`, and the `attachments` bucket. Shared by every
 * browser context it's attached to, so two contexts act as two devices.
 */
export class FakeSupabase {
  users: FakeUser[] = []
  records = new Map<string, StoredRecord & { user_id: string }>()
  files = new Map<string, { body: Buffer; type: string }>()
  /** Password reset emails sent, with the link in each. */
  resets: { email: string; link: string }[] = []
  private clock = Date.parse('2026-10-01T00:00:00Z')
  private codes = new Map<string, FakeUser>()

  recordsOf(kind: string) {
    return [...this.records.values()].filter((r) => r.kind === kind)
  }

  private session(user: FakeUser) {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', aud: 'authenticated', email: user.email, exp })}.sig`
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: exp,
      refresh_token: `refresh-${user.id}`,
      user: {
        id: user.id,
        aud: 'authenticated',
        role: 'authenticated',
        email: user.email,
        app_metadata: { provider: user.provider, providers: [user.provider] },
        user_metadata: user.metadata,
        identities: [],
        created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-01T00:00:00Z',
      },
    }
  }

  private userOf(route: Route) {
    const token = route.request().headers().authorization?.replace(/^Bearer /, '') ?? ''
    const sub = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString() || '{}').sub
    return this.users.find((u) => u.id === sub) ?? null
  }

  private authError(route: Route, status: number, code: string, msg: string) {
    return route.fulfill({ status, json: { code: status, error_code: code, msg }, headers })
  }

  async attach(context: BrowserContext) {
    await context.route(`${SUPABASE_URL}/**`, (route) => this.handle(route))
    // GitHub profile pictures.
    await context.route('https://avatars.githubusercontent.com/**', (route) =>
      route.fulfill({ body: makePng(8, 8, [40, 40, 40]), headers: { ...headers, 'Content-Type': 'image/png' } }),
    )
  }

  private async handle(route: Route) {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const url = new URL(request.url())
    const path = url.pathname

    // --- Auth
    if (path === '/auth/v1/signup') {
      const { email, password } = request.postDataJSON()
      if (this.users.some((u) => u.email === email)) return this.authError(route, 422, 'user_already_exists', 'User already registered')
      const user = { id: crypto.randomUUID(), email, password, metadata: {}, provider: 'email' }
      this.users.push(user)
      return route.fulfill({ json: this.session(user), headers })
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = request.postDataJSON()
      const user = this.users.find((u) => u.email === email && u.password === password)
      if (!user) return this.authError(route, 400, 'invalid_credentials', 'Invalid login credentials')
      return route.fulfill({ json: this.session(user), headers })
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      const { auth_code } = request.postDataJSON()
      const user = this.codes.get(auth_code)
      if (!user) return this.authError(route, 400, 'flow_state_not_found', 'invalid flow state, no valid flow state found')
      this.codes.delete(auth_code)
      return route.fulfill({ json: this.session(user), headers })
    }
    if (path === '/auth/v1/authorize') {
      // Straight back from "GitHub", as if the user approved.
      let user = this.users.find((u) => u.email === GITHUB_USER.email)
      if (!user) {
        user = {
          id: crypto.randomUUID(),
          email: GITHUB_USER.email,
          password: null,
          metadata: { full_name: GITHUB_USER.name, avatar_url: GITHUB_USER.avatar },
          provider: url.searchParams.get('provider') ?? 'github',
        }
        this.users.push(user)
      }
      const code = crypto.randomUUID()
      this.codes.set(code, user)
      const back = new URL(url.searchParams.get('redirect_to')!)
      back.searchParams.set('code', code)
      return route.fulfill({ status: 302, headers: { Location: back.toString() } })
    }
    if (path === '/auth/v1/recover') {
      const { email } = request.postDataJSON()
      const user = this.users.find((u) => u.email === email)
      // Supabase checks the email link, then sends the user to `redirect_to` with a code.
      const link = new URL(url.searchParams.get('redirect_to')!)
      if (user) {
        const code = crypto.randomUUID()
        this.codes.set(code, user)
        link.searchParams.set('code', code)
      }
      this.resets.push({ email, link: link.toString() })
      return route.fulfill({ json: {}, headers })
    }
    if (path === '/auth/v1/user') {
      const user = this.userOf(route)
      if (!user) return this.authError(route, 401, 'bad_jwt', 'invalid JWT')
      if (request.method() === 'PUT') user.password = request.postDataJSON().password ?? user.password
      return route.fulfill({ json: this.session(user).user, headers })
    }
    if (path === '/auth/v1/logout') return route.fulfill({ status: 204, headers })

    // Everything below needs a signed-in user.
    const user = this.userOf(route)
    if (!user) return route.fulfill({ status: 401, json: { message: 'JWT required' }, headers })

    // --- Database
    if (path === '/rest/v1/rpc/push_records') {
      for (const r of request.postDataJSON().records as Omit<StoredRecord, 'modified_at'>[]) {
        const key = `${user.id}:${r.kind}:${r.id}`
        const current = this.records.get(key)
        if (current && current.updated_at >= r.updated_at) continue
        this.records.set(key, { ...r, user_id: user.id, modified_at: new Date(this.clock++).toISOString() })
      }
      return route.fulfill({ status: 204, headers })
    }
    if (path === '/rest/v1/sync_records') {
      const since = url.searchParams.get('modified_at')?.replace(/^gt\./, '')
      const limit = Number(url.searchParams.get('limit') ?? 1000)
      const rows = [...this.records.values()]
        .filter((r) => r.user_id === user.id && (!since || Date.parse(r.modified_at) > Date.parse(since)))
        .sort((a, b) => Date.parse(a.modified_at) - Date.parse(b.modified_at))
        .slice(0, limit)
        .map(({ kind, id, data, updated_at, modified_at }) => ({ kind, id, data, updated_at, modified_at }))
      return route.fulfill({ json: rows, headers })
    }

    // --- Storage
    const prefix = '/storage/v1/object/attachments'
    if (path === prefix && request.method() === 'DELETE') {
      const { prefixes } = request.postDataJSON() as { prefixes: string[] }
      for (const name of prefixes) if (name.startsWith(`${user.id}/`)) this.files.delete(name)
      return route.fulfill({ json: [], headers })
    }
    if (path.startsWith(`${prefix}/`)) {
      const name = decodeURIComponent(path.slice(prefix.length + 1))
      if (!name.startsWith(`${user.id}/`)) return route.fulfill({ status: 403, json: { statusCode: '403', message: 'Forbidden' }, headers })
      if (request.method() === 'POST') {
        if (this.files.has(name)) {
          return route.fulfill({ status: 409, json: { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, headers })
        }
        this.files.set(name, { body: request.postDataBuffer() ?? Buffer.alloc(0), type: request.headers()['content-type'] })
        return route.fulfill({ json: { Key: `attachments/${name}`, Id: crypto.randomUUID() }, headers })
      }
      const file = this.files.get(name)
      if (!file) return route.fulfill({ status: 400, json: { statusCode: '404', error: 'not_found', message: 'Object not found' }, headers })
      return route.fulfill({ body: file.body, headers: { ...headers, 'Content-Type': file.type } })
    }
    return route.fulfill({ status: 404, json: { message: `No fake for ${request.method()} ${path}` }, headers })
  }
}
