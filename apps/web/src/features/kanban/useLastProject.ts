import { useEffect } from 'react'

// localStorage-ключ, хранящий uuid последнего выбранного проекта kanban/timeline.
// Сохраняем при каждом изменении и используем как fallback при первом заходе,
// если URL не содержит ?project=.
const LS_KEY = 'jira-ui:last-project'

export function readLastProject(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(LS_KEY) : null
  } catch {
    return null
  }
}

export function writeLastProject(id: string | null): void {
  try {
    if (typeof window === 'undefined') return
    if (id) window.localStorage.setItem(LS_KEY, id)
    else window.localStorage.removeItem(LS_KEY)
  } catch {
    // localStorage может быть недоступен (приватный режим, quota) — игнорируем.
  }
}

// Side-effect хук: каждое изменение projectId синхронизирует localStorage.
// Считыватель — readLastProject — статичный, чтобы можно было использовать
// внутри инициализаторов state без useEffect.
export function useLastProject(projectId: string | null): void {
  useEffect(() => {
    writeLastProject(projectId)
  }, [projectId])
}
