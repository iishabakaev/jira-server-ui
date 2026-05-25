import { useMutation, useQueryClient } from '@tanstack/react-query'
import { kanbanKeys } from '../kanban'
import { createIssue } from './api'
import type { IssueSummary, QuickCreateInput } from './types'

// React Query: мутация quick-create. Инвалидация — точечная по тем
// kanban-снимкам, которые могут содержать новую карточку. Оптимистики
// нет: сервер сам пишет локальный draft (тот же IssueSummary, что
// возвращает /api/issues), а порядок зависит от board.config и
// rank'а — пересчёт делает сервер.

export const quickCreateKeys = {
  all: ['quick-create'] as const,
}

export function useQuickCreate(opts?: { onSuccess?: (issue: IssueSummary) => void }) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: QuickCreateInput) => createIssue(input),
    onSuccess: (issue) => {
      // Инвалидируем только kanban-data (все доски × все фильтры),
      // НЕ список досок и НЕ detail досок — они от quick-create не
      // меняются. ['kanban','data'] совпадает с префиксом kanbanKeys.data.
      void qc.invalidateQueries({ queryKey: [...kanbanKeys.all, 'data'] })
      opts?.onSuccess?.(issue)
    },
  })
}
