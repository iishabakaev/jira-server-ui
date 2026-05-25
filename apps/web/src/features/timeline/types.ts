// Зеркало серверного TimelineBar — Eden Treaty уже отдаёт точно такой же
// shape, но локальный alias делает импорты по фиче чище и не тянет в
// компоненты `@server/...` напрямую.
export type SyncState = 'synced' | 'pending' | 'pushing' | 'error' | 'conflict'
export type StatusCategory = 'new' | 'indeterminate' | 'done'

export type TimelineBar = {
  id: string
  key: string
  summary: string
  issueTypeId: string
  issueTypeName: string
  issueTypeIconUrl: string | null
  statusId: string
  statusName: string
  statusCategory: StatusCategory
  assigneeId: string | null
  assigneeDisplayName: string | null
  epicJiraId: string | null
  sprintId: string | null
  sprintName: string | null
  startDate: string | null
  dueDate: string | null
  storyPoints: number | null
  syncState: SyncState
}

export type TimelineGroupBy = 'epic' | 'assignee' | 'sprint' | 'none'

export type Zoom = 'week' | '2w' | 'month' | 'quarter'

// Готовая к рендеру строка — либо заголовок группы, либо bar.
// Виртуализатору важен только высоты-стабильный список таких узлов.
export type RowEntry =
  | { kind: 'group'; id: string; label: string; count: number }
  | { kind: 'bar'; id: string; bar: TimelineBar; groupId: string }
