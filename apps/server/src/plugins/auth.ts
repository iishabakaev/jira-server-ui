import { Elysia } from 'elysia'
import { db, users, type User } from '@db'
import { eq } from 'drizzle-orm'
import { env } from '../env'
import { loadSession } from '../modules/auth/sessions'

// Реальный auth-плагин: достаёт session-cookie, грузит сессию из БД, по
// session.userId — пользователя. Контекст обогащается `user` и `session`.
// Все защищённые маршруты опираются на макросы requireAuth / requireRole.

export type SessionUser = Pick<User, 'id' | 'displayName' | 'email' | 'provider' | 'roles' | 'jiraAccountId' | 'jiraUserKey'>

type AuthContext = {
  user: SessionUser | null
  set: { status?: number }
}

async function loadUser(userId: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      provider: users.provider,
      roles: users.roles,
      jiraAccountId: users.jiraAccountId,
      jiraUserKey: users.jiraUserKey,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  if (row.disabledAt) return null
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    provider: row.provider,
    roles: row.roles,
    jiraAccountId: row.jiraAccountId,
    jiraUserKey: row.jiraUserKey,
  }
}

export const auth = new Elysia({ name: 'auth' })
  .derive({ as: 'global' }, async ({ cookie }) => {
    const sid = cookie[env.SESSION_COOKIE_NAME]?.value
    if (!sid || typeof sid !== 'string') {
      return { user: null as SessionUser | null, session: null as null | { id: string } }
    }
    const session = await loadSession(sid)
    if (!session) {
      return { user: null as SessionUser | null, session: null as null | { id: string } }
    }
    const user = await loadUser(session.userId)
    return { user, session: { id: session.id } }
  })
  .macro(({ onBeforeHandle }) => ({
    requireAuth(value: boolean) {
      if (!value) return
      onBeforeHandle(({ user, set }: AuthContext) => {
        if (!user) {
          set.status = 401
          return { error: { code: 'unauthenticated', message: 'Not signed in.' } }
        }
      })
    },
    requireRole(role: 'user' | 'team_admin' | 'app_admin' | undefined) {
      // Симметрично requireAuth — без значения макрос не должен регистрироваться;
      // иначе случайный `requireRole: undefined` зарегистрировал бы фильтр с
      // ролью=undefined и заблокировал бы всех (см. security-review).
      if (!role) return
      onBeforeHandle(({ user, set }: AuthContext) => {
        if (!user) {
          set.status = 401
          return { error: { code: 'unauthenticated', message: 'Not signed in.' } }
        }
        if (!user.roles.includes(role)) {
          set.status = 403
          return { error: { code: 'forbidden', message: `Role ${role} required.` } }
        }
      })
    },
  }))
