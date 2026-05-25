import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { issues } from './issues'
import { syncStateEnum } from './enums'
import type { Adf } from './issues'

// Комментарии к issue. Тело хранится в ADF для round-trip с Jira.
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id'),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull(),
    body: jsonb('body').$type<Adf>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    syncState: syncStateEnum('sync_state').notNull().default('synced'),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('comments_jira_id_uq').on(t.jiraId),
    issueIdx: index('comments_issue_idx').on(t.issueId),
  }),
)
