import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { issues } from './issues'
import { syncStateEnum } from './enums'

// Worklog'и. Используются в оверлее capacity на таймлайне.
export const worklogs = pgTable(
  'worklogs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id'),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    authorId: text('author_id').notNull(),
    seconds: integer('seconds').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    comment: text('comment'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
    syncState: syncStateEnum('sync_state').notNull().default('synced'),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('worklogs_jira_id_uq').on(t.jiraId),
    issueIdx: index('worklogs_issue_idx').on(t.issueId),
    authorStartedIdx: index('worklogs_author_started_idx').on(t.authorId, t.startedAt),
  }),
)
