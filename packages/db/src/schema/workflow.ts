import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { issues } from './issues'
import { issueTypes, statuses } from './metadata'
import {
  workflowPlanStateEnum,
  workflowStepStateEnum,
} from './enums'

/**
 * Кеш транзишенов в разрезе исходного статуса. Наполняется задачей
 * `refresh-workflow-meta`. Планировщик ищет путь "текущий → целевой статус"
 * без обращения в Jira за каждым кандидатом.
 *
 * Уникальность строки: (issue_type_id, from_status_id, to_status_id).
 */
export interface TransitionFieldRequirement {
  field: string                // 'resolution' | 'customfield_67470' | ...
  name: string
  required: boolean
  schemaType: string
  allowedValues?: Array<{ id: string; value?: string; name?: string }>
}

export const transitions = pgTable(
  'transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueTypeId: uuid('issue_type_id')
      .notNull()
      .references(() => issueTypes.id, { onDelete: 'cascade' }),
    fromStatusId: uuid('from_status_id')
      .notNull()
      .references(() => statuses.id),
    toStatusId: uuid('to_status_id')
      .notNull()
      .references(() => statuses.id),
    jiraTransitionId: text('jira_transition_id').notNull(),
    name: text('name').notNull(),
    requiredFields: jsonb('required_fields')
      .$type<TransitionFieldRequirement[]>()
      .notNull()
      .default([]),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: uniqueIndex('transitions_uq').on(t.issueTypeId, t.fromStatusId, t.toStatusId),
    fromIdx: index('transitions_from_idx').on(t.issueTypeId, t.fromStatusId),
  }),
)

/**
 * План смены статуса — намерение пользователя перевести issue из текущего
 * статуса в целевой через последовательность Jira-транзишенов, исполняемую
 * фоном.
 *
 * Жизненный цикл: draft → queued → running → done | failed | paused
 *
 * Шаги вычисляются BFS по кешу `transitions`. Каждый шаг несёт значения
 * полей, требуемых конкретно для этого транзишена.
 *
 * См. docs/specs/14-workflow-engine.md.
 */
export interface WorkflowPlanContext {
  /** Заранее собранные значения полей, ключ — индекс шага. */
  fieldValuesByStep: Record<number, Record<string, unknown>>
  /** Опциональный комментарий после цепочки. */
  finalComment?: string
  /** Исходный целевой статус (фиксируем для аудита, если цепочка поменяется). */
  targetStatusName: string
}

export const workflowPlans = pgTable(
  'workflow_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    fromStatusId: uuid('from_status_id').notNull(),
    toStatusId: uuid('to_status_id').notNull(),
    state: workflowPlanStateEnum('state').notNull().default('draft'),
    context: jsonb('context').$type<WorkflowPlanContext>().notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    issueIdx: index('workflow_plans_issue_idx').on(t.issueId),
    stateIdx: index('workflow_plans_state_idx').on(t.state),
    userIdx: index('workflow_plans_user_idx').on(t.userId),
  }),
)

/**
 * Один шаг плана. Воркер продвигает их по очереди; в строке зафиксирован
 * выбранный на момент планирования jira-transition id (если workflow
 * поменяется во время исполнения — увидим расхождение).
 */
export const workflowSteps = pgTable(
  'workflow_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => workflowPlans.id, { onDelete: 'cascade' }),
    /** 0-индексированная позиция в плане. */
    seq: integer('seq').notNull(),
    fromStatusId: uuid('from_status_id').notNull(),
    toStatusId: uuid('to_status_id').notNull(),
    jiraTransitionId: text('jira_transition_id').notNull(),
    /** Значения полей, применяемые на этом транзишене. */
    fieldValues: jsonb('field_values').notNull().default({}),
    state: workflowStepStateEnum('state').notNull().default('pending'),
    /** Idempotency-ключ соответствующей outbox-строки — для трассировки. */
    outboxKey: text('outbox_key'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({
    planSeqUq: uniqueIndex('workflow_steps_plan_seq_uq').on(t.planId, t.seq),
    stateIdx: index('workflow_steps_state_idx').on(t.state),
  }),
)
