import { Navigate, Route, Routes } from 'react-router'
import { Toaster } from 'sonner'
import { AppLayout } from '@/components/app-layout'
import { PwaUpdater } from '@/components/pwa-updater'
import { useApplyTheme } from '@/hooks/use-theme'
import { CALLBACK_PATH } from '@/lib/oauth'
import { AuthCallback } from '@/routes/auth-callback'
import { ChatRoute } from '@/routes/chat-page'
import { useSettings } from '@/stores/settings'

export default function App() {
  useApplyTheme()
  const theme = useSettings((s) => s.theme)

  return (
    <>
      <Routes>
        <Route path={CALLBACK_PATH} element={<AuthCallback />} />
        <Route element={<AppLayout />}>
          <Route index element={<ChatRoute />} />
          <Route path="c/:id" element={<ChatRoute />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster theme={theme} position="top-center" />
      <PwaUpdater />
    </>
  )
}
