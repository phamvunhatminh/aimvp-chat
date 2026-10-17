import { useState } from 'react'
import { SignInForm } from '@/components/account/sign-in-form'
import { SIGN_IN_PITCH, SIGN_IN_TITLES, type SignInMode } from '@/components/account/sign-in-mode'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAccount } from '@/stores/account'
import { useUI } from '@/stores/ui'

/** Opened from the sidebar; signing in closes it. */
export function SignInDialog() {
  const requested = useUI((s) => s.signInOpen)
  const setOpen = useUI((s) => s.setSignInOpen)
  const signedIn = useAccount((s) => s.status === 'signed-in')
  const [mode, setMode] = useState<SignInMode>('sign-in')
  const open = requested && !signedIn
  const [prevOpen, setPrevOpen] = useState(open)
  // Start on "Sign in" each time it opens.
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setMode('sign-in')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{SIGN_IN_TITLES[mode]}</DialogTitle>
          <DialogDescription>
            {mode === 'reset' ? "We'll email you a link to choose a new password." : SIGN_IN_PITCH}
          </DialogDescription>
        </DialogHeader>
        <SignInForm mode={mode} onModeChange={setMode} />
      </DialogContent>
    </Dialog>
  )
}
