import { create } from 'zustand'

// UI-only состояние wizard'а. Серверное состояние плана живёт в TanStack
// Query (см. hooks.ts). Здесь храним только «какой issueKey открыт сейчас»
// и какой planId привязан к текущей сессии wizard'а.

type WizardState = {
  // Issue, для которого открыт wizard; null = закрыт.
  issueKey: string | null
  // Целевой статус, выбранный пользователем при открытии (нужен для plan).
  targetStatusId: string | null
  targetStatusName: string | null
  // ID активного плана. Заполняется после plan() либо при подхвате
  // существующего active-плана.
  planId: string | null
  open(args: { issueKey: string; targetStatusId: string; targetStatusName: string }): void
  attachPlan(planId: string): void
  close(): void
}

export const useWorkflowWizard = create<WizardState>((set) => ({
  issueKey: null,
  targetStatusId: null,
  targetStatusName: null,
  planId: null,
  open({ issueKey, targetStatusId, targetStatusName }) {
    set({ issueKey, targetStatusId, targetStatusName, planId: null })
  },
  attachPlan(planId) {
    set({ planId })
  },
  close() {
    set({ issueKey: null, targetStatusId: null, targetStatusName: null, planId: null })
  },
}))
