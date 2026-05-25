import { create } from 'zustand'

// UI-only состояние kanban. Серверное состояние — в TanStack Query.
// Сохраняем здесь только то, что не должно ехать в URL (выделение,
// hover, transient drag preview). Selection пригодится в M5+.
type KanbanUiState = {
  selected: Set<string>
  hoveredCardId: string | null
  toggle(id: string, mode: 'single' | 'add' | 'range'): void
  clear(): void
  setHover(id: string | null): void
}

export const useKanbanUi = create<KanbanUiState>((set) => ({
  selected: new Set<string>(),
  hoveredCardId: null,
  toggle(id, mode) {
    set((s) => {
      if (mode === 'single') return { selected: new Set([id]) }
      const next = new Set(s.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selected: next }
    })
  },
  clear() {
    set({ selected: new Set<string>() })
  },
  setHover(id) {
    set({ hoveredCardId: id })
  },
}))
