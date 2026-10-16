import { LoaderCircleIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { completeOpenRouterAuth } from '@/lib/oauth'
import { useSettings } from '@/stores/settings'

/** OpenRouter redirects here with `?code=` after the user approves the key. */
export function AuthCallback() {
  const [params] = useSearchParams()
  const code = params.get('code')
  const setApiKey = useSettings((s) => s.setApiKey)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(code ? null : 'OpenRouter did not return an authorization code.')

  useEffect(() => {
    if (!code) return
    let active = true
    completeOpenRouterAuth(code).then(
      (key) => {
        if (!active) return
        setApiKey('openrouter', key)
        toast.success('OpenRouter connected')
        navigate('/', { replace: true })
      },
      (err: Error) => active && setError(err.message),
    )
    return () => {
      active = false
    }
  }, [code, navigate, setApiKey])

  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      {error ? (
        <>
          <h1 className="text-xl font-semibold">Could not connect OpenRouter</h1>
          <p className="max-w-sm text-muted-foreground">{error}</p>
          <Button asChild>
            <Link to="/" replace>
              Back to aimvp
            </Link>
          </Button>
        </>
      ) : (
        <>
          <LoaderCircleIcon className="size-6 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Connecting to OpenRouter…</p>
        </>
      )}
    </div>
  )
}
