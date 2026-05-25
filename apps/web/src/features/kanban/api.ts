import { api } from '../../lib/eden'
import type { IssueSummary, StatusCategory } from './types'

// Тонкая Eden-обёртка. Все запросы kanban / issues — через эти функции;
// прямой fetch / api.api... в компонентах запрещён (см. .agents/PATTERNS.md).

export type KanbanQuery = {
  groupBy?: 'status' | 'assignee' | 'epic' | 'priority' | 'sprint'
  assigneeIds?: string[]
  epicKeys?: string[]
  sprintIds?: string[]
  labels?: string[]
  components?: string[]
  priorities?: string[]
  statusCategories?: Array<'new' | 'indeterminate' | 'done'>
  text?: string
  cursor?: string
  limit?: number
}

// Project-driven kanban column — наша колонка, построенная поверх statuses.
// wipLimit не возвращаем (управление лимитом — будущая UI-only фича).
export type ProjectKanbanColumn = {
  name: string
  groupId: string | null
  statusIds: string[]
  statusCategory: StatusCategory | null
  count: number
  items: IssueSummary[]
}

export type ProjectKanbanResponse = {
  projectId: string
  groupBy: KanbanQuery['groupBy']
  columns: ProjectKanbanColumn[]
  other?: ProjectKanbanColumn
  cursor: string | null
}

export class KanbanError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'KanbanError'
  }
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new KanbanError(inner?.code ?? 'unknown', inner?.message ?? 'Request failed')
  }
  if (res.data === null) throw new KanbanError('unknown', 'Empty response')
  return res.data
}

export async function fetchProjectKanban(
  projectId: string,
  query: KanbanQuery,
): Promise<ProjectKanbanResponse> {
  const res = await api.api.projects({ id: projectId }).kanban.get({ query })
  return unwrap(res) as ProjectKanbanResponse
}

export async function fetchIssue(keyOrId: string): Promise<IssueSummary> {
  const res = await api.api.issues({ keyOrId }).get()
  return unwrap(res).issue
}

export type BatchRankInput = {
  issueIds: string[]
  beforeId: string | null
  afterId: string | null
  toStatusId?: string
}

export async function postBatchRank(input: BatchRankInput): Promise<IssueSummary[]> {
  const res = await api.api.issues['batch-rank'].post(input)
  return unwrap(res).items
}

export type TransitionInput = {
  keyOrId: string
  toStatusId: string
  fields?: Record<string, unknown>
}

export async function postTransition(input: TransitionInput): Promise<IssueSummary> {
  const res = await api.api.issues({ keyOrId: input.keyOrId }).transition.post({
    toStatusId: input.toStatusId,
    fields: input.fields,
  })
  return unwrap(res).issue
}
