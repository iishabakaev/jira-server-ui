import {
  pgTable,
  uuid,
  text,
  bigint,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { issues } from './issues'

// Вложения. По умолчанию ходим в Jira за байтами через прокси-роут;
// `localPath` используется, если когда-нибудь начнём кешировать файлы.
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id').notNull(),
    issueId: uuid('issue_id')
      .notNull()
      .references(() => issues.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mimeType: text('mime_type'),
    size: bigint('size', { mode: 'number' }),
    authorId: text('author_id'),
    /** URL загрузки на стороне Jira. Проксируем через /api/issues/:k/attachments/:id. */
    contentUrl: text('content_url').notNull(),
    /** Опциональный путь локального кеша на ФС, если когда-нибудь зеркалим байты. */
    localPath: text('local_path'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('attachments_jira_id_uq').on(t.jiraId),
    issueIdx: index('attachments_issue_idx').on(t.issueId),
  }),
)
