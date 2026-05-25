import type { IssueSummary } from '../kanban/types'

// Локальные типы quick-create. Серверные TypeBox-схемы остаются источником
// правды (см. apps/server/src/modules/issues/schema.ts: QuickCreateBody),
// тут — только то, что нужно компонентам без полного вывода Eden Treaty.

export type AvailableIssueType = {
  id: string
  name: string
  iconUrl: string | null
}

export type QuickCreateInput = {
  projectId: string
  issueTypeId: string
  summary: string
  parentKey?: string
  epicKey?: string
  assigneeId?: string
  priorityId?: string
  labels?: string[]
}

export type { IssueSummary }
