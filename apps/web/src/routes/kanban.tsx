import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { createRoute, redirect } from '@tanstack/react-router'
import { authKeys, fetchMe } from '../features/auth'
import { KanbanPage } from '../features/kanban'
import { queryClient } from '../lib/query-client'
import { Route as RootRoute } from './__root'

// Search-схема — TypeBox; конвертим в URL-state той же библиотекой,
// что валидирует серверные запросы. Конвертируем boolean из/в строку,
// чтобы URL читался руками. M-текущий: kanban теперь project-driven,
// search-параметр `project` хранит uuid выбранного проекта (раньше был `board`).

const SearchSchema = Type.Object({
  project: Type.Optional(Type.String()),
  group: Type.Optional(
    Type.Union([
      Type.Literal('status'),
      Type.Literal('assignee'),
      Type.Literal('epic'),
      Type.Literal('priority'),
      Type.Literal('sprint'),
    ]),
  ),
  density: Type.Optional(
    Type.Union([Type.Literal('compact'), Type.Literal('comfortable'), Type.Literal('spacious')]),
  ),
  text: Type.Optional(Type.String()),
  hideDone: Type.Optional(Type.Boolean()),
  layout: Type.Optional(Type.Union([Type.Literal('board'), Type.Literal('list')])),
  filters: Type.Optional(Type.String()),
})

type Search = typeof SearchSchema.static

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/kanban',
  validateSearch: (raw): Search => {
    // TanStack Router отдаёт уже распарсенный объект; принудительно
    // приводим типы и отбрасываем неизвестные поля.
    const parsed = Value.Convert(SearchSchema, raw) as Search
    return Value.Check(SearchSchema, parsed) ? parsed : {}
  },
  beforeLoad: async () => {
    const cached = queryClient.getQueryData(authKeys.me())
    const me =
      cached === undefined
        ? await queryClient.fetchQuery({ queryKey: authKeys.me(), queryFn: fetchMe })
        : (cached as Awaited<ReturnType<typeof fetchMe>> | null)
    if (!me?.user) throw redirect({ to: '/login' })
    if (!me.jiraConnected) throw redirect({ to: '/settings/jira' })
  },
  component: KanbanPage,
})
