import { LoaderCircleIcon } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { GitHubIcon, GoogleIcon } from '@/components/account/brand-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sendPasswordReset, signInWithPassword, signInWithProvider, signUp, type OAuthProvider } from '@/lib/account'
import type { SignInMode } from './sign-in-mode'

const SUBMIT_LABELS: Record<SignInMode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create account',
  reset: 'Send reset link',
}

const PROVIDERS: { id: OAuthProvider; label: string; icon: typeof GoogleIcon }[] = [
  { id: 'google', label: 'Continue with Google', icon: GoogleIcon },
  { id: 'github', label: 'Continue with GitHub', icon: GitHubIcon },
]

const linkClass = 'font-medium text-foreground underline-offset-4 hover:underline'

/** Google, GitHub, or email and password; the parent shows the title for `mode`. */
export function SignInForm({ mode, onModeChange }: { mode: SignInMode; onModeChange: (mode: SignInMode) => void }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<OAuthProvider | 'email' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function switchTo(next: SignInMode) {
    setError(null)
    setNotice(null)
    onModeChange(next)
  }

  async function continueWith(provider: OAuthProvider) {
    setBusy(provider)
    setError(null)
    setNotice(null)
    try {
      // On success the page leaves for the provider, so the spinner stays.
      await signInWithProvider(provider)
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy('email')
    setError(null)
    setNotice(null)
    try {
      if (mode === 'reset') {
        await sendPasswordReset(email)
        setNotice(`If an account uses ${email}, a link to reset its password is on its way.`)
      } else if (mode === 'sign-in') {
        await signInWithPassword(email, password)
      } else if (!(await signUp(email, password))) {
        setNotice(`Check your inbox: open the link we sent to ${email} to finish creating your account.`)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="grid gap-4">
      {mode !== 'reset' && (
        <>
          <div className="grid gap-2">
            {PROVIDERS.map(({ id: provider, label, icon: Icon }) => (
              <Button
                key={provider}
                variant="outline"
                disabled={busy !== null}
                onClick={() => void continueWith(provider)}
              >
                {busy === provider ? <LoaderCircleIcon className="animate-spin" /> : <Icon />}
                {label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form className="grid gap-3" onSubmit={(e) => void submit(e)}>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-email`}>Email</Label>
          <Input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {mode !== 'reset' && (
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={`${id}-password`}>Password</Label>
              {mode === 'sign-in' && (
                <button
                  type="button"
                  onClick={() => switchTo('reset')}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Forgot password?
                </button>
              )}
            </div>
            <Input
              id={`${id}-password`}
              type="password"
              autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
              minLength={mode === 'sign-up' ? 8 : undefined}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'sign-up' && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
            {notice}
          </p>
        )}
        <Button type="submit" disabled={busy !== null}>
          {busy === 'email' && <LoaderCircleIcon className="animate-spin" />}
          {SUBMIT_LABELS[mode]}
        </Button>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        {mode === 'sign-in' ? (
          <>
            New here?{' '}
            <button type="button" className={linkClass} onClick={() => switchTo('sign-up')}>
              Create an account
            </button>
          </>
        ) : (
          <>
            {mode === 'sign-up' ? 'Already have an account? ' : 'Remembered it? '}
            <button type="button" className={linkClass} onClick={() => switchTo('sign-in')}>
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  )
}
