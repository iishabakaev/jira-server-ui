import { db, users, localCredentials, auditLog, type User } from '@db'
import { eq, sql } from 'drizzle-orm'
import { hashPassword, assertPasswordStrength } from '../../lib/password'
import { appError } from '../../plugins/error'

// Сервис управления пользователями. Создание local-аккаунта пишет одновременно
// users + local_credentials в одной транзакции. Для local-провайдера externalSub
// = users.id (см. schema/users.ts: уникальность по (provider, externalSub)).

export type CreateLocalUserInput = {
  username: string
  password: string
  displayName?: string
  email?: string
  roles?: Array<'user' | 'team_admin' | 'app_admin'>
  mustChange?: boolean
}

export type LocalUserRow = Pick<User, 'id' | 'displayName' | 'email' | 'roles'>

function normUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export async function createLocalUser(input: CreateLocalUserInput): Promise<LocalUserRow> {
  const username = normUsername(input.username)
  if (!username || username.length > 80) {
    throw appError('validation_failed', 'Username must be 1..80 chars')
  }
  assertPasswordStrength(input.password)

  const displayName = input.displayName?.trim() || username
  const email = input.email?.trim() || `${username}@local`
  const roles = input.roles && input.roles.length > 0 ? input.roles : (['user'] as const)
  const passwordHash = await hashPassword(input.password)

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ userId: localCredentials.userId })
      .from(localCredentials)
      .where(eq(localCredentials.username, username))
      .limit(1)
    if (existing[0]) {
      throw appError('validation_failed', 'Username is taken')
    }

    const userId = crypto.randomUUID()
    const inserted = await tx
      .insert(users)
      .values({
        id: userId,
        externalSub: userId,
        provider: 'local',
        email,
        displayName,
        roles: roles as unknown as User['roles'],
      })
      .returning({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        roles: users.roles,
      })

    await tx.insert(localCredentials).values({
      userId,
      username,
      passwordHash,
      mustChange: input.mustChange ? 1 : 0,
    })

    await tx.insert(auditLog).values({
      userId,
      action: 'admin.user.created',
      targetKind: 'user',
      targetId: userId,
      payload: { username, roles },
    })

    return inserted[0]!
  })
}

export async function findUserBasic(userId: string) {
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      provider: users.provider,
      roles: users.roles,
      jiraAccountId: users.jiraAccountId,
      jiraUserKey: users.jiraUserKey,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return rows[0] ?? null
}

export async function searchUsersByQuery(q: string, limit = 25) {
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`
  return db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      jiraAccountId: users.jiraAccountId,
    })
    .from(users)
    .where(sql`${users.displayName} ilike ${like} or ${users.email} ilike ${like}`)
    .limit(Math.min(limit, 100))
}
