import {
  pgTable,
  uuid,
  text,
  timestamp,
  customType,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// Сырой тип bytea для шифротекстов и IV.
const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

// Серверная сессия. Идентичная между провайдерами (keycloak/local) —
// потребители сессии не знают, как именно пользователь аутентифицировался.
export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    /** Keycloak refresh-token, зашифрован AES-GCM ключом сессионного KEK. Для local — null. */
    refreshTokenEnc: bytea('refresh_token_enc'),
    refreshTokenIv: bytea('refresh_token_iv'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** Метка отзыва; строка ещё какое-то время хранится для аудита. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    userIdx: index('user_sessions_user_idx').on(t.userId),
    expiresIdx: index('user_sessions_expires_idx').on(t.expiresAt),
  }),
)

export type UserSession = typeof userSessions.$inferSelect
