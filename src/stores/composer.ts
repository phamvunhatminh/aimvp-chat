import { toast } from 'sonner'
import { create } from 'zustand'
import { FileError, prepareFile, type PreparedFile } from '@/lib/files'
import { newId } from '@/lib/utils'

export interface PendingFile {
  id: string
  name: string
  status: 'processing' | 'ready'
  prepared?: PreparedFile
  /** Object URL of an image's thumbnail. */
  previewUrl?: string
}

interface ComposerState {
  files: PendingFile[]
}

/** Files attached in the composer but not sent yet. */
export const useComposer = create<ComposerState>()(() => ({ files: [] }))

function patch(id: string, update: Partial<PendingFile>) {
  useComposer.setState((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, ...update } : f)) }))
}

export function removeFile(id: string) {
  useComposer.setState((s) => {
    const file = s.files.find((f) => f.id === id)
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl)
    return { files: s.files.filter((f) => f.id !== id) }
  })
}

export async function addFiles(files: Iterable<File>) {
  await Promise.all(
    Array.from(files).map(async (file) => {
      const id = newId()
      useComposer.setState((s) => ({ files: [...s.files, { id, name: file.name, status: 'processing' }] }))
      try {
        const prepared = await prepareFile(file)
        // The file may have been removed while it was processing.
        if (!useComposer.getState().files.some((f) => f.id === id)) return
        const previewUrl =
          prepared.attachment.kind === 'image' && prepared.data
            ? URL.createObjectURL(new Blob([prepared.data], { type: prepared.attachment.mimeType }))
            : undefined
        patch(id, { status: 'ready', prepared, previewUrl })
      } catch (err) {
        removeFile(id)
        toast.error(err instanceof FileError ? err.message : `${file.name} couldn't be attached.`)
      }
    }),
  )
}

/** Empties the composer and returns the files that were ready to send. */
export function takeFiles(): PreparedFile[] {
  const { files } = useComposer.getState()
  for (const f of files) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
  useComposer.setState({ files: [] })
  return files.flatMap((f) => (f.prepared ? [f.prepared] : []))
}
