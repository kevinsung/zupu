// Light/dark override; 'auto' follows the system. index.html applies the saved value before first paint.
const THEME_KEY = 'ft-theme'

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
}
