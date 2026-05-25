import {
  comments,
  db,
  fieldSchemas,
  type Issue,
  issueLinks,
  issues,
  issueTypes,
  linkTypes,
  outboxEvents,
  priorities,
  sprints,
  statuses,
  users,
  worklogs,
} from '@db'
import { and, arrayOverlaps, asc, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import { collectStatusRefs, renderActivity } from './activity'
import {
  buildDeploymentInfo,
  type DeploymentInfo,
  isDevopsArtifactType,
  isEpicType,
} from './deployment'
import type {
  EpicChildTask,
  FieldDef,
  IssueActivityEntry,
  IssueComment,
  IssueDetail,
  IssueFieldSchema,
  IssueFilter,
  IssueLinkRef,
  IssueSummary,
  IssueWorklog,
  StatusCategory,
  SubtaskSummary,
} from './schema'

// Курсор: пара (jira_updated_at iso, issue id). Сортируем по возрасту убыв.;
// id — детерминированный tiebreaker. Сериализуем base64url.
type CursorPayload = { u: string; i: string }

function encodeCursor(p: CursorPayload | null): string | null {
  if (!p) return null
  const json = JSON.stringify(p)
  return Buffer.from(json, 'utf8').toString('base64url')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function decodeCursor(raw: string | undefined): CursorPayload | null {
  if (!raw) return null
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8')
    const obj = JSON.parse(json) as Partial<CursorPayload>
    if (typeof obj.u !== 'string' || typeof obj.i !== 'string') return null
    // Курсор приходит от клиента, но обращается в WHERE-выражение поверх
    // jira_updated_at и UUID-колонки; ослабленная валидация привела бы
    // либо к full scan (Invalid Date → bad comparison), либо к 500 на UUID-cast.
    const ts = new Date(obj.u).getTime()
    if (!Number.isFinite(ts)) return null
    if (!UUID_RE.test(obj.i)) return null
    return { u: obj.u, i: obj.i }
  } catch {
    return null
  }
}

const KNOWN_CATEGORIES: StatusCategory[] = ['new', 'indeterminate', 'done']

function normalizeCategory(raw: string): StatusCategory {
  return (KNOWN_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as StatusCategory)
    : 'indeterminate'
}

// Базовый набор колонок для read-API. Joins вытаскивают human-readable
// поля статусов/приоритетов/типов; full description и custom_fields — тяжёлые,
// в листингах не отдаём.
function baseSelect() {
  return {
    id: issues.id,
    key: issues.key,
    jiraId: issues.jiraId,
    projectId: issues.projectId,
    summary: issues.summary,
    issueTypeId: issues.issueTypeId,
    issueTypeName: issueTypes.name,
    issueTypeIconUrl: issueTypes.iconUrl,
    issueTypeSubtask: issueTypes.subtask,
    statusId: issues.statusId,
    statusName: statuses.name,
    statusCategory: statuses.category,
    priorityId: issues.priorityId,
    priorityName: priorities.name,
    priorityIconUrl: priorities.iconUrl,
    assigneeId: issues.assigneeId,
    // Display-name приходит из локального зеркала users (по jiraAccountId).
    // Колонки доски иначе показывали бы UUID — см. docs/specs/07-ui-kanban.md.
    assigneeDisplayName: users.displayName,
    reporterId: issues.reporterId,
    parentJiraId: issues.parentJiraId,
    epicJiraId: issues.epicJiraId,
    sprintId: issues.sprintId,
    sprintName: sprints.name,
    labels: issues.labels,
    components: issues.components,
    fixVersions: issues.fixVersions,
    dueDate: issues.dueDate,
    startDate: issues.startDate,
    storyPoints: issues.storyPoints,
    orderingRank: issues.orderingRank,
    jiraUpdatedAt: issues.jiraUpdatedAt,
    syncState: issues.syncState,
  }
}

type RawRow = Awaited<ReturnType<typeof runListQuery>>[number]

function toSummary(row: RawRow): IssueSummary {
  return {
    id: row.id,
    key: row.key,
    jiraId: row.jiraId,
    projectId: row.projectId,
    summary: row.summary,
    issueTypeId: row.issueTypeId,
    issueTypeName: row.issueTypeName,
    issueTypeIconUrl: row.issueTypeIconUrl,
    isSubtask: row.issueTypeSubtask,
    statusId: row.statusId,
    statusName: row.statusName,
    statusCategory: normalizeCategory(row.statusCategory),
    priorityId: row.priorityId,
    priorityName: row.priorityName,
    priorityIconUrl: row.priorityIconUrl,
    assigneeId: row.assigneeId,
    assigneeDisplayName: row.assigneeDisplayName ?? null,
    reporterId: row.reporterId,
    parentJiraId: row.parentJiraId,
    epicJiraId: row.epicJiraId,
    sprintId: row.sprintId,
    sprintName: row.sprintName ?? null,
    labels: row.labels ?? [],
    components: row.components ?? [],
    fixVersions: row.fixVersions ?? [],
    dueDate: row.dueDate ?? null,
    startDate: row.startDate ?? null,
    storyPoints: row.storyPoints != null ? Number(row.storyPoints) : null,
    orderingRank: row.orderingRank,
    jiraUpdatedAt: row.jiraUpdatedAt.toISOString(),
    syncState: row.syncState,
  }
}

function buildWhere(filter: IssueFilter, cursor: CursorPayload | null) {
  const clauses = [isNull(issues.deletedAt)]

  if (filter.projectIds?.length) {
    clauses.push(inArray(issues.projectId, filter.projectIds))
  }
  if (filter.statusIds?.length) {
    clauses.push(inArray(issues.statusId, filter.statusIds))
  }
  if (filter.statusCategories?.length) {
    clauses.push(inArray(statuses.category, filter.statusCategories))
  }
  if (filter.assigneeIds?.length) {
    // Спец-токен 'unassigned' для пустого ассайни — типичный фильтр доски.
    const real = filter.assigneeIds.filter((x) => x !== 'unassigned')
    const wantsUnassigned = filter.assigneeIds.includes('unassigned')
    const parts = []
    if (real.length) parts.push(inArray(issues.assigneeId, real))
    if (wantsUnassigned) parts.push(isNull(issues.assigneeId))
    if (parts.length) {
      const combined = parts.length === 1 ? parts[0]! : or(...parts)!
      clauses.push(combined)
    }
  }
  if (filter.epicKeys?.length) {
    clauses.push(inArray(issues.epicJiraId, filter.epicKeys))
  }
  if (filter.sprintIds?.length) {
    clauses.push(inArray(issues.sprintId, filter.sprintIds))
  }
  if (filter.labels?.length) {
    clauses.push(arrayOverlaps(issues.labels, filter.labels))
  }
  if (filter.components?.length) {
    clauses.push(arrayOverlaps(issues.components, filter.components))
  }
  if (filter.priorities?.length) {
    clauses.push(inArray(issues.priorityId, filter.priorities))
  }
  if (filter.text && filter.text.trim().length >= 2) {
    // Экранируем %, _ и сам бэкслеш — иначе паттерн `\%` превращался бы
    // в `\\%` (литеральный бэкслеш + неэкранированный wildcard).
    const escaped = filter.text.trim().replace(/[\\%_]/g, (m) => `\\${m}`)
    const like = `%${escaped}%`
    clauses.push(
      or(
        sql`${issues.summary} ilike ${like} escape '\\'`,
        sql`${issues.key} ilike ${like} escape '\\'`,
        sql`${issues.descriptionText} ilike ${like} escape '\\'`,
      )!,
    )
  }
  if (filter.updatedAfter) {
    clauses.push(gte(issues.jiraUpdatedAt, new Date(filter.updatedAfter)))
  }
  if (cursor) {
    const cursorDate = new Date(cursor.u)
    // Сортировка — desc по jira_updated_at и desc по id; tiebreaker
    // идёт в ту же сторону (lt по id), иначе страницы пропускают строки.
    clauses.push(
      or(
        lt(issues.jiraUpdatedAt, cursorDate),
        and(eq(issues.jiraUpdatedAt, cursorDate), lt(issues.id, cursor.i)),
      )!,
    )
  }
  return and(...clauses)!
}

function runListQuery(filter: IssueFilter, cursor: CursorPayload | null, limit: number) {
  return db
    .select(baseSelect())
    .from(issues)
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .innerJoin(issueTypes, eq(issueTypes.id, issues.issueTypeId))
    .leftJoin(priorities, eq(priorities.id, issues.priorityId))
    .leftJoin(sprints, eq(sprints.id, issues.sprintId))
    .leftJoin(users, eq(users.jiraAccountId, issues.assigneeId))
    .where(buildWhere(filter, cursor))
    .orderBy(desc(issues.jiraUpdatedAt), desc(issues.id))
    .limit(limit + 1)
}

// Возвращает страницу + следующий курсор (null, если страница последняя).
export async function listIssues(filter: IssueFilter): Promise<{
  items: IssueSummary[]
  cursor: string | null
}> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
  const cursor = decodeCursor(filter.cursor)
  const rows = await runListQuery(filter, cursor, limit)

  let nextCursor: CursorPayload | null = null
  if (rows.length > limit) {
    const last = rows[limit - 1]!
    nextCursor = { u: last.jiraUpdatedAt.toISOString(), i: last.id }
  }
  const page = rows.slice(0, limit).map(toSummary)
  return { items: page, cursor: encodeCursor(nextCursor) }
}

// Полная сводка для одной карточки (без description — её отдаёт editor-эндпойнт).
export async function getIssueByKeyOrId(keyOrId: string): Promise<IssueSummary | null> {
  const isUuid = UUID_RE.test(keyOrId)
  const condition = isUuid ? eq(issues.id, keyOrId) : eq(issues.key, keyOrId)
  const rows = await db
    .select(baseSelect())
    .from(issues)
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .innerJoin(issueTypes, eq(issueTypes.id, issues.issueTypeId))
    .leftJoin(priorities, eq(priorities.id, issues.priorityId))
    .leftJoin(sprints, eq(sprints.id, issues.sprintId))
    .leftJoin(users, eq(users.jiraAccountId, issues.assigneeId))
    .where(and(condition, isNull(issues.deletedAt)))
    .limit(1)
  const row = rows[0]
  return row ? toSummary(row) : null
}

// Внутренняя справка: список issue по конкретным project ids (используется
// при построении пустого kanban-ответа, чтобы знать набор реально зеркалированных
// проектов пользователя).
export async function distinctProjectsForIssues(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ projectId: issues.projectId })
    .from(issues)
    .where(isNull(issues.deletedAt))
  return rows.map((r) => r.projectId)
}

// ─── Issue detail (M6) ────────────────────────────────────────────────────
// Грузит все вторичные сущности одной карточки одной серией запросов: сабтаски,
// связи в обе стороны, комментарии и ворклоги. Каждый запрос — индексирован.
// На горячем пути editor'а это один HTTP-роут вместо четырёх — экономим RTT
// между фронтом и API.

const KNOWN_CATEGORIES_SET = new Set<string>(KNOWN_CATEGORIES)

async function loadSubtasks(parentJiraId: string): Promise<SubtaskSummary[]> {
  const rows = await db
    .select({
      id: issues.id,
      key: issues.key,
      summary: issues.summary,
      statusName: statuses.name,
      statusCategory: statuses.category,
      orderingRank: issues.orderingRank,
    })
    .from(issues)
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .where(and(eq(issues.parentJiraId, parentJiraId), isNull(issues.deletedAt))!)
    // Сортировка по rank — основной ключ для drag-reorder. NULLS LAST,
    // чтобы черновики без rank не пролезали в начало списка; вторичный ключ
    // по key даёт детерминированный порядок для двух строк с равными ranks.
    .orderBy(sql`${issues.orderingRank} ASC NULLS LAST`, asc(issues.key))
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    summary: r.summary,
    statusName: r.statusName,
    statusCategory: KNOWN_CATEGORIES_SET.has(r.statusCategory)
      ? (r.statusCategory as StatusCategory)
      : 'indeterminate',
    orderingRank: r.orderingRank,
  }))
}

async function loadLinks(issueId: string): Promise<IssueLinkRef[]> {
  // Каждая связь имеет направление; представим её с точки зрения "нашего" issue:
  //   outward: source = текущий, target = peer; ярлык — linkTypes.outward
  //   inward:  target = текущий, source = peer; ярлык — linkTypes.inward
  const rows = await db
    .select({
      linkId: issueLinks.id,
      direction: issueLinks.direction,
      linkTypeName: linkTypes.name,
      linkInward: linkTypes.inward,
      linkOutward: linkTypes.outward,
      sourceIssueId: issueLinks.sourceIssueId,
      targetIssueId: issueLinks.targetIssueId,
      sourceKey: sql<string>`src.key`,
      sourceSummary: sql<string>`src.summary`,
      sourceStatusName: sql<string>`src_status.name`,
      sourceStatusCategory: sql<string>`src_status.category`,
      targetKey: sql<string>`tgt.key`,
      targetSummary: sql<string>`tgt.summary`,
      targetStatusName: sql<string>`tgt_status.name`,
      targetStatusCategory: sql<string>`tgt_status.category`,
    })
    .from(issueLinks)
    .innerJoin(linkTypes, eq(linkTypes.id, issueLinks.linkTypeId))
    .innerJoin(sql`issues as src`, sql`src.id = ${issueLinks.sourceIssueId}`)
    .innerJoin(sql`issues as tgt`, sql`tgt.id = ${issueLinks.targetIssueId}`)
    .innerJoin(sql`statuses as src_status`, sql`src_status.id = src.status_id`)
    .innerJoin(sql`statuses as tgt_status`, sql`tgt_status.id = tgt.status_id`)
    .where(or(eq(issueLinks.sourceIssueId, issueId), eq(issueLinks.targetIssueId, issueId))!)
    .orderBy(asc(issueLinks.createdAt))

  return rows.map((r) => {
    const isOutward = r.sourceIssueId === issueId
    const peer = isOutward
      ? {
          id: r.targetIssueId,
          key: r.targetKey,
          summary: r.targetSummary,
          statusName: r.targetStatusName,
          statusCategory: r.targetStatusCategory,
        }
      : {
          id: r.sourceIssueId,
          key: r.sourceKey,
          summary: r.sourceSummary,
          statusName: r.sourceStatusName,
          statusCategory: r.sourceStatusCategory,
        }
    return {
      id: r.linkId,
      linkTypeName: r.linkTypeName,
      direction: isOutward ? ('outward' as const) : ('inward' as const),
      label: isOutward ? r.linkOutward : r.linkInward,
      issue: {
        id: peer.id,
        key: peer.key,
        summary: peer.summary,
        statusName: peer.statusName,
        statusCategory: KNOWN_CATEGORIES_SET.has(peer.statusCategory)
          ? (peer.statusCategory as StatusCategory)
          : 'indeterminate',
      },
    }
  })
}

async function loadComments(issueId: string): Promise<IssueComment[]> {
  const rows = await db
    .select({
      id: comments.id,
      jiraId: comments.jiraId,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      syncState: comments.syncState,
    })
    .from(comments)
    .where(eq(comments.issueId, issueId))
    .orderBy(asc(comments.createdAt))
  return rows.map((r) => ({
    id: r.id,
    jiraId: r.jiraId,
    authorId: r.authorId,
    body: r.body as unknown,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    syncState: r.syncState,
  }))
}

async function loadWorklogs(issueId: string): Promise<IssueWorklog[]> {
  const rows = await db
    .select({
      id: worklogs.id,
      jiraId: worklogs.jiraId,
      authorId: worklogs.authorId,
      seconds: worklogs.seconds,
      startedAt: worklogs.startedAt,
      comment: worklogs.comment,
      syncState: worklogs.syncState,
    })
    .from(worklogs)
    .where(eq(worklogs.issueId, issueId))
    .orderBy(desc(worklogs.startedAt))
  return rows.map((r) => ({
    id: r.id,
    jiraId: r.jiraId,
    authorId: r.authorId,
    seconds: r.seconds,
    startedAt: r.startedAt.toISOString(),
    comment: r.comment,
    syncState: r.syncState,
  }))
}

// Срез field_schemas для пары (project, issueType). Возвращаем все поля без
// фильтрации surface/hidden — клиент сам решает, какие рендерить (editor,
// transition-modal, quick-create). Поле order сохраняется как есть.
async function loadFieldSchema(
  projectId: string,
  issueTypeId: string,
): Promise<IssueFieldSchema | null> {
  const rows = await db
    .select({ fields: fieldSchemas.fields })
    .from(fieldSchemas)
    .where(and(eq(fieldSchemas.projectId, projectId), eq(fieldSchemas.issueTypeId, issueTypeId)))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { fields: (row.fields as FieldDef[]) ?? [] }
}

// Лёгкий лукап родителя (тип + статус) для пропагации deployment-бейджа
// на сабтаски Platform Devops Task'а.
async function loadParentArtifact(
  parentJiraId: string | null,
): Promise<{ key: string; statusName: string; isDevops: boolean } | null> {
  if (!parentJiraId) return null
  const rows = await db
    .select({
      key: issues.key,
      statusName: statuses.name,
      issueTypeName: issueTypes.name,
    })
    .from(issues)
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .innerJoin(issueTypes, eq(issueTypes.id, issues.issueTypeId))
    .where(and(eq(issues.jiraId, parentJiraId), isNull(issues.deletedAt))!)
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return {
    key: row.key,
    statusName: row.statusName,
    isDevops: isDevopsArtifactType(row.issueTypeName),
  }
}

function computeDeployment(
  summary: IssueSummary,
  parent: Awaited<ReturnType<typeof loadParentArtifact>>,
): DeploymentInfo | null {
  // Сама задача — Platform Devops Task: бейдж считается по собственному статусу.
  if (isDevopsArtifactType(summary.issueTypeName)) {
    return buildDeploymentInfo(summary.key, summary.statusName)
  }
  // Сабтаск Platform Devops Task'а: наследует state от артефакта-родителя.
  if (parent?.isDevops) {
    return buildDeploymentInfo(parent.key, parent.statusName)
  }
  return null
}

// Жёсткий потолок на размер ответа `epicChildren`. Большие эпики ALFAIAAS
// иногда имеют сотни задач — без cap'а одно открытие editor'а тянет
// мегабайты и подтормаживает Render. 200 покрывает 95-й перцентиль; редкие
// «гипер-эпики» обрезаются — UI это пометит при необходимости.
const EPIC_CHILDREN_LIMIT = 200

// Грузим детей эпика: задачи (epicJiraId == эпика) и их сабтаски одним
// проходом через issue_jira_id IN (...). Это дешевле, чем N+1 запрос на
// каждую родительскую задачу.
async function loadEpicChildren(epicJiraId: string): Promise<EpicChildTask[]> {
  // 1. Все дети эпика — задачи верхнего уровня. Cap по EPIC_CHILDREN_LIMIT.
  const taskRows = await db
    .select({
      id: issues.id,
      jiraId: issues.jiraId,
      key: issues.key,
      summary: issues.summary,
      issueTypeName: issueTypes.name,
      statusName: statuses.name,
      statusCategory: statuses.category,
      assigneeDisplayName: users.displayName,
      orderingRank: issues.orderingRank,
    })
    .from(issues)
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .innerJoin(issueTypes, eq(issueTypes.id, issues.issueTypeId))
    .leftJoin(users, eq(users.jiraAccountId, issues.assigneeId))
    .where(and(eq(issues.epicJiraId, epicJiraId), isNull(issues.deletedAt))!)
    .orderBy(sql`${issues.orderingRank} ASC NULLS LAST`, asc(issues.key))
    .limit(EPIC_CHILDREN_LIMIT)
  if (taskRows.length === 0) return []

  // 2. Все сабтаски этих задач — одним IN-запросом.
  const parentJiraIds = taskRows.map((r) => r.jiraId)
  const subtaskRows = await db
    .select({
      id: issues.id,
      key: issues.key,
      summary: issues.summary,
      statusName: statuses.name,
      statusCategory: statuses.category,
      orderingRank: issues.orderingRank,
      parentJiraId: issues.parentJiraId,
    })
    .from(issues)
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .where(and(inArray(issues.parentJiraId, parentJiraIds), isNull(issues.deletedAt))!)
    .orderBy(sql`${issues.orderingRank} ASC NULLS LAST`, asc(issues.key))

  const subtasksByParent = new Map<string, SubtaskSummary[]>()
  for (const r of subtaskRows) {
    if (!r.parentJiraId) continue
    const bucket = subtasksByParent.get(r.parentJiraId) ?? []
    bucket.push({
      id: r.id,
      key: r.key,
      summary: r.summary,
      statusName: r.statusName,
      statusCategory: KNOWN_CATEGORIES_SET.has(r.statusCategory)
        ? (r.statusCategory as StatusCategory)
        : 'indeterminate',
      orderingRank: r.orderingRank,
    })
    subtasksByParent.set(r.parentJiraId, bucket)
  }

  return taskRows.map((r) => ({
    id: r.id,
    key: r.key,
    summary: r.summary,
    issueTypeName: r.issueTypeName,
    statusName: r.statusName,
    statusCategory: KNOWN_CATEGORIES_SET.has(r.statusCategory)
      ? (r.statusCategory as StatusCategory)
      : 'indeterminate',
    assigneeDisplayName: r.assigneeDisplayName ?? null,
    deployment: isDevopsArtifactType(r.issueTypeName)
      ? buildDeploymentInfo(r.key, r.statusName)
      : null,
    orderingRank: r.orderingRank,
    subtasks: subtasksByParent.get(r.jiraId) ?? [],
  }))
}

export async function getIssueDetail(keyOrId: string): Promise<IssueDetail | null> {
  const summary = await getIssueByKeyOrId(keyOrId)
  if (!summary) return null
  const heavyRows = await db
    .select({
      id: issues.id,
      jiraId: issues.jiraId,
      description: issues.description,
      descriptionText: issues.descriptionText,
      customFields: issues.customFields,
    })
    .from(issues)
    .where(eq(issues.id, summary.id))
    .limit(1)
  const heavy = heavyRows[0]
  if (!heavy) return null
  // Эпик-children грузим только если текущая задача — эпик. Любой другой тип
  // получает пустой массив; UI решает не рендерить дерево.
  const wantsEpicChildren = isEpicType(summary.issueTypeName)
  const [subtasks, links, commentRows, worklogRows, fieldSchema, parent, epicChildren] =
    await Promise.all([
      loadSubtasks(heavy.jiraId),
      loadLinks(heavy.id),
      loadComments(heavy.id),
      loadWorklogs(heavy.id),
      loadFieldSchema(summary.projectId, summary.issueTypeId),
      loadParentArtifact(summary.parentJiraId),
      wantsEpicChildren ? loadEpicChildren(heavy.jiraId) : Promise.resolve([] as EpicChildTask[]),
    ])
  return {
    summary,
    description: (heavy.description as unknown) ?? null,
    descriptionText: heavy.descriptionText,
    customFields: (heavy.customFields as Record<string, unknown>) ?? {},
    fieldSchema,
    subtasks,
    links,
    comments: commentRows,
    worklogs: worklogRows,
    deployment: computeDeployment(summary, parent),
    epicChildren,
  }
}

// ─── Activity feed (M6) ─────────────────────────────────────────────────
// Источник истины — outbox_events: всё, что мы инициировали из этого UI,
// уже фиксируется там вместе с состоянием отправки в Jira. Подтягиваем
// последние N строк, ресолвим имена статусов, рендерим human-readable summary.

const ACTIVITY_PAGE_LIMIT = 50

export async function listActivity(issueId: string): Promise<IssueActivityEntry[]> {
  const rows = await db
    .select({
      id: outboxEvents.id,
      kind: outboxEvents.kind,
      payload: outboxEvents.payload,
      userId: outboxEvents.userId,
      attempts: outboxEvents.attempts,
      state: outboxEvents.state,
      lastError: outboxEvents.lastError,
      createdAt: outboxEvents.createdAt,
    })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.targetKind, 'issue'), eq(outboxEvents.targetId, issueId)))
    .orderBy(desc(outboxEvents.createdAt))
    .limit(ACTIVITY_PAGE_LIMIT)

  const statusIds = collectStatusRefs(rows)
  const statusNameById = new Map<string, string>()
  if (statusIds.length > 0) {
    const statusRows = await db
      .select({ id: statuses.id, name: statuses.name })
      .from(statuses)
      .where(inArray(statuses.id, statusIds))
    for (const r of statusRows) statusNameById.set(r.id, r.name)
  }

  const entries: IssueActivityEntry[] = []
  for (const row of rows) {
    const entry = renderActivity(row, statusNameById)
    if (entry) entries.push(entry)
  }
  return entries
}

// Утилита для тестов: точное число issue, удовлетворяющих фильтру.
// Используем только в админ-контекстах — на горячем пути не вызывать.
export async function countIssues(filter: IssueFilter): Promise<number> {
  const cursor = decodeCursor(filter.cursor)
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(issues)
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .innerJoin(issueTypes, eq(issueTypes.id, issues.issueTypeId))
    .where(buildWhere(filter, cursor))
  return rows[0]?.n ?? 0
}

export type { Issue }
