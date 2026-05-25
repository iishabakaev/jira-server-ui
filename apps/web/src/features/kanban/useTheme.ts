import { useEffect, useState } from 'react'

// Хук тогглинга тёмной/светлой темы. Состояние пишется в data-theme на
// document.documentElement и кешируется в localStorage. Дефолт — dark.

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'alfaiaas:theme'

function readInitial(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return 'dark'
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readInitial)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return [theme, toggle]
}
