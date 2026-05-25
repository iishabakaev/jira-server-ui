import {
  pgTable,
  uuid,
  text,
  bigserial,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { projects } from './projects'

// Курсор инкрементальной синхронизации (`updated >= last_updated_at`)
// в разрезе проекта.
export const syncCursor = pgTable('sync_cursor', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }),
  lastFullSyncAt: timestamp('last_full_sync_at', { withTimezone: true }),
  lastRunId: text('last_run_id'),
  /** Переопределение окна (например, `updated >= -365d`). */
  windowJql: text('window_jql'),
})

/**
 * Сырые входящие webhook'и. Отвязан от обработки, чтобы POST всегда был
 * быстрым (200 OK). Воркер дренирует и применяет через нормализатор.
 */
export const webhookInbox = pgTable(
  'webhook_inbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(), // 'jira:issue_updated' и т.д.
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
    /** Счётчик неудачных попыток применить запись. После MAX worker помечает
     *  processed_at, чтобы строка не зацикливала повторные лизы. */
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => ({
    unprocessedIdx: index('webhook_inbox_unprocessed_idx').on(t.receivedAt),
  }),
)
