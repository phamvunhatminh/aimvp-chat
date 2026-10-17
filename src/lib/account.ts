import type { AuthChangeEvent, AuthError, Session, SupabaseClient, User } from '@supabase/supabase-js'
import { toast } from 'sonner'
import { useAccount, type AccountUser } from '@/stores/account'
import { useUI } from '@/stores/ui'
import { setLocalChangeListener } from './db'
import { setMissingBlobFetcher } from './repo'
import { ACCOUNT_CALLBACK_PATH, accountsEnabled, getSupabase, supabaseRemote } from './supabase'
import { fetchBlob, linkAccount, syncWith, unlinkAccount, watchSettings, type SyncRemote } from './sync'

export type OAuthProvider = 'google' | 'github'

/** Local edits are batched: a streaming reply writes every second. */
const LOCAL_CHANGE_DELAY_MS = 2000
/** How often an open tab checks the account for changes made elsewhere. */
const POLL_MS = 60_000

function toAccountUser(user: User): AccountUser {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>
  const email = user.email ?? ''
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    id: user.id,
    email,
    name: text(meta.full_name) ?? text(meta.name) ?? text(meta.user_name) ?? email.split('@')[0],
    avatarUrl: text(meta.avatar_url),
  }
}

/** Supabase's messages, except a dropped connection, which it reports as a bare "Failed to fetch". */
function authError(error: AuthError): Error {
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) {
    return new Error("Couldn't reach the sign-in service. Check your connection and try again.")
  }
  return new Error(error.message)
}

const callbackUrl = () => new URL(ACCOUNT_CALLBACK_PATH, window.location.origin).toString()

// --- Session ---------------------------------------------------------------

let signedInUserId: string | null = null

/** Follows the Supabase session: signs in from a saved session, and syncs while signed in. */
export async function startAccount(): Promise<void> {
  if (!accountsEnabled) return
  const supabase = await getSupabase()
  supabase.auth.onAuthStateChange((event, session) => {
    // Supabase asks that its own calls not be awaited inside this callback.
    setTimeout(() => void onAuthChange(supabase, event, session))
  })
}

async function onAuthChange(supabase: SupabaseClient, event: AuthChangeEvent, session: Session | null) {
  if (event === 'PASSWORD_RECOVERY') useAccount.setState({ recovering: true })
  if (!session) {
    stopSyncing()
    signedInUserId = null
    useAccount.setState({ status: 'signed-out', user: null, sync: 'idle', syncError: null, lastSyncedAt: null })
    return
  }
  useAccount.setState({ status: 'signed-in', user: toAccountUser(session.user) })
  useUI.getState().setSignInOpen(false)
  // Token refreshes and profile updates keep the same user.
  if (signedInUserId === session.user.id) return
  signedInUserId = session.user.id
  if ((await linkAccount(session.user.id)) === 'replaced') {
    toast('Chats from the previous account were removed from this device.')
  }
  startSyncing(supabaseRemote(supabase, session.user.id))
}

// --- Sync loop -------------------------------------------------------------

let remote: SyncRemote | null = null
let stopLoop: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let running: Promise<void> | null = null
let queued: Promise<void> | null = null

function startSyncing(r: SyncRemote) {
  stopSyncing()
  remote = r
  setMissingBlobFetcher((id) => fetchBlob(r, id))
  setLocalChangeListener(() => scheduleSync(LOCAL_CHANGE_DELAY_MS))
  const stopWatchingSettings = watchSettings(() => scheduleSync(LOCAL_CHANGE_DELAY_MS))
  const checkNow = () => {
    if (document.visibilityState === 'visible') scheduleSync(0)
  }
  window.addEventListener('online', checkNow)
  window.addEventListener('focus', checkNow)
  document.addEventListener('visibilitychange', checkNow)
  const poll = setInterval(checkNow, POLL_MS)
  stopLoop = () => {
    window.removeEventListener('online', checkNow)
    window.removeEventListener('focus', checkNow)
    document.removeEventListener('visibilitychange', checkNow)
    clearInterval(poll)
    clearTimeout(timer)
    setLocalChangeListener(null)
    setMissingBlobFetcher(null)
    stopWatchingSettings()
  }
  scheduleSync(0)
}

function stopSyncing() {
  stopLoop?.()
  stopLoop = null
  remote = null
}

function scheduleSync(delay: number) {
  clearTimeout(timer)
  // Failures show in the account's sync status, and the next trigger retries.
  timer = setTimeout(() => void syncNow().catch(() => {}), delay)
}

/** One sync at a time across tabs, where the browser can coordinate them. */
function exclusively<T>(work: () => Promise<T>): Promise<T> {
  return navigator.locks ? navigator.locks.request('aimvp.sync', work) : work()
}

/** Syncs now, or right after the round already under way. Rejects if it fails. */
export function syncNow(): Promise<void> {
  if (running) {
    queued ??= running
      .catch(() => {})
      .then(() => {
        queued = null
        return syncNow()
      })
    return queued
  }
  const r = remote
  if (!r) return Promise.resolve()
  running = (async () => {
    useAccount.setState({ sync: 'syncing' })
    try {
      await exclusively(() => syncWith(r))
      if (remote === r) useAccount.setState({ sync: 'idle', syncError: null, lastSyncedAt: Date.now() })
    } catch (err) {
      if (remote === r) {
        useAccount.setState({ sync: navigator.onLine ? 'error' : 'offline', syncError: (err as Error).message })
      }
      throw err
    } finally {
      running = null
    }
  })()
  return running
}

// --- Signing in and out ----------------------------------------------------

/** Leaves for Google or GitHub, which send the user back to the callback page. */
export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: callbackUrl() } })
  if (error) throw authError(error)
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw authError(error)
}

/** Creates an account. False when the user must confirm their email before signing in. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const supabase = await getSupabase()
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callbackUrl() } })
  if (error) throw authError(error)
  return !!data.session
}

export async function sendPasswordReset(email: string): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl() })
  if (error) throw authError(error)
}

export async function setNewPassword(password: string): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw authError(error)
  useAccount.setState({ recovering: false })
}

let pendingExchange: { code: string; promise: Promise<void> } | null = null

/**
 * Finishes signing in on the callback page. A password reset link signs in too, and
 * Supabase then reports PASSWORD_RECOVERY, which opens the new password dialog.
 */
export function completeSignIn(code: string): Promise<void> {
  // React StrictMode runs effects twice in dev; a code can only be redeemed once.
  if (pendingExchange?.code === code) return pendingExchange.promise
  const promise = (async () => {
    const supabase = await getSupabase()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      if (error.name === 'AuthPKCECodeVerifierMissingError') {
        throw new Error(
          'This link was opened in a different browser from the one you signed up in. ' +
            'If it confirmed your email, you can now sign in here.',
        )
      }
      throw authError(error)
    }
  })()
  pendingExchange = { code, promise }
  return promise
}

/**
 * Sends what's left to the account, signs out, and removes the account's data from
 * this device. `force` signs out even when the last changes can't be sent.
 */
export async function signOut({ force = false } = {}): Promise<void> {
  if (!force) await syncNow()
  const supabase = await getSupabase()
  stopSyncing()
  signedInUserId = null
  const { error } = await supabase.auth.signOut({ scope: 'local' })
  if (error) throw authError(error)
  await unlinkAccount()
}
