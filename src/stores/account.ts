import { create } from 'zustand'
import { accountsEnabled } from '@/lib/supabase'

export interface AccountUser {
  id: string
  email: string
  name: string
  avatarUrl: string | null
}

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error'

interface AccountState {
  /** `disabled` when this build has no Supabase project. */
  status: 'disabled' | 'loading' | 'signed-out' | 'signed-in'
  user: AccountUser | null
  sync: SyncState
  syncError: string | null
  lastSyncedAt: number | null
  /** Opened from a password reset email: the user is choosing a new password. */
  recovering: boolean
}

export const useAccount = create<AccountState>()(() => ({
  status: accountsEnabled ? 'loading' : 'disabled',
  user: null,
  sync: 'idle',
  syncError: null,
  lastSyncedAt: null,
  recovering: false,
}))
