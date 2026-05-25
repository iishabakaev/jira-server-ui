import { createRoute, redirect } from '@tanstack/react-router'
import { authKeys, fetchMe } from '../features/auth'
import { queryClient } from '../lib/query-client'
import { Route as RootRoute } from './__root'

// Корневой маршрут. Логика gating:
//   1. нет сессии -> /login
//   2. сессия есть, но PAT не подключён -> /settings/jira
//   3. иначе — показываем dashboard (на M1 — заглушка профиля).
export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/',
  beforeLoad: async () => {
    const cached = queryClient.getQueryData(authKeys.me())
    const me =
      cached === undefined
        ? await queryClient.fetchQuery({
            queryKey: authKeys.me(),
            queryFn: fetchMe,
          })
        : (cached as Awaited<ReturnType<typeof fetchMe>> | null)
    if (!me?.user) {
      throw redirect({ to: '/login' })
    }
    if (!me.jiraConnected) {
      throw redirect({ to: '/settings/jira' })
    }
    // На M4 dashboard'а как такового нет — корень ведёт сразу на kanban.
    throw redirect({ to: '/kanban' })
  },
  component: DashboardPlaceholder,
})

function DashboardPlaceholder() {
  // Никогда не рендерится: beforeLoad всегда редиректит. Оставлено для
  // удовлетворения createRoute (component обязателен в текущей версии).
  return null
}
