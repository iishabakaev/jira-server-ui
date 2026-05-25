import { t } from 'elysia'
import { GroupBy, IssueFilter, IssueSummary, StatusCategory } from '../issues/schema'

// Контракт projects-модуля. В отличие от boards: проект — это единица,
// которую пользователь выбирает в фуззи-поиске; колонки kanban строятся
// нашим UI поверх statuses, а не на board.config из Jira.

export const ProjectListItem = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  name: t.String(),
  // Маркер свежести: время последнего incremental-sync. null — проект
  // зеркалирован, но full-sync ещё не прошёл.
  lastUpdatedAt: t.Union([t.String(), t.Null()]),
  lastFullSyncAt: t.Union([t.String(), t.Null()]),
})

export const ProjectListResponse = t.Object({
  items: t.Array(ProjectListItem),
})

// Issue-type, доступный для quick-create на этом проекте. Источник правды —
// field_schemas (только пары (project, issueType) с закешированной createmeta).
export const ProjectAvailableIssueType = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  iconUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]),
})

export const ProjectDetail = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  name: t.String(),
  availableIssueTypes: t.Array(ProjectAvailableIssueType),
})

// Колонка нашего kanban'а. Не имеет wipLimit (управляется UI-only пресетом
// в будущем M8), groupId — стабильный токен (uuid статуса/ассайни/спринта
// или null для «Unassigned/No epic/...»).
export const ProjectKanbanColumn = t.Object({
  name: t.String(),
  groupId: t.Union([t.String(), t.Null()]),
  // Для groupBy=status — uuid статуса колонки. Для остальных группировок
  // — пусто; DnD меняет ассайни/спринт через отдельные мутации (вне scope M5).
  statusIds: t.Array(t.String({ format: 'uuid' })),
  // Лейбл категории для подсветки колонок (new/indeterminate/done).
  // null — для groupBy ≠ status.
  statusCategory: t.Union([StatusCategory, t.Null()]),
  count: t.Integer(),
  items: t.Array(IssueSummary),
})

// Параметры запроса: те же, что у board kanban, но без projectIds (он в path)
// и без boardId (его больше нет в этом потоке).
export const ProjectKanbanQuery = t.Omit(IssueFilter, ['projectIds', 'boardId'])

export const ProjectKanbanResponse = t.Object({
  projectId: t.String({ format: 'uuid' }),
  groupBy: GroupBy,
  columns: t.Array(ProjectKanbanColumn),
  // Карточки со статусами, которые ещё не появились в проекте, попадают
  // в «Other». На практике пусто для groupBy=status, т.к. колонки
  // строятся динамически из присутствующих статусов.
  other: t.Optional(ProjectKanbanColumn),
  cursor: t.Union([t.String(), t.Null()]),
})

// Спринт проекта — для выбора в editor'е и фильтра по sprint в kanban.
export const ProjectSprint = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  state: t.Union([t.Literal('active'), t.Literal('future'), t.Literal('closed')]),
  startDate: t.Union([t.String(), t.Null()]),
  endDate: t.Union([t.String(), t.Null()]),
})

export const ProjectSprintsResponse = t.Object({
  items: t.Array(ProjectSprint),
})

export type ProjectListItem = typeof ProjectListItem.static
export type ProjectDetail = typeof ProjectDetail.static
export type ProjectKanbanColumn = typeof ProjectKanbanColumn.static
export type ProjectKanbanResponse = typeof ProjectKanbanResponse.static
export type ProjectAvailableIssueType = typeof ProjectAvailableIssueType.static
export type ProjectSprint = typeof ProjectSprint.static
