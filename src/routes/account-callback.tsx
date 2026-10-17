import { LoaderCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { completeSignIn } from '@/lib/account'

/** Supabase sends users here from Google, GitHub and email links, with `?code=` or an error. */
export function AccountCallback() {
  const [params] = useSearchParams()
  const code = params.get('code')
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(
    code ? null : (params.get('error_description') ?? 'The sign-in link is missing its code.'),
  )

  useEffect(() => {
    if (!code) return
    let active = true
    completeSignIn(code).then(
      () => {
        if (!active) return
        toast.success('Signed in. Your chats will sync across devices.')
        navigate('/', { replace: true })
      },
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [code, navigate])

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <>
          <h1 className="text-xl font-semibold">Couldn't sign in</h1>
          <p className="max-w-sm text-muted-foreground">{error}</p>
          <Button asChild>
            <Link to="/" replace>
              Back to chat
            </Link>
          </Button>
        </>
      ) : (
        <>
          <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Signing in…</p>
        </>
      )}
    </div>
  )
}
