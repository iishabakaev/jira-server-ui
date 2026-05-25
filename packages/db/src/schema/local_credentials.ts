import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

/**
 * Учётные данные локальных аккаунтов (логин/пароль).
 * Используются, когда Keycloak недоступен, для bootstrap-админа и QA,
 * а также как break-glass путь.
 *
 * Аккаунты создаются CLI: `bun run cli users add`.
 * Самостоятельная регистрация выключена по умолчанию (флаг
 * `LOCAL_AUTH_ALLOW_SIGNUP=1` включает её).
 *
 * Формат хеша: Argon2id. В `passwordHash` лежит полная строка вида
 * `$argon2id$v=19$m=...$t=...$p=...$<salt>$<hash>`, чтобы можно было
 * менять параметры без миграции схемы.
 */
export const localCredentials = pgTable(
  'local_credentials',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Подряд идущие неудачные попытки. Сбрасывается после успешного входа. */
    failedAttempts: integer('failed_attempts').notNull().default(0),
    /** До какого времени аккаунт заблокирован (скользящее окно с экспоненциальным backoff). */
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** При следующем входе потребовать смену пароля. */
    mustChange: integer('must_change').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => ({
    usernameUq: index('local_credentials_username_uq').on(t.username),
  }),
)

export type LocalCredential = typeof localCredentials.$inferSelect
