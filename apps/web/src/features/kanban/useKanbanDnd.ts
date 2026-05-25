import type { DragEndEvent } from '@dnd-kit/core'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import {
  type BatchRankInput,
  type ProjectKanbanColumn,
  type ProjectKanbanResponse,
  postBatchRank,
} from './api'
import { kanbanKeys } from './hooks'
import type { IssueSummary } from './types'

// useKanbanDnd — связка @dnd-kit с TanStack Query.
//
// Стратегия оптимистики:
//  1. onDragEnd мы аппликейтем patch в кеш ДО HTTP-вызова — карточка
//     визуально едет немедленно.
//  2. mutation отправляет /api/issues/batch-rank с beforeId/afterId/toStatusId.
//  3. onSuccess — серверный snapshot затирает оптимистическое состояние,
//     корректно реконсилировав ranks для всех затронутых карточек.
//  4. onError — откатываем кеш к pre-drag состоянию.
//
// Внутри одной колонки batch-rank несёт только новый rank.
// Между колонками — добавляем toStatusId; сервер сам пишет outbox и
// меняет issues.status_id в той же транзакции.

interface KanbanCardId {
  type: 'card'
  issueId: string
  columnId: string
}
interface KanbanColumnId {
  type: 'column'
  columnId: string
}
export type KanbanDraggableData = KanbanCardId
export type KanbanDroppableData = KanbanCardId | KanbanColumnId

function findColumn(
  data: ProjectKanbanResponse,
  columnId: string,
): ProjectKanbanColumn | undefined {
  if (data.other && data.other.groupId === columnId) return data.other
  return data.columns.find((c) => (c.groupId ?? c.name) === columnId)
}

function columnKey(col: ProjectKanbanColumn): string {
  return col.groupId ?? col.name
}

interface ApplyMove {
  data: ProjectKanbanResponse
  draggedId: string
  fromColumnId: string
  toColumnId: string
  // -1 — в конец колонки.
  toIndex: number
}

function applyMove({
  data,
  draggedId,
  fromColumnId,
  toColumnId,
  toIndex,
}: ApplyMove): ProjectKanbanResponse {
  // Глубокое копирование только тех колонок, что меняем.
  const cloneCol = (c: ProjectKanbanColumn): ProjectKanbanColumn => ({
    ...c,
    items: c.items.slice(),
  })

  const colMap = new Map<string, ProjectKanbanColumn>()
  for (const c of data.columns) colMap.set(columnKey(c), c)
  if (data.other) colMap.set(columnKey(data.other), data.other)

  const from = colMap.get(fromColumnId)
  const to = colMap.get(toColumnId)
  if (!from || !to) return data

  const idx = from.items.findIndex((i) => i.id === draggedId)
  if (idx < 0) return data
  const dragged = from.items[idx]!
  const newFrom = cloneCol(from)
  newFrom.items.splice(idx, 1)
  newFrom.count = Math.max(0, newFrom.count - 1)

  const newTo = fromColumnId === toColumnId ? newFrom : cloneCol(to)
  const insertAt = toIndex < 0 ? newTo.items.length : Math.min(toIndex, newTo.items.length)
  // При перемещении между колонками подменяем statusId, чтобы сразу же
  // карточка не подсвечивалась как Other на следующем re-render.
  const targetStatusId =
    fromColumnId === toColumnId ? dragged.statusId : (newTo.statusIds[0] ?? dragged.statusId)
  const moved: IssueSummary = {
    ...dragged,
    statusId: targetStatusId,
    syncState: 'pending',
  }
  newTo.items.splice(insertAt, 0, moved)
  newTo.count = newTo.items.length

  const newColumns = data.columns.map((c) => {
    const k = columnKey(c)
    if (k === columnKey(newFrom)) return newFrom
    if (k === columnKey(newTo)) return newTo
    return c
  })
  const newOther =
    data.other && columnKey(data.other) === columnKey(newFrom)
      ? newFrom
      : data.other && columnKey(data.other) === columnKey(newTo)
        ? newTo
        : data.other

  return { ...data, columns: newColumns, other: newOther }
}

export function useKanbanDnd(projectId: string | null, queryKey: readonly unknown[]) {
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: BatchRankInput) => postBatchRank(input),
    onSettled: () => {
      if (projectId) void qc.invalidateQueries({ queryKey: kanbanKeys.all })
    },
  })

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return
      const activeData = active.data.current as KanbanDraggableData | undefined
      const overData = over.data.current as KanbanDroppableData | undefined
      if (!activeData || activeData.type !== 'card') return
      if (!overData) return

      const fromColumnId = activeData.columnId
      // Оба типа Droppable несут columnId — извлекаем без ветвления.
      const toColumnId = overData.columnId
      if (active.id === over.id && fromColumnId === toColumnId) return

      const snapshot = qc.getQueryData<ProjectKanbanResponse>(queryKey)
      if (!snapshot) return

      // Считаем целевой индекс. Если бросаем на колонку — в конец;
      // если на карточку — на её место (если from===to, отнимаем 1 для
      // случая drag вниз).
      const toCol = findColumn(snapshot, toColumnId)
      if (!toCol) return
      let toIndex = -1
      if (overData.type === 'card') {
        const overIdx = toCol.items.findIndex((i) => i.id === overData.issueId)
        toIndex = overIdx < 0 ? -1 : overIdx
        if (fromColumnId === toColumnId) {
          const fromIdx = toCol.items.findIndex((i) => i.id === activeData.issueId)
          if (fromIdx >= 0 && fromIdx < overIdx) toIndex = overIdx
        }
      }

      const next = applyMove({
        data: snapshot,
        draggedId: activeData.issueId,
        fromColumnId,
        toColumnId,
        toIndex,
      })
      qc.setQueryData<ProjectKanbanResponse>(queryKey, next)

      // Реконструируем beforeId/afterId по позиции в целевой колонке.
      const finalCol = findColumn(next, toColumnId)
      if (!finalCol) return
      const finalIdx = finalCol.items.findIndex((i) => i.id === activeData.issueId)
      const beforeId = finalIdx > 0 ? finalCol.items[finalIdx - 1]!.id : null
      const afterId =
        finalIdx >= 0 && finalIdx < finalCol.items.length - 1
          ? finalCol.items[finalIdx + 1]!.id
          : null

      const targetStatusId = fromColumnId !== toColumnId ? finalCol.statusIds[0] : undefined

      mutation.mutate(
        {
          issueIds: [activeData.issueId],
          beforeId,
          afterId,
          ...(targetStatusId ? { toStatusId: targetStatusId } : {}),
        },
        {
          onError: () => {
            qc.setQueryData(queryKey, snapshot)
          },
        },
      )
    },
    [mutation, qc, queryKey],
  )

  return { handleDragEnd, isMutating: mutation.isPending }
}
