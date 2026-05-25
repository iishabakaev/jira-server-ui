import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// Конфликты записи: Jira-сторона изменила то же, что и мы. Разрешаются
// руками — "Keep mine" / "Keep Jira" / "Merge" (см. 10-realtime-and-status.md).
export const conflicts = pgTable(
  'conflicts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    targetKind: text('target_kind').notNull(),
    targetId: uuid('target_id').notNull(),
    /** Диф по полям: { fieldKey: { local, remote, base } }. */
    diff: jsonb('diff').notNull(),
    /** Снэпшот outbox-payload, который привёл к конфликту. */
    outboxPayload: jsonb('outbox_payload'),
    /** Снэпшот авторитетных значений Jira на момент конфликта. */
    remoteSnapshot: jsonb('remote_snapshot'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolution: text('resolution'), // 'keep_local' | 'keep_remote' | 'merge'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    targetIdx: index('conflicts_target_idx').on(t.targetKind, t.targetId),
    unresolvedIdx: index('conflicts_unresolved_idx').on(t.createdAt),
  }),
)
