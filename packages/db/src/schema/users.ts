import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { userRoleEnum, authProviderEnum } from './enums'

// Учётная запись пользователя. Провайдер-агностично: Keycloak и local
// сводятся к одной и той же строке `users`; различаются по `provider`.
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Идентификатор у внешнего провайдера. Для Keycloak — OIDC `sub`. Для local — копия users.id. */
    externalSub: text('external_sub').notNull(),
    /** Какой провайдер выпустил externalSub. */
    provider: authProviderEnum('provider').notNull(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    /** Роли. Всегда содержит 'user'. */
    roles: userRoleEnum('roles')
      .array()
      .notNull()
      .default(sql`'{user}'::user_role[]`),
    jiraAccountId: text('jira_account_id'),
    /** В Jira Server каноническим идентификатором пользователя является `name` (userKey). */
    jiraUserKey: text('jira_user_key'),
    avatarUrl: text('avatar_url'),
    /** Если задано — пользователь заблокирован и не может войти. */
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    /** Часы в неделю для оверлея capacity на таймлайне. */
    capacityHoursPerWeek: text('capacity_hours_per_week'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    providerSubUq: index('users_provider_sub_uq').on(t.provider, t.externalSub),
    emailIdx: index('users_email_idx').on(t.email),
    jiraAccountIdx: index('users_jira_account_idx').on(t.jiraAccountId),
  }),
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
