import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { projects } from './projects'

// Типы issue в Jira. Глобальны, общие для всех проектов (семантика Jira Server).
export const issueTypes = pgTable(
  'issue_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id').notNull(),
    name: text('name').notNull(),
    iconUrl: text('icon_url'),
    subtask: boolean('subtask').notNull().default(false),
    /** Ссылка на схему workflow + schema экранов; используется планировщиком транзишенов. */
    metadata: jsonb('metadata').notNull().default({}),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('issue_types_jira_id_uq').on(t.jiraId),
    nameIdx: index('issue_types_name_idx').on(t.name),
  }),
)

/**
 * Статусы workflow. В реальной инстансе одинаковое имя статуса часто
 * переиспользуется в разных workflow с одним и тем же id. Ключ — `jiraId`.
 */
export const statuses = pgTable(
  'statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id').notNull(),
    name: text('name').notNull(),
    /** statusCategory.key: 'new' | 'indeterminate' | 'done' */
    category: text('category').notNull(),
    colorName: text('color_name'),
    description: text('description'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('statuses_jira_id_uq').on(t.jiraId),
    nameIdx: index('statuses_name_idx').on(t.name),
  }),
)

export const priorities = pgTable(
  'priorities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id').notNull(),
    name: text('name').notNull(),
    iconUrl: text('icon_url'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('priorities_jira_id_uq').on(t.jiraId),
  }),
)

export const resolutions = pgTable(
  'resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('resolutions_jira_id_uq').on(t.jiraId),
  }),
)

export const linkTypes = pgTable(
  'link_types',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id').notNull(),
    name: text('name').notNull(),
    inward: text('inward').notNull(),
    outward: text('outward').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('link_types_jira_id_uq').on(t.jiraId),
  }),
)

/**
 * Схема полей в разрезе (project, issueType). Используется редактором
 * issue и модалкой перехода (для обязательных полей конкретного транзишена).
 */
export interface FieldDef {
  key: string                   // например, 'assignee' или 'customfield_67470'
  name: string                  // человекочитаемое имя, может быть локализовано
  schema: {
    type: string                // 'string' | 'number' | 'date' | 'option' | 'array' | 'user' | 'any'
    items?: string
    custom?: string
    customId?: number
    system?: string
  }
  required: boolean
  hasDefaultValue?: boolean
  allowedValues?: Array<{ id: string; value?: string; name?: string }>
  operations?: string[]
  /** Где поле используется в нашем UI. */
  surface?: Array<'editor' | 'create' | 'transition'>
  /** Подсказка по порядку (меньше — раньше). */
  order?: number
  /** Полностью скрыть поле. */
  hidden?: boolean
}

export const fieldSchemas = pgTable(
  'field_schemas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    issueTypeId: uuid('issue_type_id')
      .notNull()
      .references(() => issueTypes.id, { onDelete: 'cascade' }),
    fields: jsonb('fields').$type<FieldDef[]>().notNull().default([]),
    /** Хеш ответа Jira /createmeta — используется для детектирования дрейфа. */
    upstreamHash: text('upstream_hash'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIssueTypeUq: uniqueIndex('field_schemas_project_issuetype_uq').on(
      t.projectId,
      t.issueTypeId,
    ),
  }),
)
