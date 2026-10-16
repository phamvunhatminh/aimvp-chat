// Runs before first paint so the page never flashes the wrong theme.
;(function () {
  try {
    var raw = localStorage.getItem('aimvp.settings')
    var theme = (raw && JSON.parse(raw).state.theme) || 'system'
    var dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.classList.toggle('dark', dark)
  } catch {
    // Storage blocked or corrupt: fall back to the light theme.
  }
})()
