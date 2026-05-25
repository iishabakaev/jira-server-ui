import { t } from 'elysia'
import { GroupBy, IssueFilter, IssueGroup } from '../issues/schema'

// Контракт boards-модуля. Колонки доски — конфиг доски в Jira; статусы
// привязаны к колонкам по jira_id (а не uuid), чтобы спокойно переживать
// пересоздание зеркальных строк statuses.

export const BoardListItem = t.Object({
  id: t.String({ format: 'uuid' }),
  jiraId: t.Integer(),
  name: t.String(),
  type: t.String(),
  projectId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
})

export const BoardColumnView = t.Object({
  name: t.String(),
  statusJiraIds: t.Array(t.String()),
  statusIds: t.Array(t.String({ format: 'uuid' })),
  // Единый формат WIP-limit (число или null), один и тот же на detail и kanban,
  // чтобы клиент не разводил две формы.
  wipLimit: t.Union([t.Integer({ minimum: 0 }), t.Null()]),
})

// Issue-type, доступный для quick-create на этой доске.
// Источник правды — field_schemas: пара (project, issueType) считается
// "поддерживаемой", только если для неё успешно вернулся /createmeta.
// Subtasks отфильтрованы — у них своя точка входа (subtask checklist).
export const BoardAvailableIssueType = t.Object({
  id: t.String({ format: 'uuid' }),
  name: t.String(),
  iconUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]),
})

export const BoardDetail = t.Object({
  id: t.String({ format: 'uuid' }),
  jiraId: t.Integer(),
  name: t.String(),
  type: t.String(),
  projectId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  filterJql: t.Union([t.String(), t.Null()]),
  rankCustomFieldId: t.Union([t.String(), t.Null()]),
  columns: t.Array(BoardColumnView),
  defaults: t.Record(t.String(), t.Unknown()),
  // Для quick-create-модалки. Пусто, если board.projectId = null
  // или refresh-metadata ещё не прогнался по проекту.
  availableIssueTypes: t.Array(BoardAvailableIssueType),
})

// Запрос к kanban-эндпойнту: фильтрация поверх board.config. Поля общие
// с IssueFilter, но без projectIds/boardId — они выводятся из самого board.
export const BoardKanbanQuery = t.Omit(IssueFilter, ['projectIds', 'boardId'])

export const BoardKanbanColumn = t.Object({
  name: t.String(),
  // Стабильный токен группы: status uuid (для groupBy=status), либо
  // assignee/sprint id, либо null для "Other"/"Unassigned"/"No epic".
  groupId: t.Union([t.String(), t.Null()]),
  statusIds: t.Array(t.String({ format: 'uuid' })),
  wipLimit: t.Union([t.Integer({ minimum: 0 }), t.Null()]),
  count: t.Integer(),
  items: t.Array(IssueGroup.properties.items.items),
})

export const BoardKanbanResponse = t.Object({
  boardId: t.String({ format: 'uuid' }),
  groupBy: GroupBy,
  // Если groupBy = 'status' — это board.columns с привязанными карточками.
  // Иначе — динамические группы (assignee/epic/priority/sprint).
  columns: t.Array(BoardKanbanColumn),
  // 'Other' — карточки со статусами, не закреплёнными ни в одной колонке.
  other: t.Optional(BoardKanbanColumn),
  cursor: t.Union([t.String(), t.Null()]),
})

export type BoardListItem = typeof BoardListItem.static
export type BoardDetail = typeof BoardDetail.static
export type BoardKanbanResponse = typeof BoardKanbanResponse.static
export type BoardKanbanColumn = typeof BoardKanbanColumn.static
export type BoardAvailableIssueType = typeof BoardAvailableIssueType.static
