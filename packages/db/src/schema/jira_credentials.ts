import {
  pgTable,
  uuid,
  text,
  timestamp,
  customType,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { jiraCredentialKindEnum } from './enums'

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

/**
 * Зашифрованные креды Jira на пользователя. Схема envelope-шифрования
 * AES-GCM: `JIRA_PAT_KEK` (env) расшифровывает per-user DEK; DEK уже
 * расшифровывает `ciphertext`. См. docs/specs/03-auth.md.
 *
 * `kind=pat`   — Personal Access Token Jira Server.
 * `kind=oauth` — будущий путь Atlassian OAuth (json-упакованные токены).
 */
export const jiraCredentials = pgTable(
  'jira_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: jiraCredentialKindEnum('kind').notNull(),
    ciphertext: bytea('ciphertext').notNull(),
    iv: bytea('iv').notNull(),
    tag: bytea('tag').notNull(),
    /** Идентификатор KEK, которым обёрнут DEK; поддерживает ротацию KEK. */
    kekKid: text('kek_kid').notNull(),
    /** Отображаемое имя из /myself; нужно только для UI и аудита. */
    jiraDisplayName: text('jira_display_name'),
    /** Установлено, если validate-вызов вернул 401/403 — UI попросит переподключить. */
    needsReattach: text('needs_reattach'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userKindUq: uniqueIndex('jira_credentials_user_kind_uq').on(t.userId, t.kind),
  }),
)

export type JiraCredential = typeof jiraCredentials.$inferSelect
