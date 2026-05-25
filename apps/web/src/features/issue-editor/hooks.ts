import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  addComment,
  deleteComment,
  editComment,
  fetchIssueActivity,
  fetchIssueDetail,
  fetchIssueTransitions,
  patchIssue,
  type ReorderSubtaskInput,
  reorderSubtask,
  transitionIssue,
} from './api'
import type { IssueDetail, IssuePatchInput, SubtaskSummary } from './types'

// React Query keys для редактора. Изоляция от kanban-keys нужна, чтобы
// инвалидация по issue/:key не сбрасывала kanban-кеш — kanban сам подпишется
// на SSE-патчи (см. docs/specs/10-realtime-and-status.md).
export const issueEditorKeys = {
  all: ['issue-editor'] as const,
  detail: (keyOrId: string) => [...issueEditorKeys.all, 'detail', keyOrId] as const,
  transitions: (keyOrId: string) => [...issueEditorKeys.all, 'transitions', keyOrId] as const,
  activity: (keyOrId: string) => [...issueEditorKeys.all, 'activity', keyOrId] as const,
}

export function useIssueDetail(keyOrId: string | null) {
  return useQuery({
    queryKey: keyOrId ? issueEditorKeys.detail(keyOrId) : ['issue-editor', 'detail', 'noop'],
    queryFn: () => fetchIssueDetail(keyOrId!),
    enabled: Boolean(keyOrId),
    staleTime: 15_000,
  })
}

export function useIssueTransitions(keyOrId: string | null) {
  return useQuery({
    queryKey: keyOrId
      ? issueEditorKeys.transitions(keyOrId)
      : ['issue-editor', 'transitions', 'noop'],
    queryFn: () => fetchIssueTransitions(keyOrId!),
    enabled: Boolean(keyOrId),
    staleTime: 60_000,
  })
}

// Activity подгружается лениво: тяжёлый endpoint, выполнять его при каждом
// открытии панели нет смысла. `enabled` контролирует фактический request —
// фид появляется только когда пользователь переключился на таб Activity.
export function useIssueActivity(keyOrId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: keyOrId ? issueEditorKeys.activity(keyOrId) : ['issue-editor', 'activity', 'noop'],
    queryFn: () => fetchIssueActivity(keyOrId!),
    enabled: Boolean(keyOrId) && enabled,
    staleTime: 10_000,
  })
}

// Оптимистический patch: подменяем summary в кеше до ответа сервера, чтобы
// текст не "прыгал" при blur. На ошибке восстанавливаем предыдущее значение.
export function usePatchIssue(keyOrId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: IssuePatchInput) => patchIssue(keyOrId, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: issueEditorKeys.detail(keyOrId) })
      const previous = qc.getQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId))
      if (previous) {
        qc.setQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId), {
          ...previous,
          summary: {
            ...previous.summary,
            ...('summary' in patch && patch.summary !== undefined
              ? { summary: patch.summary }
              : {}),
            ...('assigneeId' in patch ? { assigneeId: patch.assigneeId ?? null } : {}),
            ...('priorityId' in patch ? { priorityId: patch.priorityId ?? null } : {}),
            ...('labels' in patch && patch.labels !== undefined ? { labels: patch.labels } : {}),
            ...('storyPoints' in patch ? { storyPoints: patch.storyPoints ?? null } : {}),
            ...('startDate' in patch ? { startDate: patch.startDate ?? null } : {}),
            ...('dueDate' in patch ? { dueDate: patch.dueDate ?? null } : {}),
            syncState: 'pending',
          },
        })
      }
      return { previous }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(issueEditorKeys.detail(keyOrId), ctx.previous)
      }
    },
    onSuccess: (updated) => {
      const current = qc.getQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId))
      if (current) {
        qc.setQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId), {
          ...current,
          summary: updated,
        })
      }
      // Свежий outbox-row уже в БД — инвалидируем activity, чтобы фид
      // подхватил новую запись при следующем заходе во вкладку.
      void qc.invalidateQueries({ queryKey: issueEditorKeys.activity(keyOrId) })
    },
  })
}

export function useTransitionIssue(keyOrId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { toStatusId: string; fields?: Record<string, unknown> }) =>
      transitionIssue(keyOrId, input.toStatusId, input.fields),
    onSuccess: (updated) => {
      const current = qc.getQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId))
      if (current) {
        qc.setQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId), {
          ...current,
          summary: updated,
        })
      }
      void qc.invalidateQueries({ queryKey: issueEditorKeys.transitions(keyOrId) })
      void qc.invalidateQueries({ queryKey: issueEditorKeys.activity(keyOrId) })
    },
  })
}

export function useAddComment(keyOrId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (text: string) => addComment(keyOrId, text),
    onSuccess: (comment) => {
      const current = qc.getQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId))
      if (current) {
        qc.setQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId), {
          ...current,
          comments: [...current.comments, comment],
        })
      }
    },
  })
}

export function useEditComment(keyOrId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { commentId: string; text: string }) =>
      editComment(input.commentId, input.text),
    onSuccess: (updated) => {
      const current = qc.getQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId))
      if (current) {
        qc.setQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId), {
          ...current,
          comments: current.comments.map((c) => (c.id === updated.id ? updated : c)),
        })
      }
    },
  })
}

// Drag-reorder сабтасков. Оптимистически переставляем строки в кеше detail'а
// до ответа сервера — карточка едет визуально немедленно.
//
// Откат на ошибке: восстанавливаем только массив subtasks, а не весь detail.
// Это важно потому, что пока reorder в полёте, пользователь мог через
// usePatchIssue отредактировать summary/assignee/etc — wholesale rollback
// бы стёр эти параллельные правки.
//
// onSettled: invalidate(detail) — гарантия eventual consistency. Сервер
// поправит rank'и для всех затронутых соседей; ре-фетч уберёт оптимистический
// порядок, если он разошёлся с серверным.
//
// Race-замечание: при двух быстрых drag'ах подряд второй onMutate захватит
// уже оптимистически обновлённое previous; rollback второй мутации
// вернёт к пост-первому-drag состоянию, не к исходному. Это стандартный
// TanStack-паттерн и для UX сабтасков допустимо: invalidate в onSettled
// в конечном счёте подтянет сервак-truth.
export function useReorderSubtasks(keyOrId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { ordered: SubtaskSummary[]; payload: ReorderSubtaskInput }) =>
      reorderSubtask(input.payload),
    onMutate: async ({ ordered }) => {
      await qc.cancelQueries({ queryKey: issueEditorKeys.detail(keyOrId) })
      const previous = qc.getQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId))
      if (previous) {
        qc.setQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId), {
          ...previous,
          subtasks: ordered,
        })
      }
      // Снапшот именно subtasks — чтобы rollback не затёр параллельные правки.
      return { previousSubtasks: previous?.subtasks ?? null }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.previousSubtasks) return
      const current = qc.getQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId))
      if (current) {
        qc.setQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId), {
          ...current,
          subtasks: ctx.previousSubtasks,
        })
      }
    },
    onSettled: () => {
      // Свежий outbox-row уже в БД — invalidate detail подтянет серверный
      // порядок (с учётом rank'ов соседей), invalidate activity — issue.rank
      // запись в фид. Кanban использует ту же стратегию.
      void qc.invalidateQueries({ queryKey: issueEditorKeys.detail(keyOrId) })
      void qc.invalidateQueries({ queryKey: issueEditorKeys.activity(keyOrId) })
    },
  })
}

export function useDeleteComment(keyOrId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (commentId: string) => deleteComment(commentId),
    onSuccess: (_void, commentId) => {
      const current = qc.getQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId))
      if (current) {
        qc.setQueryData<IssueDetail>(issueEditorKeys.detail(keyOrId), {
          ...current,
          comments: current.comments.filter((c) => c.id !== commentId),
        })
      }
    },
  })
}
