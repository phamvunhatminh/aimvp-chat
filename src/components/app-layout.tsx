import { Outlet } from 'react-router'
import { PromptLibraryDialog } from '@/components/prompt-library-dialog'
import { SettingsDialog } from '@/components/settings-dialog'
import { Sidebar } from '@/components/sidebar'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useUI } from '@/stores/ui'

export function AppLayout() {
  const sidebarOpen = useUI((s) => s.sidebarOpen)
  const setSidebarOpen = useUI((s) => s.setSidebarOpen)

  return (
    <div className="flex h-dvh overflow-hidden print:block print:h-auto print:overflow-visible">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:block print:hidden">
        <Sidebar />
      </aside>
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent aria-describedby={undefined} className="md:hidden">
          <SheetTitle className="sr-only">Chats</SheetTitle>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)] print:block">
        <Outlet />
      </main>
      <SettingsDialog />
      <PromptLibraryDialog />
    </div>
  )
}
