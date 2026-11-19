// Light/dark override; 'auto' follows the system. index.html applies the saved value before first paint.
import { systemDark } from './dom'

const THEME_KEY = 'ft-theme'
/** --bg in styles.css; index.html has the same values. */
const BAR_COLORS = { light: '#f6f3ec', dark: '#1a1815' }

export type Theme = 'auto' | 'light' | 'dark'

export function getTheme(): Theme {
  const v = localStorage.getItem(THEME_KEY)
  return v === 'light' || v === 'dark' ? v : 'auto'
}

export function setTheme(theme: Theme) {
  if (theme === 'auto') {
    localStorage.removeItem(THEME_KEY)
    delete document.documentElement.dataset.theme
  } else {
    localStorage.setItem(THEME_KEY, theme)
    document.documentElement.dataset.theme = theme
  }
  updateBarColor()
}

/**
 * The phone's status bar color (<meta name="theme-color">, used by Chrome) follows the app's theme,
 * including one picked in Settings, not just the system's. (Firefox's installed apps ignore the tag
 * and use their own theme, which is why the manifest has no theme_color.)
 */
function updateBarColor() {
  const theme = getTheme()
  const dark = theme === 'dark' || (theme === 'auto' && systemDark.matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLORS[dark ? 'dark' : 'light'])
}
systemDark.addEventListener('change', updateBarColor)
