import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchTimelineWindow,
  type PatchIssueDatesInput,
  patchIssueDates,
  type TimelineWindowQuery,
  type TimelineWindowResponse,
} from './api'
import type { TimelineBar } from './types'

// React Query keys — точечная инвалидация, чтобы webhook-патчи и оптимистика
// не сбрасывали соседние окна.
export const timelineKeys = {
  all: ['timeline'] as const,
  window: (query: TimelineWindowQuery) => [...timelineKeys.all, 'window', query] as const,
}

export function useTimelineWindow(query: TimelineWindowQuery | null) {
  return useQuery({
    queryKey: query ? timelineKeys.window(query) : ['timeline', 'window', 'noop'],
    queryFn: () => fetchTimelineWindow(query!),
    enabled: Boolean(query),
    staleTime: 15_000,
  })
}

// Оптимистическое обновление дат: мутация патчит кеш кадров timeline'а,
// затем подтверждает / откатывает по ответу сервера. Поскольку окно
// timeline'а может включать несколько query-ключей (разные zoom-уровни
// в фоне), патчим ВСЕ окна, кеширующие этот bar.
export function usePatchIssueDates() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: patchIssueDates,
    onMutate: async (input: PatchIssueDatesInput) => {
      await qc.cancelQueries({ queryKey: timelineKeys.all })

      const previous: Array<{ key: readonly unknown[]; data: TimelineWindowResponse }> = []
      qc.getQueriesData<TimelineWindowResponse>({ queryKey: timelineKeys.all }).forEach(
        ([key, data]) => {
          if (!data) return
          previous.push({ key, data })
          const next: TimelineWindowResponse = {
            ...data,
            items: data.items.map((bar) =>
              bar.key === input.keyOrId || bar.id === input.keyOrId
                ? {
                    ...bar,
                    startDate: 'startDate' in input ? (input.startDate ?? null) : bar.startDate,
                    dueDate: 'dueDate' in input ? (input.dueDate ?? null) : bar.dueDate,
                    syncState: 'pending',
                  }
                : bar,
            ),
          }
          qc.setQueryData(key, next)
        },
      )

      return { previous }
    },
    onError: (_err, _input, ctx) => {
      // Откат: возвращаем все патченные окна к предыдущему состоянию.
      // forEach с returning callback'ом ловит biome; явный block.
      if (!ctx?.previous) return
      for (const { key, data } of ctx.previous) {
        qc.setQueryData(key, data)
      }
    },
    onSuccess: (updated: TimelineBar) => {
      // Сервер вернул каноническую summary — синхронизируем кеш всех окон,
      // содержащих этот bar. Не инвалидируем — иначе на каждом drag'е
      // дёргается рефетч.
      qc.getQueriesData<TimelineWindowResponse>({ queryKey: timelineKeys.all }).forEach(
        ([key, data]) => {
          if (!data) return
          if (!data.items.some((b) => b.id === updated.id)) return
          qc.setQueryData(key, {
            ...data,
            items: data.items.map((b) => (b.id === updated.id ? updated : b)),
          })
        },
      )
    },
  })
}
