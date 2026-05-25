import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { createRoute, redirect } from '@tanstack/react-router'
import { authKeys, fetchMe } from '../features/auth'
import { TimelinePage } from '../features/timeline'
import { queryClient } from '../lib/query-client'
import { Route as RootRoute } from './__root'

// Search-схема — та же TypeBox-конвенция, что и kanban.tsx. project — uuid;
// zoom/group ограничены литералами; from — ISO YYYY-MM-DD.
const SearchSchema = Type.Object({
  project: Type.Optional(Type.String()),
  from: Type.Optional(Type.String()),
  zoom: Type.Optional(
    Type.Union([
      Type.Literal('week'),
      Type.Literal('2w'),
      Type.Literal('month'),
      Type.Literal('quarter'),
    ]),
  ),
  group: Type.Optional(
    Type.Union([
      Type.Literal('epic'),
      Type.Literal('assignee'),
      Type.Literal('sprint'),
      Type.Literal('none'),
    ]),
  ),
})

type Search = typeof SearchSchema.static

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/timeline',
  validateSearch: (raw): Search => {
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
  component: TimelinePage,
})
