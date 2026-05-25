import { api } from '../../lib/eden'
import type {
  IssueActivityEntry,
  IssueComment,
  IssueDetail,
  IssuePatchInput,
  IssueSummary,
  TransitionsResponse,
} from './types'

// Тонкая Eden-обёртка для редактора issue. Единственная точка, через которую
// фичевые компоненты говорят с сервером.

export class IssueEditorError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'IssueEditorError'
  }
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new IssueEditorError(inner?.code ?? 'unknown', inner?.message ?? 'Request failed')
  }
  if (res.data === null) throw new IssueEditorError('unknown', 'Empty response')
  return res.data
}

export async function fetchIssueDetail(keyOrId: string): Promise<IssueDetail> {
  const res = await api.api.issues({ keyOrId }).detail.get()
  return unwrap(res).detail as IssueDetail
}

export async function fetchIssueTransitions(keyOrId: string): Promise<TransitionsResponse> {
  const res = await api.api.issues({ keyOrId }).transitions.get()
  return unwrap(res) as TransitionsResponse
}

export async function fetchIssueActivity(keyOrId: string): Promise<IssueActivityEntry[]> {
  const res = await api.api.issues({ keyOrId }).activity.get()
  return unwrap(res).items as IssueActivityEntry[]
}

export async function patchIssue(keyOrId: string, patch: IssuePatchInput): Promise<IssueSummary> {
  const res = await api.api.issues({ keyOrId }).patch(patch)
  return unwrap(res).issue as IssueSummary
}

export async function transitionIssue(
  keyOrId: string,
  toStatusId: string,
  fields?: Record<string, unknown>,
): Promise<IssueSummary> {
  const res = await api.api.issues({ keyOrId }).transition.post({ toStatusId, fields })
  return unwrap(res).issue as IssueSummary
}

export async function addComment(keyOrId: string, text: string): Promise<IssueComment> {
  const res = await api.api.issues({ keyOrId }).comments.post({ text })
  return unwrap(res).comment as IssueComment
}

export async function editComment(commentId: string, text: string): Promise<IssueComment> {
  const res = await api.api.issues.comments({ commentId }).patch({ text })
  return unwrap(res).comment as IssueComment
}

export async function deleteComment(commentId: string): Promise<void> {
  const res = await api.api.issues.comments({ commentId }).delete()
  unwrap(res)
}

export type ReorderSubtaskInput = {
  // Сабтаск, который пользователь перетащил.
  subtaskId: string
  // Соседи в целевой позиции: id строки выше и ниже вставки. null означает
  // край списка. Сервер реконструирует rank через rankSequence().
  beforeId: string | null
  afterId: string | null
}

export async function reorderSubtask(input: ReorderSubtaskInput): Promise<IssueSummary[]> {
  // Реюзаем batch-rank — сабтаски это обычные issues с parent. Сервер
  // выпишет новый orderingRank + outbox issue.rank в одной транзакции.
  const res = await api.api.issues['batch-rank'].post({
    issueIds: [input.subtaskId],
    beforeId: input.beforeId,
    afterId: input.afterId,
  })
  return unwrap(res).items as IssueSummary[]
}
