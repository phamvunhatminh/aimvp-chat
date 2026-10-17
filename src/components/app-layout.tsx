import { Outlet } from 'react-router'
import { NewPasswordDialog } from '@/components/account/new-password-dialog'
import { SignInDialog } from '@/components/account/sign-in-dialog'
import { PromptLibraryDialog } from '@/components/prompt-library-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { Sidebar } from '@/components/sidebar'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useUsableDefaultModel } from '@/hooks/use-fallback-model'
import { cn } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { useUI } from '@/stores/ui'

export function AppLayout() {
  const sidebarOpen = useUI((s) => s.sidebarOpen)
  const setSidebarOpen = useUI((s) => s.setSidebarOpen)
  const collapsed = useSettings((s) => s.sidebarCollapsed)
  useUsableDefaultModel()

  return (
    <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <aside
        className={cn(
          // Visibility flips after the width animation, so hidden links leave the tab order and the a11y tree.
          'hidden shrink-0 overflow-hidden bg-sidebar transition-[width,visibility] duration-200 ease-out md:block print:hidden',
          collapsed ? 'invisible w-0' : 'w-64 border-r',
        )}
      >
        <div className="h-full w-64">
          <Sidebar />
        </div>
      </aside>
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        {/* No autofocus: on phones it would pop up the keyboard for the search box. */}
        <SheetContent
          aria-describedby={undefined}
          className="md:hidden"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <SheetTitle className="sr-only">Chats</SheetTitle>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)] print:block">
        <Outlet />
      </main>
      <SettingsDialog />
      <PromptLibraryDialog />
      <SignInDialog />
      <NewPasswordDialog />
    </div>
  )
}
