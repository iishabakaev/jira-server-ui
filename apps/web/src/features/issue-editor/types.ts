import type { IssueSummary, StatusCategory, SyncState } from '../kanban/types'

// Локальные типы редактора. Так же как в kanban — ограниченное дублирование
// серверной TypeBox-схемы, чтобы IDE подсказывала без полного вывода Eden Treaty
// внутри компонентов. Eden остаётся источником правды только в `api.ts`.

export type { IssueSummary, StatusCategory, SyncState }

export type SubtaskSummary = {
  id: string
  key: string
  summary: string
  statusName: string
  statusCategory: StatusCategory
  // orderingRank приходит с сервера, чтобы кеш-инвариант "subtasks
  // отсортированы по rank'у" был воспроизводим на клиенте после SSE-патчей
  // (когда incremental-sync обновит конкретный сабтаск, мерж в кеше сможет
  // оставить порядок согласованным). На текущей итерации DnD-логика использует
  // только id соседей, но поле сознательно несём в типе — оно дешёвое.
  orderingRank: string | null
}

export type IssueLinkPeer = {
  id: string
  key: string
  summary: string
  statusName: string
  statusCategory: StatusCategory
}

export type IssueLinkRef = {
  id: string
  linkTypeName: string
  direction: 'inward' | 'outward'
  label: string
  issue: IssueLinkPeer
}

export type IssueComment = {
  id: string
  jiraId: string | null
  authorId: string
  body: unknown
  createdAt: string
  updatedAt: string
  syncState: SyncState
}

export type IssueWorklog = {
  id: string
  jiraId: string | null
  authorId: string
  seconds: number
  startedAt: string
  comment: string | null
  syncState: SyncState
}

// FieldDef — клиентское зеркало серверной FieldDef из field_schemas.
// Опциональные surface/order/hidden управляют тем, где UI выводит поле.
export type FieldDefSchema = {
  type: string
  items?: string
  custom?: string
  customId?: number
  system?: string
}

export type FieldDef = {
  key: string
  name: string
  schema: FieldDefSchema
  required: boolean
  hasDefaultValue?: boolean
  allowedValues?: Array<{ id: string; value?: string; name?: string }>
  operations?: string[]
  surface?: Array<'editor' | 'create' | 'transition'>
  order?: number
  hidden?: boolean
}

export type IssueFieldSchema = {
  fields: FieldDef[]
}

export type DeploymentState = 'not-deployed' | 'deploying' | 'deployed'

export type DeploymentInfo = {
  state: DeploymentState
  // Имя статуса источника (для tooltip'а).
  statusName: string
  // Ключ Platform Devops Task'а, по которому посчитан state. Может совпадать
  // с key самой задачи, если та сама Platform Devops Task.
  devopsTaskKey: string
}

export type EpicChildTask = {
  id: string
  key: string
  summary: string
  issueTypeName: string
  statusName: string
  statusCategory: StatusCategory
  assigneeDisplayName: string | null
  deployment: DeploymentInfo | null
  orderingRank: string | null
  subtasks: SubtaskSummary[]
}

export type IssueDetail = {
  summary: IssueSummary
  description: unknown
  descriptionText: string | null
  customFields: Record<string, unknown>
  // null означает, что refresh-metadata ещё не закеширован — UI рендерит
  // только базовый набор полей.
  fieldSchema: IssueFieldSchema | null
  subtasks: SubtaskSummary[]
  links: IssueLinkRef[]
  comments: IssueComment[]
  worklogs: IssueWorklog[]
  // Состояние развёртывания: рисуем бейдж в шапке. null — не относится к
  // Platform Devops Task workflow.
  deployment: DeploymentInfo | null
  // Только для эпиков: дерево задач + их сабтасков. Пустой массив для других
  // типов.
  epicChildren: EpicChildTask[]
}

export type TransitionOption = {
  toStatusId: string
  toStatusName: string
  jiraTransitionId: string
  name: string
  requiredFields: Array<{
    field: string
    name: string
    required: boolean
    schemaType: string
  }>
}

export type TransitionsResponse = {
  fromStatusId: string
  options: TransitionOption[]
}

// Зеркало серверной IssueActivityEntry (см. apps/server/src/modules/issues/schema.ts).
export type ActivityEntryKind =
  | 'issue.create'
  | 'issue.update'
  | 'issue.transition'
  | 'issue.rank'
  | 'issue.rank-and-transition'

export type ActivityEntryState = 'pending' | 'in_flight' | 'done' | 'error' | 'dead'

export type IssueActivityEntry = {
  id: string
  kind: ActivityEntryKind
  summaries: string[]
  userId: string | null
  attempts: number
  state: ActivityEntryState
  lastError: string | null
  createdAt: string
}

export type IssuePatchInput = Partial<{
  summary: string
  assigneeId: string | null
  priorityId: string | null
  labels: string[]
  components: string[]
  dueDate: string | null
  startDate: string | null
  storyPoints: number | null
  sprintId: string | null
  epicKey: string | null
  parentKey: string | null
  customFields: Record<string, unknown>
}>
