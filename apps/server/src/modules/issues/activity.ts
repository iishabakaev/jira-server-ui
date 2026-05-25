import type { OutboxEvent } from '@db'
import type { ActivityEntryKind, IssueActivityEntry } from './schema'

// Чистые функции построения activity-фида. Вынесены в отдельный модуль,
// чтобы рендерер был покрыт юнит-тестами без подключения БД.
//
// Контракт: рендерер получает строку outbox + lookup-map статусов
// (uuid → имя) и возвращает entry с уже готовыми human-readable строками.
// UI ничего не разбирает.

const ACTIVITY_KINDS = new Set<ActivityEntryKind>([
  'issue.create',
  'issue.update',
  'issue.transition',
  'issue.rank',
  'issue.rank-and-transition',
])

export function isActivityKind(kind: string): kind is ActivityEntryKind {
  return ACTIVITY_KINDS.has(kind as ActivityEntryKind)
}

// Поля, которые в payload.patch обычно "пустеют" через явный null. Для них
// рендерим "Cleared X" вместо "Set X to null".
const NULLABLE_FIELDS = new Set([
  'assigneeId',
  'priorityId',
  'sprintId',
  'epicKey',
  'parentKey',
  'dueDate',
  'startDate',
  'storyPoints',
])

// Имя поля, как мы видим его в UI. Для customFields оставляем сырой ключ —
// у нас на сервере нет field-config map'а (он лежит в metadata, но раскладка
// под issue type — на M6 ещё не реализована).
const FIELD_LABELS: Record<string, string> = {
  summary: 'summary',
  assigneeId: 'assignee',
  priorityId: 'priority',
  labels: 'labels',
  components: 'components',
  dueDate: 'due date',
  startDate: 'start date',
  storyPoints: 'story points',
  sprintId: 'sprint',
  epicKey: 'epic',
  parentKey: 'parent',
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

function describeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'string') return value.length > 64 ? `${value.slice(0, 61)}…` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return '…'
}

function summariesForUpdate(patch: Record<string, unknown>): string[] {
  const lines: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'customFields' && value && typeof value === 'object') {
      const cf = value as Record<string, unknown>
      const count = Object.keys(cf).length
      if (count > 0) lines.push(`updated ${count} custom field${count === 1 ? '' : 's'}`)
      continue
    }
    if (value === null && NULLABLE_FIELDS.has(key)) {
      lines.push(`cleared ${fieldLabel(key)}`)
      continue
    }
    lines.push(`set ${fieldLabel(key)} to ${describeValue(value)}`)
  }
  return lines.length > 0 ? lines : ['updated issue']
}

function summariesForTransition(
  payload: Record<string, unknown>,
  statusNameById: Map<string, string>,
): string[] {
  const toStatusId = typeof payload.toStatusId === 'string' ? (payload.toStatusId as string) : null
  if (toStatusId) {
    const name = statusNameById.get(toStatusId)
    if (name) return [`moved to ${name}`]
  }
  return ['changed status']
}

function summariesForRank(
  payload: Record<string, unknown>,
  statusNameById: Map<string, string>,
  withTransition: boolean,
): string[] {
  if (withTransition) {
    const toStatusId =
      typeof payload.toStatusId === 'string' ? (payload.toStatusId as string) : null
    if (toStatusId) {
      const name = statusNameById.get(toStatusId)
      return name ? [`reordered and moved to ${name}`] : ['reordered and changed status']
    }
  }
  return ['reordered card']
}

function summariesForCreate(payload: Record<string, unknown>): string[] {
  if (typeof payload.summary === 'string') {
    const value = payload.summary as string
    return [`created with summary “${describeValue(value)}”`]
  }
  return ['created issue']
}

// Из outbox-строки выделяем статусы, к которым она ссылается. Нужно
// загрузить только их имена — общий каталог статусов может быть большим.
export function collectStatusRefs(
  rows: ReadonlyArray<Pick<OutboxEvent, 'kind' | 'payload'>>,
): string[] {
  const ids = new Set<string>()
  for (const row of rows) {
    if (!row.payload || typeof row.payload !== 'object') continue
    if (row.kind === 'issue.transition' || row.kind === 'issue.rank-and-transition') {
      const id = (row.payload as Record<string, unknown>).toStatusId
      if (typeof id === 'string') ids.add(id)
    }
  }
  return Array.from(ids)
}

export interface ActivityRow {
  id: number | string
  kind: string
  payload: unknown
  userId: string | null
  attempts: number
  state: OutboxEvent['state']
  lastError: string | null
  createdAt: Date
}

export function renderActivity(
  row: ActivityRow,
  statusNameById: Map<string, string>,
): IssueActivityEntry | null {
  if (!isActivityKind(row.kind)) return null
  const payload =
    row.payload && typeof row.payload === 'object' ? (row.payload as Record<string, unknown>) : {}

  let summaries: string[] = []
  switch (row.kind) {
    case 'issue.create':
      summaries = summariesForCreate(payload)
      break
    case 'issue.update': {
      const patch =
        payload.patch && typeof payload.patch === 'object'
          ? (payload.patch as Record<string, unknown>)
          : {}
      summaries = summariesForUpdate(patch)
      break
    }
    case 'issue.transition':
      summaries = summariesForTransition(payload, statusNameById)
      break
    case 'issue.rank':
      summaries = summariesForRank(payload, statusNameById, false)
      break
    case 'issue.rank-and-transition':
      summaries = summariesForRank(payload, statusNameById, true)
      break
  }

  return {
    id: String(row.id),
    kind: row.kind,
    summaries,
    userId: row.userId,
    attempts: row.attempts,
    state: row.state,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  }
}
