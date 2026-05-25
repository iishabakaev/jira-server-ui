import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

/**
 * Проекты Jira, зеркалированные локально. В `metadata` хранится карта
 * customfield_<id> → промотированное имя плюс прочая конфигурация уровня
 * проекта, которую мы не выносим в отдельные колонки.
 *
 * Наблюдаемый пример (ALFAIAAS, Jira Server 9.12.19):
 *   - key: ALFAIAAS, projectTypeKey: software
 *   - 28 типов issue, включая bespoke: "Process task", "Change task",
 *     "TechDebt", "archDEBT", "Дефект промсреды".
 *   - Дефолтный kanban-board id 73355 ранжирует по customfield_11582.
 *
 * См. docs/specs/13-jira-reality.md.
 */
export interface ProjectMetadata {
  /** Карта customfield_<id> → промотированное имя колонки или доменный лейбл. */
  customfieldMap: Record<string, string>
  /** Резолвленные id промотированных полей, используются API и UI. */
  promoted: {
    rank?: string
    storyPoints?: string
    sprint?: string
    epicLink?: string
    epicName?: string
    acceptanceCriteria?: string
  }
  /** Дефолтный board id для страницы кanban. */
  defaultBoardId?: number
  /** Переопределение окна синхронизации в днях. */
  syncWindowDays?: number
  /** Если явно false — инкрементальный fan-out пропускает проект. Undefined = включён по умолчанию. */
  syncEnabled?: boolean
  /** Переопределения видимости полей по типу issue (см. workflow.ts для gate'ов транзишенов). */
  fieldVisibility?: Record<string, Array<{ field: string; show: boolean }>>
}

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraId: text('jira_id').notNull(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    projectTypeKey: text('project_type_key'),
    leadAccountId: text('lead_account_id'),
    metadata: jsonb('metadata').$type<ProjectMetadata>().notNull().default({
      customfieldMap: {},
      promoted: {},
    } satisfies ProjectMetadata),
    etag: text('etag'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    jiraIdUq: uniqueIndex('projects_jira_id_uq').on(t.jiraId),
    keyUq: uniqueIndex('projects_key_uq').on(t.key),
    nameIdx: index('projects_name_idx').on(t.name),
  }),
)

export type Project = typeof projects.$inferSelect
