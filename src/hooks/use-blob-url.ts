import { useEffect, useState } from 'react'
import { getBlob } from '@/lib/repo'

/** An object URL for a stored blob, revoked when the component unmounts. */
export function useBlobUrl(blobId: string | null): string | null {
  const [url, setUrl] = useState<{ id: string; url: string } | null>(null)

  useEffect(() => {
    if (!blobId) return
    let objectUrl: string | null = null
    let active = true
    void getBlob(blobId).then((blob) => {
      if (!active || !blob) return
      objectUrl = URL.createObjectURL(new Blob([blob.data], { type: blob.mimeType }))
      setUrl({ id: blobId, url: objectUrl })
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [blobId])

  return url && url.id === blobId ? url.url : null
}
