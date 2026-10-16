import { useLiveQuery } from 'dexie-react-hooks'
import { getConversation, getMessages, listConversations } from '@/lib/repo'

export function useConversations() {
  return useLiveQuery(listConversations, [])
}

/** `undefined` while loading, `null` when the conversation does not exist. */
export function useConversation(id: string | undefined) {
  return useLiveQuery(async () => (id ? ((await getConversation(id)) ?? null) : null), [id])
}

export function useMessages(conversationId: string | undefined) {
  return useLiveQuery(async () => (conversationId ? getMessages(conversationId) : []), [conversationId])
}
