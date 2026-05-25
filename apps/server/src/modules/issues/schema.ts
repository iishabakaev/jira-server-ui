import { t } from 'elysia'

// Контракт issues-модуля. Эти TypeBox-схемы — единственный источник правды
// для валидации запросов и для типов фронтенда через Eden Treaty.
// См. docs/specs/06-api.md (#issues).

export const SyncState = t.Union([
  t.Literal('synced'),
  t.Literal('pending'),
  t.Literal('pushing'),
  t.Literal('error'),
  t.Literal('conflict'),
])

export const StatusCategory = t.Union([
  t.Literal('new'),
  t.Literal('indeterminate'),
  t.Literal('done'),
])

export const GroupBy = t.Union([
  t.Literal('status'),
  t.Literal('assignee'),
  t.Literal('epic'),
  t.Literal('priority'),
  t.Literal('sprint'),
])

export const IssueFilter = t.Object({
  projectIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
  boardId: t.Optional(t.String({ format: 'uuid' })),
  sprintIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
  assigneeIds: t.Optional(t.Array(t.String())),
  epicKeys: t.Optional(t.Array(t.String())),
  statusCategories: t.Optional(t.Array(StatusCategory)),
  statusIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
  labels: t.Optional(t.Array(t.String())),
  components: t.Optional(t.Array(t.String())),
  priorities: t.Optional(t.Array(t.String())),
  text: t.Optional(t.String({ maxLength: 200 })),
  updatedAfter: t.Optional(t.String({ format: 'date-time' })),
  groupBy: t.Optional(GroupBy),
  cursor: t.Optional(t.String({ maxLength: 256 })),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 500 })),
})

// Лёгкая карточка для kanban/листинга. Поля ровно те, что нужны view —
// тяжёлые ADF и changelog не сериализуются.
export const IssueSummary = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  jiraId: t.String(),
  projectId: t.String({ format: 'uuid' }),
  summary: t.String(),
  issueTypeId: t.String({ format: 'uuid' }),
  issueTypeName: t.String(),
  issueTypeIconUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]),
  // Флаг "это подзадача" — нужен UI'ю чтобы спрятать сабтаски на kanban'е
  // по умолчанию и показывать их по тогглу. Хранится в issue_types.subtask.
  isSubtask: t.Boolean(),
  statusId: t.String({ format: 'uuid' }),
  statusName: t.String(),
  statusCategory: StatusCategory,
  priorityId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  priorityName: t.Union([t.String(), t.Null()]),
  priorityIconUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]),
  assigneeId: t.Union([t.String(), t.Null()]),
  assigneeDisplayName: t.Union([t.String(), t.Null()]),
  reporterId: t.Union([t.String(), t.Null()]),
  parentJiraId: t.Union([t.String(), t.Null()]),
  epicJiraId: t.Union([t.String(), t.Null()]),
  sprintId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  sprintName: t.Union([t.String(), t.Null()]),
  labels: t.Array(t.String()),
  components: t.Array(t.String()),
  fixVersions: t.Array(t.String()),
  dueDate: t.Union([t.String(), t.Null()]),
  startDate: t.Union([t.String(), t.Null()]),
  storyPoints: t.Union([t.Number(), t.Null()]),
  orderingRank: t.Union([t.String(), t.Null()]),
  jiraUpdatedAt: t.String(),
  syncState: SyncState,
})

export const IssueListResponse = t.Object({
  items: t.Array(IssueSummary),
  cursor: t.Union([t.String(), t.Null()]),
  total: t.Optional(t.Integer()),
})

// ─── Мутации (M5) ───
// IssuePatch — partial-обновление "лёгких" полей; description приходит через
// editor-эндпойнт (M6), кастом-поля проходят как `customFields` map.
// Все поля опциональны и могут быть null для очистки значения.
export const IssuePatch = t.Partial(
  t.Object({
    summary: t.String({ minLength: 1, maxLength: 512 }),
    assigneeId: t.Union([t.String({ minLength: 1, maxLength: 128 }), t.Null()]),
    priorityId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
    labels: t.Array(t.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
    components: t.Array(t.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 }),
    dueDate: t.Union([t.String({ format: 'date' }), t.Null()]),
    startDate: t.Union([t.String({ format: 'date' }), t.Null()]),
    storyPoints: t.Union([t.Number(), t.Null()]),
    sprintId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
    epicKey: t.Union([
      t.String({ pattern: '^[A-Z][A-Z0-9_]{1,9}-[0-9]+$', maxLength: 64 }),
      t.Null(),
    ]),
    parentKey: t.Union([
      t.String({ pattern: '^[A-Z][A-Z0-9_]{1,9}-[0-9]+$', maxLength: 64 }),
      t.Null(),
    ]),
    customFields: t.Record(t.String(), t.Unknown()),
  }),
)

export const TransitionBody = t.Object({
  // Принимаем uuid целевого статуса (как мы возвращаем во всех контрактах).
  toStatusId: t.String({ format: 'uuid' }),
  // Опциональные значения требуемых полей конкретного транзишена.
  fields: t.Optional(t.Record(t.String(), t.Unknown())),
})

export const RankBody = t.Object({
  // uuid карточек-соседей; null означает край колонки.
  beforeId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  afterId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
})

export const BatchRankBody = t.Object({
  // Массив переносимых карточек в финальном порядке. Все они становятся
  // соседями в колонке между beforeId и afterId.
  issueIds: t.Array(t.String({ format: 'uuid' }), { minItems: 1, maxItems: 200 }),
  beforeId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  afterId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  // Опционально: одновременно переносим в другой статус (то же DnD-событие).
  toStatusId: t.Optional(t.String({ format: 'uuid' })),
})

export const TransitionOption = t.Object({
  toStatusId: t.String({ format: 'uuid' }),
  toStatusName: t.String(),
  jiraTransitionId: t.String(),
  name: t.String(),
  requiredFields: t.Array(
    t.Object({
      field: t.String(),
      name: t.String(),
      required: t.Boolean(),
      schemaType: t.String(),
    }),
  ),
})

export const TransitionsResponse = t.Object({
  fromStatusId: t.String({ format: 'uuid' }),
  options: t.Array(TransitionOption),
})

// ─── Issue detail (M6) ───
// Развёрнутая карточка для side-panel / full-screen editor'а: description,
// сабтаски, связи, комментарии, ворклоги. Тяжёлые поля по-прежнему фильтруются
// (FTS-плейн-текст не возвращается, кастомные поля идут только promoted).
export const SubtaskSummary = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  summary: t.String(),
  statusName: t.String(),
  statusCategory: StatusCategory,
  // LexoRank-строка, по которой сабтаски сортируются и перетаскиваются.
  // Может быть null для черновиков, ещё не получивших rank от Jira.
  orderingRank: t.Union([t.String(), t.Null()]),
})

export const IssueLinkRef = t.Object({
  id: t.String({ format: 'uuid' }),
  linkTypeName: t.String(),
  // 'inward' | 'outward' — направление с точки зрения текущей карточки.
  direction: t.Union([t.Literal('inward'), t.Literal('outward')]),
  // Описание направления для UI: "blocks" / "is blocked by" и т.п.
  label: t.String(),
  issue: t.Object({
    id: t.String({ format: 'uuid' }),
    key: t.String(),
    summary: t.String(),
    statusName: t.String(),
    statusCategory: StatusCategory,
  }),
})

export const IssueComment = t.Object({
  id: t.String({ format: 'uuid' }),
  jiraId: t.Union([t.String(), t.Null()]),
  authorId: t.String(),
  // ADF JSON. На фронте десериализуется TipTap'ом.
  body: t.Unknown(),
  createdAt: t.String(),
  updatedAt: t.String(),
  syncState: SyncState,
})

export const IssueWorklog = t.Object({
  id: t.String({ format: 'uuid' }),
  jiraId: t.Union([t.String(), t.Null()]),
  authorId: t.String(),
  seconds: t.Integer(),
  startedAt: t.String(),
  comment: t.Union([t.String(), t.Null()]),
  syncState: SyncState,
})

// Field schema: один FieldDef из таблицы field_schemas. Жёстко описываем
// shape, чтобы Eden Treaty отдавал клиенту корректный union вместо t.Any().
// Лимиты по длине строк не из соображений безопасности (это server→client
// данные, мы их сами синхронизировали из Jira), а чтобы payload не разбух.
export const FieldDef = t.Object({
  key: t.String({ minLength: 1, maxLength: 128 }),
  name: t.String({ minLength: 1, maxLength: 256 }),
  schema: t.Object({
    type: t.String({ maxLength: 32 }),
    items: t.Optional(t.String({ maxLength: 32 })),
    custom: t.Optional(t.String({ maxLength: 256 })),
    customId: t.Optional(t.Integer()),
    system: t.Optional(t.String({ maxLength: 64 })),
  }),
  required: t.Boolean(),
  hasDefaultValue: t.Optional(t.Boolean()),
  allowedValues: t.Optional(
    t.Array(
      t.Object({
        id: t.String(),
        value: t.Optional(t.String()),
        name: t.Optional(t.String()),
      }),
      { maxItems: 1024 },
    ),
  ),
  operations: t.Optional(t.Array(t.String(), { maxItems: 32 })),
  // Список поверхностей, где UI выводит поле. Отсутствие массива означает
  // "показать на всех поверхностях" — это явный контракт, на который
  // полагается клиентский CustomFieldsList. refresh-metadata будущих
  // версий начнёт выставлять surface явно для уже синхронизированных полей.
  surface: t.Optional(
    t.Array(t.Union([t.Literal('editor'), t.Literal('create'), t.Literal('transition')]), {
      maxItems: 3,
    }),
  ),
  order: t.Optional(t.Integer()),
  hidden: t.Optional(t.Boolean()),
})

// Срез field_schemas для пары (project, issueType) текущей карточки.
// `null` означает "схемы нет в кеше" — клиент рендерит только базовый набор.
export const IssueFieldSchema = t.Object({
  fields: t.Array(FieldDef, { maxItems: 512 }),
})

// ─── Deployment (Platform Devops Task) ───
// Состояние выкатки артефакта Platform Devops Task. Бейдж рисуется в шапке
// editor'а и на сабтасках/связях, унаследовавших состояние от артефакта.
export const DeploymentState = t.Union([
  t.Literal('not-deployed'),
  t.Literal('deploying'),
  t.Literal('deployed'),
])

export const DeploymentInfo = t.Object({
  state: DeploymentState,
  statusName: t.String(),
  // Ключ Platform Devops Task, от которого посчитан state. Совпадает с
  // issue.key, если бейдж считается по самой задаче.
  devopsTaskKey: t.String(),
})

// Узел дерева детей для view эпика: задачи с их сабтасками. Используется
// только в IssueDetail.epicChildren — у обычных задач остаётся плоский
// `subtasks`.
export const EpicChildTask = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  summary: t.String(),
  issueTypeName: t.String(),
  statusName: t.String(),
  statusCategory: StatusCategory,
  assigneeDisplayName: t.Union([t.String(), t.Null()]),
  deployment: t.Union([DeploymentInfo, t.Null()]),
  orderingRank: t.Union([t.String(), t.Null()]),
  // Sub-tasks per task — гипотетический cap. Реальный потолок задаётся в
  // loadEpicChildren, но TypeBox-схема страхует Eden Treaty от raw-Jira drift'а.
  subtasks: t.Array(SubtaskSummary, { maxItems: 500 }),
})

export const IssueDetail = t.Object({
  summary: IssueSummary,
  // ADF JSON, тот же тип, что и в комментариях.
  description: t.Unknown(),
  descriptionText: t.Union([t.String(), t.Null()]),
  customFields: t.Record(t.String(), t.Unknown()),
  // null — схема ещё не закеширована refresh-metadata для этой (project, issueType).
  fieldSchema: t.Union([IssueFieldSchema, t.Null()]),
  subtasks: t.Array(SubtaskSummary),
  links: t.Array(IssueLinkRef),
  comments: t.Array(IssueComment),
  worklogs: t.Array(IssueWorklog),
  // Состояние развёртывания этой задачи. Не null только если:
  //   - сама задача — Platform Devops Task (считается по своему статусу), или
  //   - parent задачи — Platform Devops Task (унаследовали state).
  deployment: t.Union([DeploymentInfo, t.Null()]),
  // Только для эпиков: дерево вложенных задач (с их сабтасками). Для остальных
  // типов — пустой массив. Cap должен совпадать с EPIC_CHILDREN_LIMIT в
  // queries.ts (200 на момент write'а), но валидация Eden Treaty не должна
  // ломаться при будущем расширении — кладём с запасом.
  epicChildren: t.Array(EpicChildTask, { maxItems: 1000 }),
})

// ─── Comments mutations (M6) ───
// Тело комментария принимаем либо как plain-text (для MVP редактора),
// либо как ADF-блоб. Поле `text` мы оборачиваем в минимальный ADF-doc
// перед записью в БД, чтобы строка comments.body всегда была валидным ADF
// и round-tripping с Jira работал без дополнительной нормализации.
// Минимальный ADF: { type: 'doc', version: 1, content: [...] }. Поле `body`
// проходит TypeBox-проверку shape'а; внутри array допускаем произвольные
// узлы (Jira добавляет marks, attrs и т.п.), но cap на cardinality стоит.
const AdfBody = t.Object({
  type: t.Literal('doc'),
  version: t.Integer({ minimum: 1, maximum: 1 }),
  content: t.Array(t.Unknown(), { maxItems: 256 }),
})

export const CommentCreateBody = t.Object({
  text: t.Optional(t.String({ minLength: 1, maxLength: 32_000 })),
  body: t.Optional(AdfBody),
})

export const CommentEditBody = t.Object({
  text: t.Optional(t.String({ minLength: 1, maxLength: 32_000 })),
  body: t.Optional(AdfBody),
})

// Jira-ключ: 2-10 заглавных букв/цифр после первой буквы + дефис + число.
// Длина проекта вырезана из реальной Jira-практики; см. docs/specs/13-jira-reality.md.
const JiraKey = t.String({
  pattern: '^[A-Z][A-Z0-9_]{1,9}-[0-9]+$',
  maxLength: 64,
})

export const QuickCreateBody = t.Object({
  projectId: t.String({ format: 'uuid' }),
  issueTypeId: t.String({ format: 'uuid' }),
  summary: t.String({ minLength: 1, maxLength: 512 }),
  // Для сабтаска — ключ родителя; для таска под эпиком — ключ эпика.
  parentKey: t.Optional(JiraKey),
  epicKey: t.Optional(JiraKey),
  // Jira accountId / username. Жёстко ограничиваем длину; шаблон оставляем
  // широким — на Jira Server это username с дефисами/точками.
  assigneeId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
  priorityId: t.Optional(t.String({ format: 'uuid' })),
  labels: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 })),
})

export type CommentCreateBody = typeof CommentCreateBody.static
export type CommentEditBody = typeof CommentEditBody.static
export type QuickCreateBody = typeof QuickCreateBody.static

export type IssueDetail = typeof IssueDetail.static
export type SubtaskSummary = typeof SubtaskSummary.static
export type IssueLinkRef = typeof IssueLinkRef.static
export type IssueComment = typeof IssueComment.static
export type IssueWorklog = typeof IssueWorklog.static
export type FieldDef = typeof FieldDef.static
export type IssueFieldSchema = typeof IssueFieldSchema.static
export type DeploymentInfo = typeof DeploymentInfo.static
export type DeploymentState = typeof DeploymentState.static
export type EpicChildTask = typeof EpicChildTask.static

// ─── Activity feed (M6) ───
// Каждая запись — одно событие outbox, относящееся к карточке: правка полей,
// смена статуса, drag-rank, создание. Сервер строит human-readable summary
// (UI не разбирает payload) + хранит state outbox-строки, чтобы фронт показал
// pip "pending → in_flight → done/error".
export const ActivityEntryKind = t.Union([
  t.Literal('issue.create'),
  t.Literal('issue.update'),
  t.Literal('issue.transition'),
  t.Literal('issue.rank'),
  t.Literal('issue.rank-and-transition'),
])

export const ActivityEntryState = t.Union([
  t.Literal('pending'),
  t.Literal('in_flight'),
  t.Literal('done'),
  t.Literal('error'),
  t.Literal('dead'),
])

export const IssueActivityEntry = t.Object({
  id: t.String(),
  kind: ActivityEntryKind,
  // Список коротких строк-описаний — пара "field: from → to" или одна строка
  // "moved to In Progress". UI рендерит как chip-list.
  summaries: t.Array(t.String({ maxLength: 256 }), { maxItems: 16 }),
  userId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  attempts: t.Integer(),
  state: ActivityEntryState,
  lastError: t.Union([t.String(), t.Null()]),
  createdAt: t.String(),
})

export const IssueActivityResponse = t.Object({
  items: t.Array(IssueActivityEntry),
})

export type IssueActivityEntry = typeof IssueActivityEntry.static
export type ActivityEntryKind = typeof ActivityEntryKind.static

// Группа карточек для kanban-ответа. Имя группы — display-string
// (статус, ассайни, ключ эпика и т.п.), id — стабильный токен (uuid|key|null).
export const IssueGroup = t.Object({
  groupId: t.Union([t.String(), t.Null()]),
  groupLabel: t.String(),
  count: t.Integer(),
  items: t.Array(IssueSummary),
})

export const KanbanResponse = t.Object({
  groupBy: GroupBy,
  groups: t.Array(IssueGroup),
  cursor: t.Union([t.String(), t.Null()]),
})

export type IssueFilter = typeof IssueFilter.static
export type IssueSummary = typeof IssueSummary.static
export type GroupBy = typeof GroupBy.static
export type StatusCategory = typeof StatusCategory.static
export type IssueGroup = typeof IssueGroup.static
export type KanbanResponse = typeof KanbanResponse.static
export type IssuePatch = typeof IssuePatch.static
export type TransitionBody = typeof TransitionBody.static
export type RankBody = typeof RankBody.static
export type BatchRankBody = typeof BatchRankBody.static
export type TransitionsResponse = typeof TransitionsResponse.static
