import { api } from '../../lib/eden'
import type { TimelineBar, TimelineGroupBy } from './types'

// Тонкая Eden-обёртка. Все запросы timeline — через эти функции;
// прямой fetch / api.api... в компонентах запрещён (см. .agents/PATTERNS.md).

export type TimelineWindowQuery = {
  projectId: string
  from: string
  to: string
  group?: TimelineGroupBy
  limit?: number
}

export type TimelineWindowResponse = {
  projectId: string
  from: string
  to: string
  group: TimelineGroupBy
  items: TimelineBar[]
}

export class TimelineError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TimelineError'
  }
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new TimelineError(inner?.code ?? 'unknown', inner?.message ?? 'Request failed')
  }
  if (res.data === null) throw new TimelineError('unknown', 'Empty response')
  return res.data
}

export async function fetchTimelineWindow(
  query: TimelineWindowQuery,
): Promise<TimelineWindowResponse> {
  const res = await api.api.timeline.get({ query })
  return unwrap(res) as TimelineWindowResponse
}

// Reuse существующего PATCH /api/issues/:k — он уже принимает startDate/dueDate
// и пишет outbox-строку в той же транзакции. Никаких новых server-эндпойнтов
// для drag-резайза не требуется.
export type PatchIssueDatesInput = {
  keyOrId: string
  startDate?: string | null
  dueDate?: string | null
}

export async function patchIssueDates(input: PatchIssueDatesInput): Promise<TimelineBar> {
  // TypeScript IssuePatch требует, чтобы пустой объект не уходил — фильтр
  // делает caller. Здесь только сериализация.
  const body: Record<string, string | null> = {}
  if ('startDate' in input) body.startDate = input.startDate ?? null
  if ('dueDate' in input) body.dueDate = input.dueDate ?? null
  const res = await api.api
    .issues({ keyOrId: input.keyOrId })
    // Eden-typing требует точный shape патча — приводим через unknown,
    // т.к. PATCH /api/issues принимает IssuePatch с union nullable.
    .patch(body as unknown as never)
  const issue = unwrap(res).issue
  // IssueSummary шире TimelineBar — обрезаем до полей timeline'а.
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.summary,
    issueTypeId: issue.issueTypeId,
    issueTypeName: issue.issueTypeName,
    issueTypeIconUrl: issue.issueTypeIconUrl,
    statusId: issue.statusId,
    statusName: issue.statusName,
    statusCategory: issue.statusCategory,
    assigneeId: issue.assigneeId,
    assigneeDisplayName: issue.assigneeDisplayName,
    epicJiraId: issue.epicJiraId,
    sprintId: issue.sprintId,
    sprintName: issue.sprintName,
    startDate: issue.startDate,
    dueDate: issue.dueDate,
    storyPoints: issue.storyPoints,
    syncState: issue.syncState,
  }
}
