import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccountRecord, SyncRemote } from './sync'

const SUPABASE_URL: string | undefined = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

/** Accounts exist when the build names a Supabase project (see supabase/README.md). */
export const accountsEnabled = !!(SUPABASE_URL && SUPABASE_KEY)

/** Supabase redirects here after signing in with Google or GitHub, and from email links. */
export const ACCOUNT_CALLBACK_PATH = '/auth/account'

const BUCKET = 'attachments'

let client: Promise<SupabaseClient> | null = null

/** The Supabase client, loaded on first use so it stays out of the main bundle. */
export function getSupabase(): Promise<SupabaseClient> {
  if (!accountsEnabled) throw new Error('Accounts are not set up in this build.')
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL!, SUPABASE_KEY!, {
      auth: {
        flowType: 'pkce',
        // The callback page exchanges the code itself: OpenRouter's callback also carries a `?code=`.
        detectSessionInUrl: false,
        storageKey: 'aimvp.auth',
      },
    }),
  )
  return client
}

/** Storage errors carry the HTTP status, or the one in the error body. */
function hasStatus(error: unknown, status: number): boolean {
  const e = error as { status?: unknown; statusCode?: unknown }
  return e.status === status || e.statusCode === String(status)
}

/** The account's data in Supabase: `sync_records` rows, and files under the user's folder. */
export function supabaseRemote(supabase: SupabaseClient, userId: string): SyncRemote {
  const bucket = supabase.storage.from(BUCKET)
  const path = (id: string) => `${userId}/${id}`
  return {
    async push(records: AccountRecord[]) {
      const rows = records.map((r) => ({ kind: r.kind, id: r.id, data: r.data, updated_at: r.updatedAt }))
      const { error } = await supabase.rpc('push_records', { records: rows })
      if (error) throw new Error(error.message)
    },
    async pull(since, limit) {
      let query = supabase
        .from('sync_records')
        .select('kind, id, data, updated_at, modified_at')
        .order('modified_at')
        .limit(limit)
      if (since) query = query.gt('modified_at', since)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return data.map((r) => ({
        kind: r.kind,
        id: r.id,
        data: r.data,
        updatedAt: Number(r.updated_at),
        modifiedAt: r.modified_at,
      }))
    },
    async uploadBlob(id, data, mimeType) {
      const { error } = await bucket.upload(path(id), data, { contentType: mimeType, upsert: false })
      // Files never change, so one already there is this one.
      if (error && !hasStatus(error, 409)) throw new Error(error.message)
    },
    async downloadBlob(id) {
      const { data, error } = await bucket.download(path(id))
      if (error) {
        if (hasStatus(error, 404)) return null
        throw new Error(error.message)
      }
      return { data: await data.arrayBuffer(), mimeType: data.type || 'application/octet-stream' }
    },
    async removeBlobs(ids) {
      const { error } = await bucket.remove(ids.map(path))
      if (error) throw new Error(error.message)
    },
  }
}
