import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

/** A one-field dialog for naming things: new project, rename chat or project. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  initialValue = '',
  placeholder,
  submitLabel = 'Save',
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  submitLabel?: string
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  const [prevOpen, setPrevOpen] = useState(open)
  // Start from the current name each time the dialog opens.
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setValue(initialValue)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!value.trim()) return
            onSubmit(value.trim())
            onOpenChange(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            autoFocus
            aria-label={label}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
