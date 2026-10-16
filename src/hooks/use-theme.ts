import { useEffect } from 'react'
import { useSettings } from '@/stores/settings'

/** Keeps the `dark` class on <html> in sync with the setting and the OS preference. */
export function useApplyTheme() {
  const theme = useSettings((s) => s.theme)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}
