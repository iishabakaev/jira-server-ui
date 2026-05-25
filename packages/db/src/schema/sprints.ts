import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { boards } from './boards'

// Спринты. Первичный список получаем через /rest/agile/1.0 один раз,
// дальше обновляем по webhook'ам и по sprint-customfield на issue.
export const sprints = pgTable(
  'sprints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: integer('jira_id').notNull(),
    name: text('name').notNull(),
    /** 'future' | 'active' | 'closed' */
    state: text('state').notNull(),
    startDate: timestamp('start_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    completeDate: timestamp('complete_date', { withTimezone: true }),
    boardId: uuid('board_id').references(() => boards.id, { onDelete: 'set null' }),
    goal: text('goal'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('sprints_jira_id_uq').on(t.jiraId),
    boardIdx: index('sprints_board_idx').on(t.boardId),
    stateIdx: index('sprints_state_idx').on(t.state),
  }),
)
