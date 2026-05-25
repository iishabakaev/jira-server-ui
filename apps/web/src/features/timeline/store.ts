import { create } from 'zustand'

// UI-only состояние timeline. URL-state живёт в TanStack Router (project,
// from, zoom, group); тут — только transient: что сейчас тащим, какие
// бары выделены, и текущий drag preview.

export type DragMode = 'move' | 'resize-start' | 'resize-end'

export type DragPreview = {
  barId: string
  mode: DragMode
  // Дельта в пикселях от исходной позиции, ещё не отснапленная.
  dxPx: number
}

type TimelineUiState = {
  hoveredBarId: string | null
  selected: Set<string>
  drag: DragPreview | null
  setHover(id: string | null): void
  toggleSelect(id: string, mode: 'single' | 'add'): void
  clearSelection(): void
  startDrag(preview: DragPreview): void
  updateDrag(dxPx: number): void
  endDrag(): void
}

export const useTimelineUi = create<TimelineUiState>((set) => ({
  hoveredBarId: null,
  selected: new Set<string>(),
  drag: null,
  setHover(id) {
    set({ hoveredBarId: id })
  },
  toggleSelect(id, mode) {
    set((s) => {
      if (mode === 'single') return { selected: new Set([id]) }
      const next = new Set(s.selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selected: next }
    })
  },
  clearSelection() {
    set({ selected: new Set<string>() })
  },
  startDrag(preview) {
    set({ drag: preview })
  },
  updateDrag(dxPx) {
    set((s) => (s.drag ? { drag: { ...s.drag, dxPx } } : s))
  },
  endDrag() {
    set({ drag: null })
  },
}))
