import { create } from 'zustand'

// UI-only состояние модалки quick-create. Открыта/закрыта, и какой
// projectId был активен в момент открытия (его передаст KanbanPage из
// выбранной доски). Серверное состояние — TanStack Query, тут только UI.

type QuickCreateUiState = {
  open: boolean
  projectId: string | null
  openDialog(projectId: string | null): void
  closeDialog(): void
}

export const useQuickCreateUi = create<QuickCreateUiState>((set) => ({
  open: false,
  projectId: null,
  openDialog(projectId) {
    set({ open: true, projectId })
  },
  closeDialog() {
    set({ open: false })
  },
}))
