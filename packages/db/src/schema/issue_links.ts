import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { issues } from './issues'
import { linkTypes } from './metadata'

// Связи между issue. Используются таймлайном для рисования зависимостей.
export const issueLinks = pgTable(
  'issue_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id'),
    linkTypeId: uuid('link_type_id')
      .notNull()
      .references(() => linkTypes.id),
    sourceIssueId: uuid('source_issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    targetIssueId: uuid('target_issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(), // 'inward' | 'outward'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: uniqueIndex('issue_links_uq').on(
      t.linkTypeId,
      t.sourceIssueId,
      t.targetIssueId,
      t.direction,
    ),
    sourceIdx: index('issue_links_source_idx').on(t.sourceIssueId),
    targetIdx: index('issue_links_target_idx').on(t.targetIssueId),
  }),
)
