import {
  pgTable,
  uuid,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { boards } from './boards'

/**
 * Сохранённые kanban-views: стабильное имя + URL-параметры, которые
 * восстанавливают вид доски. Shared-views видят все пользователи,
 * у которых есть доступ к борду.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    boardId: uuid('board_id')
      .notNull()
      .references(() => boards.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    shared: boolean('shared').notNull().default(false),
    /** TypeBox-схема search-параметров (см. features/kanban/store.ts в apps/web). */
    search: jsonb('search').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    boardOwnerIdx: index('saved_views_board_owner_idx').on(t.boardId, t.ownerId),
    sharedIdx: index('saved_views_shared_idx').on(t.boardId, t.shared),
  }),
)
