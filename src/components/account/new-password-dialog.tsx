import { LoaderCircleIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setNewPassword } from '@/lib/account'
import { useAccount } from '@/stores/account'

/** After a password reset link: the user is signed in and picks a new password. */
export function NewPasswordDialog() {
  const open = useAccount((s) => s.recovering && s.status === 'signed-in')
  const id = useId()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await setNewPassword(password)
      setPassword('')
      toast.success('Password changed')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && useAccount.setState({ recovering: false })}>
      <DialogContent className="max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <DialogHeader>
            <DialogTitle>Choose a new password</DialogTitle>
            <DialogDescription>You're signed in. Set the password to use from now on.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={id}>New password</Label>
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <LoaderCircleIcon className="animate-spin" />}
            Save password
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
