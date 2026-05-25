import {
  pgTable,
  bigserial,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'

// Аудит-лог: одна строка на значимое действие. Срок хранения — 1 год.
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    actionIdx: index('audit_log_action_idx').on(t.action),
    targetIdx: index('audit_log_target_idx').on(t.targetKind, t.targetId),
    createdIdx: index('audit_log_created_idx').on(t.createdAt),
  }),
)
