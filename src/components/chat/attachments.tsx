import { DownloadIcon, FileSpreadsheetIcon, FileTextIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useBlobUrl } from '@/hooks/use-blob-url'
import type { Attachment } from '@/lib/db'
import { downloadUrl } from '@/lib/download'
import { formatBytes } from '@/lib/files'
import { cn } from '@/lib/utils'
import { removeFile, type PendingFile } from '@/stores/composer'

function FileIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  const Icon = mimeType.includes('spreadsheet') || mimeType === 'text/csv' ? FileSpreadsheetIcon : FileTextIcon
  return <Icon className={cn('size-4 shrink-0', className)} />
}

function FileChip({ name, detail, mimeType, children }: { name: string; detail: string; mimeType: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-14 max-w-56 min-w-0 items-center gap-2 rounded-xl border bg-background px-3 text-left">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <FileIcon mimeType={mimeType} />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate text-xs text-muted-foreground">{detail}</div>
      </div>
      {children}
    </div>
  )
}

function fileDetail(a: Pick<Attachment, 'mimeType' | 'size' | 'text'>) {
  const type = a.mimeType === 'application/pdf' ? 'PDF' : a.mimeType.includes('word') ? 'Word' : a.mimeType.includes('sheet') ? 'Excel' : 'Text'
  return `${type} · ${formatBytes(a.size)}`
}

/** Files waiting in the composer. */
export function PendingAttachments({ files }: { files: PendingFile[] }) {
  if (files.length === 0) return null
  return (
    <div className="flex gap-2 overflow-x-auto px-1 pt-1 pb-2" aria-label="Attachments">
      {files.map((f) => {
        const remove = (
          <button
            type="button"
            onClick={() => removeFile(f.id)}
            aria-label={`Remove ${f.name}`}
            className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        )
        if (f.status === 'processing') {
          return (
            <div key={f.id} className="relative shrink-0">
              <FileChip name={f.name} detail="Reading…" mimeType="text/plain">
                <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
              </FileChip>
              {remove}
            </div>
          )
        }
        const a = f.prepared!.attachment
        return (
          <div key={f.id} className="relative shrink-0">
            {a.kind === 'image' && f.previewUrl ? (
              <img src={f.previewUrl} alt={a.name} className="size-14 rounded-xl border object-cover" />
            ) : (
              <FileChip name={a.name} detail={fileDetail(a)} mimeType={a.mimeType} />
            )}
            {remove}
          </div>
        )
      })}
    </div>
  )
}

/** Images and files on a sent message. */
export function MessageAttachments({ attachments, align = 'start' }: { attachments: Attachment[]; align?: 'start' | 'end' }) {
  if (attachments.length === 0) return null
  const images = attachments.filter((a) => a.kind === 'image')
  const files = attachments.filter((a) => a.kind === 'file')
  return (
    <div className={cn('flex max-w-[85%] flex-col gap-2', align === 'end' ? 'items-end self-end' : 'items-start')}>
      {images.length > 0 && (
        <div className={cn('flex flex-wrap gap-2', align === 'end' && 'justify-end')}>
          {images.map((a) => (
            <ImageThumb key={a.id} attachment={a} large={images.length === 1} />
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className={cn('flex flex-wrap gap-2', align === 'end' && 'justify-end')}>
          {files.map((a) => (
            <FileChip key={a.id} name={a.name} detail={fileDetail(a)} mimeType={a.mimeType} />
          ))}
        </div>
      )}
    </div>
  )
}

function ImageThumb({ attachment, large }: { attachment: Attachment; large: boolean }) {
  const url = useBlobUrl(attachment.blobId)
  const [open, setOpen] = useState(false)
  if (!url) {
    return <div className={cn('rounded-xl border bg-muted', large ? 'h-48 w-64' : 'size-24')} aria-label={attachment.name} />
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="overflow-hidden rounded-xl border" aria-label={`Open ${attachment.name}`}>
        <img
          src={url}
          alt={attachment.name}
          className={cn('object-cover', large ? 'max-h-72 max-w-full sm:max-w-sm' : 'size-24')}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[min(64rem,calc(100%-2rem))] gap-3 p-3 sm:p-4" aria-describedby={undefined}>
          <DialogTitle className="truncate pr-8 text-sm font-medium">{attachment.name}</DialogTitle>
          <img src={url} alt={attachment.name} className="max-h-[75dvh] w-full rounded-lg object-contain" />
          <Button variant="outline" className="justify-self-end" onClick={() => downloadUrl(url, attachment.name)}>
            <DownloadIcon />
            Download
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
