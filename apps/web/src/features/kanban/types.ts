// Локальные типы фронтенда для kanban. Дублирование с серверной TypeBox-схемой
// сознательное и узкое: оно даёт контролируемую IDE-подсказку без зависимости
// от полного вывода Eden Treaty внутри компонентов. Eden остаётся источником
// правды на границе (`api.ts` → unwrap).

export type SyncState = 'synced' | 'pending' | 'pushing' | 'error' | 'conflict'

export type StatusCategory = 'new' | 'indeterminate' | 'done'

export type IssueSummary = {
  id: string
  key: string
  jiraId: string
  projectId: string
  summary: string
  issueTypeId: string
  issueTypeName: string
  issueTypeIconUrl: string | null
  isSubtask: boolean
  statusId: string
  statusName: string
  statusCategory: StatusCategory
  priorityId: string | null
  priorityName: string | null
  priorityIconUrl: string | null
  assigneeId: string | null
  assigneeDisplayName: string | null
  reporterId: string | null
  parentJiraId: string | null
  epicJiraId: string | null
  sprintId: string | null
  sprintName: string | null
  labels: string[]
  components: string[]
  fixVersions: string[]
  dueDate: string | null
  startDate: string | null
  storyPoints: number | null
  orderingRank: string | null
  jiraUpdatedAt: string
  syncState: SyncState
}

export type Density = 'compact' | 'comfortable' | 'spacious'
