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
import { projects } from './projects'

// Колонка борда: имя + список jira-id статусов, попадающих в неё.
export interface BoardColumn {
  name: string
  statusIds: string[]    // Jira status id'ы, привязанные к этой колонке
  /** Локальный WIP-limit; никогда не пишется обратно в Jira. */
  wipLimit?: number
}

export interface BoardConfig {
  /** Колонки agile-board'а и привязка статусов. */
  columns: BoardColumn[]
  /** customfield id для ранжирования. В ALFAIAAS — 11582. */
  rankCustomFieldId?: string
  /** JQL под-фильтр борда; хранится для контекста, наши чтения через него не идут. */
  subQuery?: string
  /** Дефолты сохранённой view (density, group, layout). */
  defaults?: Record<string, unknown>
}

// Кanban / scrum board, зеркалированный из Jira. Один POST в /rest/agile/1.0
// при первичной синхронизации; дальше читаем только локально.
export const boards = pgTable(
  'boards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: integer('jira_id').notNull(),
    name: text('name').notNull(),
    /** 'kanban' | 'scrum' */
    type: text('type').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    /** Фильтр-JQL борда наверху по Jira. */
    filterJql: text('filter_jql'),
    config: jsonb('config').$type<BoardConfig>().notNull().default({ columns: [] } satisfies BoardConfig),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('boards_jira_id_uq').on(t.jiraId),
    projectIdx: index('boards_project_idx').on(t.projectId),
  }),
)

export type Board = typeof boards.$inferSelect
