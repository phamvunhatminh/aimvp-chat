import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { AppLayout } from '@/components/app-layout'
import { PwaUpdater } from '@/components/pwa-updater'
import { useApplyTheme } from '@/hooks/use-theme'
import { CALLBACK_PATH } from '@/lib/oauth'
import { ACCOUNT_CALLBACK_PATH } from '@/lib/supabase'
import { AccountCallback } from '@/routes/account-callback'
import { AuthCallback } from '@/routes/auth-callback'
import { ChatRoute } from '@/routes/chat-page'
import { useSettings } from '@/stores/settings'

// The dashboard is visited now and then; keep it out of the main bundle.
const UsagePage = lazy(() => import('@/routes/usage-page').then((m) => ({ default: m.UsagePage })))

export default function App() {
  useApplyTheme()
  const theme = useSettings((s) => s.theme)

  return (
    <>
      <Routes>
        <Route path={CALLBACK_PATH} element={<AuthCallback />} />
        <Route path={ACCOUNT_CALLBACK_PATH} element={<AccountCallback />} />
        <Route element={<AppLayout />}>
          <Route index element={<ChatRoute />} />
          <Route path="c/:id" element={<ChatRoute />} />
          <Route path="p/:projectId" element={<ChatRoute />} />
          <Route
            path="usage"
            element={
              <Suspense fallback={null}>
                <UsagePage />
              </Suspense>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster theme={theme} position="top-center" />
      <PwaUpdater />
    </>
  )
}
