import type { EntityTable } from 'dexie'
import {
  ACCOUNT_SETTINGS,
  parseAccountSettings,
  pickAccountSettings,
  useSettings,
} from '@/stores/settings'
import { db, type Conversation, type Message, type Project, type SavedPrompt, type StoredBlob, type SyncFlag } from './db'
import {
  blobIdsOf,
  now,
  OWNER_KEY,
  toConversation,
  toMessage,
  toProject,
  toPrompt,
  withoutSyncFlag,
} from './repo'

export type RecordKind = 'project' | 'conversation' | 'message' | 'prompt' | 'settings'

/** A record as the account stores it: the local record, keyed by kind and id. */
export interface AccountRecord {
  kind: RecordKind
  id: string
  data: unknown
  updatedAt: number
}

export interface PulledRecord extends AccountRecord {
  /** When the account last took a change to it, by the server's clock. */
  modifiedAt: string
}

/** The signed-in account's copy of the data: Supabase in the app, a fake in tests. */
export interface SyncRemote {
  /** Stores records, keeping the account's copy where it is newer. */
  push(records: AccountRecord[]): Promise<void>
  /** Records modified after `since`, oldest first; from the start when `since` is null. */
  pull(since: string | null, limit: number): Promise<PulledRecord[]>
  uploadBlob(id: string, data: ArrayBuffer, mimeType: string): Promise<void>
  /** Null when the account doesn't have the file. */
  downloadBlob(id: string): Promise<{ data: ArrayBuffer; mimeType: string } | null>
  removeBlobs(ids: string[]): Promise<void>
}

type Syncable = Project | Conversation | Message | SavedPrompt

interface Kind<T extends Syncable> {
  kind: Exclude<RecordKind, 'settings'>
  table: EntityTable<T & SyncFlag, 'id'>
  parse: (raw: unknown) => T | null
}

// Parents before children, so another device never pulls a message before its chat.
const KINDS = [
  { kind: 'project', table: db.projects, parse: toProject } satisfies Kind<Project>,
  { kind: 'conversation', table: db.conversations, parse: toConversation } satisfies Kind<Conversation>,
  { kind: 'message', table: db.messages, parse: toMessage } satisfies Kind<Message>,
  { kind: 'prompt', table: db.prompts, parse: toPrompt } satisfies Kind<SavedPrompt>,
] as Kind<Syncable>[]

const SETTINGS_ID = 'preferences'
const CURSOR_KEY = 'cursor'
const SETTINGS_KEY = 'settings'
const PULL_PAGE = 500
/** A row committed late can land just behind the cursor; reading back a little catches it, and re-applying is harmless. */
const PULL_OVERLAP_MS = 10_000
const PUSH_BATCH_BYTES = 1_000_000
const REMOVE_BATCH = 500

/** When the synced preferences last changed here, and whether the account has that version. */
interface SettingsMeta {
  updatedAt: number
  synced: boolean
}

async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

const ALL_TABLES = [db.projects, db.conversations, db.messages, db.prompts, db.blobs, db.deletedBlobs, db.meta]

/**
 * Gets this device's data ready to sync with `userId`. Data that was never synced
 * joins the account; data from another account is removed (that account keeps it).
 */
export async function linkAccount(userId: string): Promise<'same' | 'joined' | 'replaced'> {
  return db.transaction('rw', ALL_TABLES, async () => {
    const owner = await getMeta<string>(OWNER_KEY)
    if (owner === userId) return 'same'
    if (owner) await Promise.all(ALL_TABLES.map((table) => table.clear()))
    // Nothing deleted before now ever reached this account.
    else await db.deletedBlobs.clear()
    await db.meta.put({ key: OWNER_KEY, value: userId })
    return owner ? 'replaced' : 'joined'
  })
}

/** Removes the account's data from this device, after signing out. */
export async function unlinkAccount(): Promise<void> {
  await db.transaction('rw', ALL_TABLES, () => Promise.all(ALL_TABLES.map((table) => table.clear())))
}

/** One round: take the account's changes, then send this device's. */
export async function syncWith(remote: SyncRemote): Promise<void> {
  await pull(remote)
  // Preferences never changed here still join an account that has none.
  if (!(await getMeta(SETTINGS_KEY))) await markSettingsChanged()
  await pushDeletedBlobs(remote)
  // A file that won't upload mustn't hold up everything else; the round still fails with its error.
  const fileError = await pushBlobs(remote)
  await pushRecords(remote)
  await pushSettings(remote)
  if (fileError) throw fileError
}

// --- Pull ------------------------------------------------------------------

async function pull(remote: SyncRemote): Promise<void> {
  let cursor = await getMeta<string>(CURSOR_KEY)
  let since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null
  for (;;) {
    const page = await remote.pull(since, PULL_PAGE)
    await apply(page)
    const last = page.at(-1)?.modifiedAt
    if (last) {
      since = last
      if (!cursor || Date.parse(last) > Date.parse(cursor)) cursor = last
      await db.meta.put({ key: CURSOR_KEY, value: cursor })
    }
    if (page.length < PULL_PAGE) return
  }
}

async function apply(records: PulledRecord[]): Promise<void> {
  await db.fromAccount([db.projects, db.conversations, db.messages, db.prompts, db.blobs], async () => {
    for (const { kind, table, parse } of KINDS) {
      const incoming = records
        .filter((r) => r.kind === kind)
        .map((r) => parse(r.data))
        .filter((r) => r !== null)
      if (!incoming.length) continue
      const existing = await table.bulkGet(incoming.map((r) => r.id))
      const newer = incoming.filter((r, i) => {
        const local = existing[i]
        if (!local) return true
        // A reply still streaming here is newer than anything the account has.
        return local.updatedAt < r.updatedAt && !(kind === 'message' && (local as Message).status === 'streaming')
      })
      if (kind === 'message') {
        // A message deleted elsewhere takes its files with it.
        const deleted = new Set(newer.filter((r) => r.deletedAt).map((r) => r.id))
        await db.blobs.bulkDelete(blobIdsOf(existing.filter((m): m is Message => !!m && deleted.has(m.id))))
      }
      await table.bulkPut(newer.map((r) => ({ ...r, synced: 1 as const })))
    }
  })
  const settings = records.findLast((r) => r.kind === 'settings' && r.id === SETTINGS_ID)
  if (settings) await applySettings(settings)
}

// --- Push ------------------------------------------------------------------

/** Groups records into requests of about `PUSH_BATCH_BYTES`. */
function batches<T>(records: T[]): T[][] {
  const out: T[][] = []
  let size = Infinity
  for (const r of records) {
    const bytes = JSON.stringify(r).length
    if (size + bytes > PUSH_BATCH_BYTES) {
      out.push([])
      size = 0
    }
    out.at(-1)!.push(r)
    size += bytes
  }
  return out
}

async function pushRecords(remote: SyncRemote): Promise<void> {
  for (const { kind, table } of KINDS) {
    const changed = (await table.where('synced').equals(0).toArray()).filter(
      // A reply is sent once it has finished.
      (r) => !(kind === 'message' && (r as Message).status === 'streaming'),
    )
    for (const batch of batches(changed)) {
      await remote.push(batch.map((r) => ({ kind, id: r.id, data: withoutSyncFlag(r), updatedAt: r.updatedAt })))
      // Records edited while the request was out stay marked, for the next round.
      const sent = new Map(batch.map((r) => [r.id, r.updatedAt]))
      await db.fromAccount([table], () =>
        table
          .where('id')
          .anyOf([...sent.keys()])
          .filter((r) => sent.get(r.id) === r.updatedAt)
          .modify({ synced: 1 }),
      )
    }
  }
}

/** Uploads new files; returns the first error, after trying them all. */
async function pushBlobs(remote: SyncRemote): Promise<unknown> {
  let firstError: unknown = null
  for (const id of await db.blobs.where('synced').equals(0).primaryKeys()) {
    const blob = await db.blobs.get(id)
    if (!blob) continue
    try {
      await remote.uploadBlob(id, blob.data, blob.mimeType)
      await db.fromAccount([db.blobs], () => db.blobs.update(id, { synced: 1 }))
    } catch (err) {
      firstError ??= err
    }
  }
  return firstError
}

async function pushDeletedBlobs(remote: SyncRemote): Promise<void> {
  const ids = await db.deletedBlobs.toCollection().primaryKeys()
  for (let i = 0; i < ids.length; i += REMOVE_BATCH) {
    const batch = ids.slice(i, i + REMOVE_BATCH)
    await remote.removeBlobs(batch)
    await db.deletedBlobs.bulkDelete(batch)
  }
}

// --- Files -----------------------------------------------------------------

const downloads = new Map<string, Promise<StoredBlob | undefined>>()

/** Downloads a file this device doesn't have yet and keeps it. */
export function fetchBlob(remote: SyncRemote, id: string): Promise<StoredBlob | undefined> {
  let download = downloads.get(id)
  if (!download) {
    download = (async () => {
      const file = await remote.downloadBlob(id)
      if (!file) return undefined
      const blob: StoredBlob = { id, mimeType: file.mimeType, data: file.data, createdAt: Date.now() }
      await db.fromAccount([db.blobs], async () => {
        if (!(await db.blobs.get(id))) await db.blobs.add({ ...blob, synced: 1 })
      })
      return blob
    })().finally(() => downloads.delete(id))
    downloads.set(id, download)
  }
  return download
}

// --- Preferences -----------------------------------------------------------

let applyingSettings = false

async function markSettingsChanged(): Promise<void> {
  await db.meta.put({ key: SETTINGS_KEY, value: { updatedAt: now(), synced: false } satisfies SettingsMeta })
}

/** Notes when synced preferences change here, so the newer side wins. Returns the unsubscribe. */
export function watchSettings(onChange: () => void): () => void {
  return useSettings.subscribe((state, prev) => {
    if (applyingSettings || ACCOUNT_SETTINGS.every((key) => state[key] === prev[key])) return
    void markSettingsChanged().then(onChange)
  })
}

async function applySettings(record: PulledRecord): Promise<void> {
  const local = await getMeta<SettingsMeta>(SETTINGS_KEY)
  if (local && local.updatedAt >= record.updatedAt) return
  applyingSettings = true
  try {
    useSettings.setState(parseAccountSettings(record.data))
  } finally {
    applyingSettings = false
  }
  await db.meta.put({ key: SETTINGS_KEY, value: { updatedAt: record.updatedAt, synced: true } satisfies SettingsMeta })
}

async function pushSettings(remote: SyncRemote): Promise<void> {
  const meta = await getMeta<SettingsMeta>(SETTINGS_KEY)
  if (!meta || meta.synced) return
  const data = pickAccountSettings(useSettings.getState())
  await remote.push([{ kind: 'settings', id: SETTINGS_ID, data, updatedAt: meta.updatedAt }])
  await db.transaction('rw', db.meta, async () => {
    // Unless they changed again meanwhile.
    if ((await getMeta<SettingsMeta>(SETTINGS_KEY))?.updatedAt === meta.updatedAt) {
      await db.meta.put({ key: SETTINGS_KEY, value: { ...meta, synced: true } })
    }
  })
}
