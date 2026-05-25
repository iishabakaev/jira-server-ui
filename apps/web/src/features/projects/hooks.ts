import { useQuery } from '@tanstack/react-query'
import { fetchProjectDetail, fetchProjectSprints, fetchProjects } from './api'

// Локальный фуззи-фильтр выполняется на клиенте; сервер отдаёт уже отобранный
// набор (по ilike key|name) — фильтр здесь делает финальное ранжирование.
export const projectsKeys = {
  all: ['projects'] as const,
  list: () => [...projectsKeys.all, 'list'] as const,
  detail: (id: string) => [...projectsKeys.all, 'detail', id] as const,
  sprints: (id: string) => [...projectsKeys.all, 'sprints', id] as const,
}

// Загружаем полный список один раз — у проектов в типичной инстансе единицы
// или десятки, держать в памяти дёшево. Сервер не индексирует по text,
// поэтому повторно ходить за вариациями того же набора нет смысла.
export function useProjects() {
  return useQuery({
    queryKey: projectsKeys.list(),
    queryFn: () => fetchProjects(null),
    staleTime: 60_000,
  })
}

export function useProjectDetail(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? projectsKeys.detail(projectId) : ['projects', 'detail', 'noop'],
    queryFn: () => fetchProjectDetail(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  })
}

export function useProjectSprints(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? projectsKeys.sprints(projectId) : ['projects', 'sprints', 'noop'],
    queryFn: () => fetchProjectSprints(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  })
}
