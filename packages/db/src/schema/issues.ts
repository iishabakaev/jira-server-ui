import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  bigint,
  integer,
  numeric,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { projects } from './projects'
import { issueTypes, statuses, priorities, resolutions } from './metadata'
import { sprints } from './sprints'
import { syncStateEnum } from './enums'

/** Atlassian Document Format (ADF). Храним как есть — для round-trip с Jira. */
export type Adf = { type: 'doc'; version: number; content: unknown[] }

/**
 * Issue — центральная зеркалируемая сущность. Часть кастомных полей
 * промотируется в типизированные колонки (story_points, sprint, epic_*)
 * по карте `projects.metadata.promoted`; всё остальное — в JSONB
 * `custom_fields`.
 *
 * Наблюдаемые id customfield в ALFAIAAS (используются как дефолты,
 * фактический id резолвится через карту в проекте):
 *   - story_points         customfield_10372
 *   - sprint               customfield_10375
 *   - epic_link            customfield_10376
 *   - epic_name            customfield_10377
 *   - rank (актуальный)    customfield_11582
 *   - rank (legacy)        customfield_10374 ('Rank (Obsolete)')
 *   - acceptance criteria  customfield_31172 или 12074 (зависит от проекта)
 */
export const issues = pgTable(
  'issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id').notNull(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    summary: text('summary').notNull(),
    /** Плоский текст из `description` для FTS и быстрых текстовых фильтров. */
    descriptionText: text('description_text'),
    description: jsonb('description').$type<Adf | null>(),
    issueTypeId: uuid('issue_type_id')
      .notNull()
      .references(() => issueTypes.id),
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id),
    priorityId: uuid('priority_id').references(() => priorities.id),
    resolutionId: uuid('resolution_id').references(() => resolutions.id),
    reporterId: text('reporter_id'),
    assigneeId: text('assignee_id'),
    /** Для сабтасков — родительский ключ. Для тасков — null (epic через epic_jira_id). */
    parentJiraId: text('parent_jira_id'),
    /** Денормализация эпика для быстрых kanban-группировок. Обновляется webhook'ом и sync'ом. */
    epicJiraId: text('epic_jira_id'),
    sprintId: uuid('sprint_id').references(() => sprints.id),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
    components: text('components').array().notNull().default(sql`'{}'::text[]`),
    fixVersions: text('fix_versions').array().notNull().default(sql`'{}'::text[]`),
    dueDate: date('due_date'),
    startDate: date('start_date'),
    storyPoints: numeric('story_points', { precision: 6, scale: 2 }),
    timeEstimateS: integer('time_estimate_s'),
    timeSpentS: integer('time_spent_s'),
    /** Все непромотированные кастом-поля, ключ — id из Jira ('customfield_xxxxx'). */
    customFields: jsonb('custom_fields').notNull().default({}),
    /** LexoRank-подобная строка из Jira (rank custom field проекта) или локальная. */
    orderingRank: text('ordering_rank'),
    /** Монотонный insertion order — стабильная вторичная сортировка. */
    positionIdx: bigint('position_idx', { mode: 'number' }),
    etag: text('etag'),
    jiraUpdatedAt: timestamp('jira_updated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    syncState: syncStateEnum('sync_state').notNull().default('synced'),
    syncError: text('sync_error'),
    /** Маркер soft-delete; webhook'и могут сообщать об удалении. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('issues_jira_id_uq').on(t.jiraId),
    keyUq: uniqueIndex('issues_key_uq').on(t.key),
    projectStatusIdx: index('issues_project_status_idx').on(t.projectId, t.statusId),
    assigneeIdx: index('issues_assignee_idx').on(t.assigneeId),
    epicIdx: index('issues_epic_idx').on(t.epicJiraId),
    parentIdx: index('issues_parent_idx').on(t.parentJiraId),
    sprintIdx: index('issues_sprint_idx').on(t.sprintId),
    updatedIdx: index('issues_updated_at_idx').on(t.jiraUpdatedAt),
    syncStateIdx: index('issues_sync_state_idx').on(t.syncState),
    labelsGin: index('issues_labels_gin').using('gin', t.labels),
    componentsGin: index('issues_components_gin').using('gin', t.components),
    customFieldsGin: index('issues_custom_fields_gin')
      .using('gin', sql`${t.customFields} jsonb_path_ops`),
  }),
)

export type Issue = typeof issues.$inferSelect
export type NewIssue = typeof issues.$inferInsert
