import { MenuIcon, PanelLeftOpenIcon, SquarePenIcon } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/stores/settings'
import { useUI } from '@/stores/ui'

/** Header buttons that bring the sidebar back: the menu on phones, "Show sidebar" when hidden on wide screens. */
export function SidebarToggle() {
  const setSidebarOpen = useUI((s) => s.setSidebarOpen)
  const collapsed = useSettings((s) => s.sidebarCollapsed)
  const setCollapsed = useSettings((s) => s.setSidebarCollapsed)

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="text-muted-foreground md:hidden"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open sidebar"
      >
        <MenuIcon />
      </Button>
      {collapsed && (
        <div className="hidden items-center gap-0.5 md:flex">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={() => setCollapsed(false)}
            aria-label="Show sidebar"
            title="Show sidebar"
          >
            <PanelLeftOpenIcon />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground" asChild>
            <Link to="/" aria-label="New chat" title="New chat">
              <SquarePenIcon />
            </Link>
          </Button>
        </div>
      )}
    </>
  )
}
