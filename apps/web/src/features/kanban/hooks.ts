import { useQuery } from '@tanstack/react-query'
import { fetchProjectKanban, type KanbanQuery } from './api'

// React Query keys — единый ключ-фабрика, чтобы инвалидация была точечной.
// На стороне UI kanban больше не зависит от Jira boards: всё атрибутируется
// проекту.
export const kanbanKeys = {
  all: ['kanban'] as const,
  data: (projectId: string, query: KanbanQuery) =>
    [...kanbanKeys.all, 'data', projectId, query] as const,
}

export function useProjectKanban(projectId: string | null, query: KanbanQuery) {
  return useQuery({
    queryKey: projectId ? kanbanKeys.data(projectId, query) : ['kanban', 'data', 'noop'],
    queryFn: () => fetchProjectKanban(projectId!, query),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  })
}
