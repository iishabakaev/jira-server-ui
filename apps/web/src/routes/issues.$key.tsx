import { Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { createRoute, redirect } from '@tanstack/react-router'
import { authKeys, fetchMe } from '../features/auth'
import { IssuePanel } from '../features/issue-editor'
import { queryClient } from '../lib/query-client'
import { Route as RootRoute } from './__root'

// Dynamic-route /issues/:key — открывает редактор как overlay поверх любой
// текущей страницы. `from` нужен для возврата (Esc/✕): сохраняем абсолютный
// URL источника (kanban / timeline / …) и навигируем к нему при закрытии.

// `from` принимаем только как относительный path внутри SPA: один ведущий
// слэш, никаких `//` (protocol-relative), `\\`, схем и control-chars. Это
// узкий фильтр против фишинговых open-redirect ссылок типа
// `/issues/FOO?from=//evil.tld/login`.
const SearchSchema = Type.Object({
  from: Type.Optional(
    Type.String({
      maxLength: 256,
      pattern: '^/(?!/)[A-Za-z0-9_\\-./?#=&%]*$',
    }),
  ),
  fullscreen: Type.Optional(Type.Boolean()),
})

type Search = typeof SearchSchema.static

function IssueRoute() {
  const params = Route.useParams()
  const search = Route.useSearch() as Search
  const me = queryClient.getQueryData<Awaited<ReturnType<typeof fetchMe>> | null>(authKeys.me())
  return (
    <IssuePanel
      issueKey={params.key}
      fromPath={search.from}
      fullscreen={Boolean(search.fullscreen)}
      currentUserId={me?.user.id ?? null}
    />
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/issues/$key',
  validateSearch: (raw): Search => {
    const parsed = Value.Convert(SearchSchema, raw) as Search
    return Value.Check(SearchSchema, parsed) ? parsed : {}
  },
  parseParams: ({ key }) => ({ key: String(key) }),
  beforeLoad: async () => {
    const cached = queryClient.getQueryData(authKeys.me())
    const me =
      cached === undefined
        ? await queryClient.fetchQuery({ queryKey: authKeys.me(), queryFn: fetchMe })
        : (cached as Awaited<ReturnType<typeof fetchMe>> | null)
    if (!me?.user) throw redirect({ to: '/login' })
    if (!me.jiraConnected) throw redirect({ to: '/settings/jira' })
  },
  component: IssueRoute,
})
