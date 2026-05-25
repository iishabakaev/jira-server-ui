import { db, users, localCredentials, auditLog, type User } from '@db'
import { eq, and, isNull, sql } from 'drizzle-orm'
import { verifyPassword, hashPassword, computeLockoutUntil, assertPasswordStrength } from '../../lib/password'
import { appError } from '../../plugins/error'

// Бизнес-логика входа по локальному паролю. Сессионная часть (cookie,
// серверный sessions-store) обрабатывается отдельным модулем sessions.ts.

export type LoginResult = {
  userId: string
  mustChange: boolean
  user: Pick<User, 'id' | 'displayName' | 'email' | 'provider' | 'roles'>
}

// Фиксированный реальный Argon2-хеш для маскировки несуществующего
// пользователя. Параметры совпадают с актуальными ARGON2_OPTIONS, чтобы
// время верификации не отличалось от обычного пути.
const SENTINEL_HASH = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$pH4cZj6KQQqYHCnP9NjmpRZjLZdcZjNQKlS0bC0wZRk'

function normUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export async function loginLocal(rawUsername: string, password: string): Promise<LoginResult> {
  const username = normUsername(rawUsername)
  const rows = await db
    .select({
      userId: localCredentials.userId,
      username: localCredentials.username,
      passwordHash: localCredentials.passwordHash,
      failedAttempts: localCredentials.failedAttempts,
      lockedUntil: localCredentials.lockedUntil,
      mustChange: localCredentials.mustChange,
    })
    .from(localCredentials)
    .where(eq(localCredentials.username, username))
    .limit(1)

  const now = new Date()
  const row = rows[0]

  if (!row) {
    // Маскируем отсутствие пользователя константным временем (verify по
    // sentinel-хешу с такими же параметрами Argon2id).
    await verifyPassword(password, SENTINEL_HASH).catch(() => null)
    await auditLog$(null, 'auth.local.login.failure', 'user', username, { reason: 'unknown_user' })
    throw appError('unauthenticated', 'Invalid credentials')
  }

  if (row.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
    await auditLog$(row.userId, 'auth.local.login.failure', 'user', row.userId, { reason: 'locked', lockedUntil: row.lockedUntil })
    throw appError('forbidden', 'Account temporarily locked')
  }

  // Если lockedUntil уже истёк, эффективный счётчик обнуляется — иначе после
  // следующей ошибки backoff удвоится от старого числа и заблокирует на час
  // даже законного пользователя.
  const effectiveAttempts = row.lockedUntil && row.lockedUntil.getTime() <= now.getTime() ? 0 : row.failedAttempts

  const verifyResult = await verifyPassword(password, row.passwordHash).catch(() => ({ ok: false, needsRehash: false }))

  if (!verifyResult.ok) {
    // Атомарный инкремент: исключаем race-condition при параллельных попытках.
    const updated = await db
      .update(localCredentials)
      .set({
        failedAttempts: sql`${localCredentials.failedAttempts} + 1`,
        updatedAt: now,
      })
      .where(eq(localCredentials.userId, row.userId))
      .returning({ failedAttempts: localCredentials.failedAttempts })
    const nextAttempts = updated[0]?.failedAttempts ?? effectiveAttempts + 1
    const lockUntil = computeLockoutUntil(nextAttempts, now)
    if (lockUntil) {
      await db
        .update(localCredentials)
        .set({ lockedUntil: lockUntil })
        .where(eq(localCredentials.userId, row.userId))
    }
    await auditLog$(row.userId, 'auth.local.login.failure', 'user', row.userId, { attempts: nextAttempts })
    throw appError('unauthenticated', 'Invalid credentials')
  }

  const userRows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      provider: users.provider,
      roles: users.roles,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(and(eq(users.id, row.userId), isNull(users.disabledAt)))
    .limit(1)

  const userRow = userRows[0]
  if (!userRow) {
    await auditLog$(row.userId, 'auth.local.login.failure', 'user', row.userId, { reason: 'disabled' })
    throw appError('forbidden', 'Account disabled')
  }

  // Успех: сбросить счётчики, обновить last_login, при необходимости — re-hash.
  // Делаем в одной транзакции с audit-записью.
  const nextHash = verifyResult.needsRehash ? await hashPassword(password) : null
  await db.transaction(async (tx) => {
    const set: Partial<typeof localCredentials.$inferInsert> = {
      failedAttempts: 0,
      lockedUntil: null,
      lastLoginAt: now,
      updatedAt: now,
    }
    if (nextHash) set.passwordHash = nextHash
    await tx.update(localCredentials).set(set).where(eq(localCredentials.userId, row.userId))
    await tx.insert(auditLog).values({
      userId: row.userId,
      action: 'auth.local.login.success',
      targetKind: 'user',
      targetId: row.userId,
      payload: null,
    })
  })

  return {
    userId: row.userId,
    mustChange: row.mustChange === 1,
    user: {
      id: userRow.id,
      displayName: userRow.displayName,
      email: userRow.email,
      provider: userRow.provider,
      roles: userRow.roles,
    },
  }
}

export async function changeLocalPassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const rows = await db
    .select({ passwordHash: localCredentials.passwordHash })
    .from(localCredentials)
    .where(eq(localCredentials.userId, userId))
    .limit(1)
  const row = rows[0]
  if (!row) throw appError('not_found', 'No local credentials for this user')
  const result = await verifyPassword(currentPassword, row.passwordHash).catch(() => ({ ok: false, needsRehash: false }))
  if (!result.ok) throw appError('unauthenticated', 'Current password is wrong')

  assertPasswordStrength(newPassword)
  const newHash = await hashPassword(newPassword)
  await db.transaction(async (tx) => {
    await tx
      .update(localCredentials)
      .set({ passwordHash: newHash, mustChange: 0, updatedAt: new Date() })
      .where(eq(localCredentials.userId, userId))
    await tx.insert(auditLog).values({
      userId,
      action: 'auth.local.password_changed',
      targetKind: 'user',
      targetId: userId,
      payload: null,
    })
  })
}

async function auditLog$(
  userId: string | null,
  action: string,
  targetKind: string,
  targetId: string,
  payload: unknown,
): Promise<void> {
  await db.insert(auditLog).values({ userId, action, targetKind, targetId, payload: payload as never })
}
