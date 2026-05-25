import { useSyncExternalStore } from 'react'

// Локальный реестр сохранённых kanban-views. Хранится в localStorage —
// бэкенда saved_views (см. packages/db/src/schema/saved_views.ts) UI не
// касается, пока сервер не отдал соответствующий endpoint. Когда дойдут
// руки до серверной реализации, поверх этого модуля надстроится TanStack
// Query слой и публичный API не сломается.

const STORAGE_KEY = 'kanban-saved-views/v1'

export interface SavedView {
  id: string
  name: string
  projectId: string | null
  // Сериализованные search-параметры url'а. Применяя view, мы целиком
  // перезаписываем эти ключи (project/group/density/text/hideDone/layout/filters).
  search: Record<string, string | boolean | undefined>
  createdAt: number
}

type Listener = () => void
const listeners = new Set<Listener>()
let cache: SavedView[] | null = null

function readStorage(): SavedView[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (v): v is SavedView =>
        v &&
        typeof v === 'object' &&
        typeof v.id === 'string' &&
        typeof v.name === 'string' &&
        typeof v.createdAt === 'number',
    )
  } catch {
    return []
  }
}

function writeStorage(views: SavedView[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views))
  } catch {
    // quota / приватный режим — игнорируем, кеш в памяти продолжит работать
  }
  cache = views
  for (const l of listeners) l()
}

function ensureCache(): SavedView[] {
  if (cache === null) cache = readStorage()
  return cache
}

export const savedViewsStore = {
  subscribe(l: Listener) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  getSnapshot(): SavedView[] {
    return ensureCache()
  },
  save(view: Omit<SavedView, 'id' | 'createdAt'>): SavedView {
    const created: SavedView = {
      ...view,
      id: `view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    }
    const next = [created, ...ensureCache()]
    writeStorage(next)
    return created
  },
  remove(id: string) {
    writeStorage(ensureCache().filter((v) => v.id !== id))
  },
  rename(id: string, name: string) {
    writeStorage(ensureCache().map((v) => (v.id === id ? { ...v, name } : v)))
  },
}

export function useSavedViews(): SavedView[] {
  return useSyncExternalStore(savedViewsStore.subscribe, savedViewsStore.getSnapshot, () => [])
}
