import { useLiveQuery } from 'dexie-react-hooks'
import { getConversation, getMessages, getProject, listConversations, listProjects } from '@/lib/repo'

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

export function useProjects() {
  return useLiveQuery(listProjects, [])
}

/** `undefined` while loading, `null` when the project does not exist. */
export function useProject(id: string | null | undefined) {
  return useLiveQuery(async () => (id ? ((await getProject(id)) ?? null) : null), [id])
}
