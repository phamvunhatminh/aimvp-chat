import { Outlet } from 'react-router'
import { SettingsDialog } from '@/components/settings-dialog'
import { Sidebar } from '@/components/sidebar'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { useUI } from '@/stores/ui'

export function AppLayout() {
  const sidebarOpen = useUI((s) => s.sidebarOpen)
  const setSidebarOpen = useUI((s) => s.setSidebarOpen)

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:block">
        <Sidebar />
      </aside>
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent aria-describedby={undefined} className="md:hidden">
          <SheetTitle className="sr-only">Chats</SheetTitle>
          <Sidebar onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>
      <main className="flex min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">
        <Outlet />
      </main>
      <SettingsDialog />
    </div>
  )
}
