// Публичные экспорты фичи kanban. Кросс-фичевый импорт допустим только
// из этого файла (см. .agents/PATTERNS.md).

export type {
  KanbanError,
  KanbanQuery,
  ProjectKanbanColumn,
  ProjectKanbanResponse,
} from './api'
export { KanbanPage } from './components/KanbanPage'
export {
  classifyIssueType,
  type HierarchyLevel,
  hierarchyOrder,
} from './hierarchy'
export { kanbanKeys, useProjectKanban } from './hooks'
export { useKanbanUi } from './store'
export type { Density, IssueSummary, StatusCategory, SyncState } from './types'
