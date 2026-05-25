import { db, userSessions } from '@db'
import { eq, and, isNull, gt, sql } from 'drizzle-orm'
import { isValidSessionId } from '../../lib/request'

// Серверная сессия. Лежит в Postgres (см. docs/specs/03-auth.md), общая
// для local- и keycloak-провайдеров. ID сессии хранится в HttpOnly-cookie;
// сама запись — единственный источник истины. Cookie без записи невалидна.

// TTL по умолчанию. Idle-TTL применяется при каждом hit-е сессии,
// absolute-TTL ставится в момент создания и не продлевается.
export const IDLE_TTL_MS = 8 * 60 * 60 * 1000      // 8 часов
export const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000  // 30 дней

export interface SessionRecord {
  id: string
  userId: string
  expiresAt: Date
}

export interface CreateSessionInput {
  userId: string
  ip?: string | null
  userAgent?: string | null
}

// Создаёт сессию для пользователя. Возвращает id — он же значение cookie.
// Поле expiresAt — момент истечения idle-TTL; absolute-TTL контролируем при
// каждом обновлении (touch).
export async function createSession(input: CreateSessionInput): Promise<SessionRecord> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + IDLE_TTL_MS)
  // Схема user_sessions.id — uuid; используем стандартный v4 (≥ 122 бит энтропии),
  // что эквивалентно ранее задуманному 256-битному токену с точки зрения
  // невозможности перебора, но совместимо с pgtable.uuid().
  const sessionId = crypto.randomUUID()
  await db.insert(userSessions).values({
    id: sessionId,
    userId: input.userId,
    expiresAt,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  })
  return { id: sessionId, userId: input.userId, expiresAt }
}

// Возвращает активную сессию или null. Истёкшие и отозванные не возвращаются.
// При успешном hit-е продлеваем idle-TTL до 8 часов вперёд.
export async function loadSession(sessionId: string): Promise<SessionRecord | null> {
  if (!isValidSessionId(sessionId)) return null
  const now = new Date()
  const rows = await db
    .select({
      id: userSessions.id,
      userId: userSessions.userId,
      expiresAt: userSessions.expiresAt,
      createdAt: userSessions.createdAt,
      revokedAt: userSessions.revokedAt,
    })
    .from(userSessions)
    .where(
      and(
        eq(userSessions.id, sessionId),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
      ),
    )
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const absoluteCap = new Date(row.createdAt.getTime() + ABSOLUTE_TTL_MS)
  if (absoluteCap.getTime() <= now.getTime()) {
    // Сессия дольше абсолютного лимита — отзываем явно, иначе она бы протухла
    // только по idle-TTL.
    await db
      .update(userSessions)
      .set({ revokedAt: now })
      .where(eq(userSessions.id, sessionId))
    return null
  }

  const nextExpiry = new Date(Math.min(now.getTime() + IDLE_TTL_MS, absoluteCap.getTime()))
  await db
    .update(userSessions)
    .set({ expiresAt: nextExpiry })
    .where(eq(userSessions.id, sessionId))

  return { id: row.id, userId: row.userId, expiresAt: nextExpiry }
}

// Отзывает сессию (logout). Идемпотентно — повторный вызов не создаёт ошибок.
export async function revokeSession(sessionId: string): Promise<void> {
  if (!sessionId) return
  await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.id, sessionId), isNull(userSessions.revokedAt)))
}

// Отзывает все активные сессии пользователя (например, после disable).
export async function revokeAllForUser(userId: string): Promise<number> {
  const revoked = await db
    .update(userSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .returning({ id: userSessions.id })
  return revoked.length
}

// Очистка просроченных и отозванных сессий старше 90 дней. Можно дёргать из
// cron-таски pg-boss; здесь — функция, чтобы её можно было вызвать и из CLI.
export async function purgeExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const deleted = await db.execute<{ count: number }>(
    sql`with d as (delete from user_sessions where expires_at < ${cutoff} or revoked_at < ${cutoff} returning 1) select count(*)::int as count from d`,
  )
  const rows = deleted as unknown as Array<{ count: number }>
  return rows[0]?.count ?? 0
}
