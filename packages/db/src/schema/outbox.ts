import {
  pgTable,
  bigserial,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { users } from './users'
import { outboxStateEnum } from './enums'

/**
 * Транзакционный outbox — ЕДИНСТВЕННЫЙ способ постановить мутацию в Jira
 * на отправку.
 *
 * Каждый mutation-роут сервера пишет локальное изменение в БД и в этой же
 * транзакции добавляет строку сюда. Воркер дренирует таблицу и шлёт в Jira
 * REST с ретраями.
 *
 * `requires` — массив идемпотентных ключей, которых должна дождаться эта
 * строка перед отправкой. Используется для упорядоченных цепочек
 * "родитель прежде ребёнка" (создать эпик, потом таск со ссылкой на него).
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'issue.update' | 'issue.transition' | 'issue.create' | 'comment.create' | ...
    targetKind: text('target_kind').notNull(),
    targetId: uuid('target_id').notNull(),
    payload: jsonb('payload').notNull(),
    /** OpenTelemetry traceparent на момент мутации — для сквозной трассировки. */
    traceparent: text('traceparent'),
    /** Idempotency-ключи, которых ждём перед отправкой. */
    requires: text('requires').array().notNull().default(sql`'{}'::text[]`),
    attempts: integer('attempts').notNull().default(0),
    state: outboxStateEnum('state').notNull().default('pending'),
    lastError: text('last_error'),
    lockedBy: text('locked_by'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    idemUq: uniqueIndex('outbox_idempotency_uq').on(t.idempotencyKey),
    pendingIdx: index('outbox_pending_idx').on(t.createdAt),
    targetIdx: index('outbox_target_idx').on(t.targetKind, t.targetId),
    stateIdx: index('outbox_state_idx').on(t.state),
  }),
)

export type OutboxEvent = typeof outboxEvents.$inferSelect
