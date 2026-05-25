import { Elysia, t } from 'elysia'
import { auth } from '../../plugins/auth'
import { appError } from '../../plugins/error'
import { findUserBasic, searchUsersByQuery } from './service'

// Минимальный users-модуль: lookup для UI-меню и поиска ответственных.
// Создание local-аккаунтов выполняется через CLI (см. docs/specs/03-auth.md),
// а не через публичный API.

const UserListItem = t.Object({
  id: t.String(),
  displayName: t.String(),
  email: t.String(),
  jiraAccountId: t.Union([t.String(), t.Null()]),
})

const UserDetail = t.Object({
  id: t.String(),
  displayName: t.String(),
  email: t.String(),
  provider: t.Union([t.Literal('local'), t.Literal('keycloak')]),
  roles: t.Array(t.Union([t.Literal('user'), t.Literal('team_admin'), t.Literal('app_admin')])),
  jiraAccountId: t.Union([t.String(), t.Null()]),
  jiraUserKey: t.Union([t.String(), t.Null()]),
})

export const usersModule = new Elysia({ prefix: '/users', name: 'users-routes' })
  .use(auth)
  .get(
    '/',
    async ({ query }) => {
      const q = (query.q ?? '').trim()
      if (q.length < 2) return { items: [] as Array<typeof UserListItem.static> }
      const items = await searchUsersByQuery(q, query.limit ?? 25)
      return { items }
    },
    {
      requireAuth: true,
      query: t.Object({
        q: t.Optional(t.String({ maxLength: 80 })),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
      }),
      response: { 200: t.Object({ items: t.Array(UserListItem) }) },
    },
  )
  .get(
    '/:id',
    async ({ params }) => {
      const user = await findUserBasic(params.id)
      if (!user) throw appError('not_found', 'User not found')
      return user
    },
    {
      requireAuth: true,
      params: t.Object({ id: t.String() }),
      response: { 200: UserDetail },
    },
  )
