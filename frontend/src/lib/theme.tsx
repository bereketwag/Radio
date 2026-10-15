import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

type ThemeChoice = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: ThemeChoice
  resolved: 'light' | 'dark'
  setTheme: (t: ThemeChoice) => void
  cycleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'aurora.theme'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function readStored(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeChoice>(readStored)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    const meta = document.querySelector('meta[name="theme-color"]:not([media])')
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#101210' : '#FAF9F5')
  }, [resolved])

  const setTheme = useCallback((t: ThemeChoice) => {
    setThemeState(t)
    try {
      if (t === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
  }, [])

  const cycleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')
  }, [theme, setTheme])

  const value = useMemo(() => ({ theme, resolved, setTheme, cycleTheme }), [theme, resolved, setTheme, cycleTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
