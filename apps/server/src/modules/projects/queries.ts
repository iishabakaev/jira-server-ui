import { db, fieldSchemas, issues, issueTypes, projects, sprints, statuses, syncCursor } from '@db'
import { and, asc, desc, eq, or, sql } from 'drizzle-orm'

// Read-only выборки для projects-модуля. Авторизация на M-текущем —
// все проекты глобальны для авторизованных пользователей; RLS подключим
// одновременно с моделью команд.

// Возвращает проекты с реальными issues (на ту же логику, что
// /api/sync/projects). Параметр text — необязательный case-insensitive
// фильтр по key/name; фуззи-ранжирование выполняет клиент, сервер только
// сужает кандидатов и сортирует по key.
export async function listProjects(text: string | null) {
  const baseWhere = sql`exists (
    select 1 from ${issues}
    where ${issues.projectId} = ${projects.id}
      and ${issues.deletedAt} is null
  )`

  // Экранируем wildcard-символы ilike: иначе пользовательский `_` / `%`
  // расширяет паттерн до match-всё. Сам ilike параметризуется Drizzle,
  // SQL-инъекция исключена; нам нужен только литеральный текст.
  const escaped =
    text && text.trim().length > 0 ? text.trim().replace(/[\\%_]/g, (m) => `\\${m}`) : null

  const where = escaped
    ? and(
        baseWhere,
        or(
          sql`${projects.key} ilike ${`%${escaped}%`} escape '\\'`,
          sql`${projects.name} ilike ${`%${escaped}%`} escape '\\'`,
        ),
      )
    : baseWhere

  return db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
      lastUpdatedAt: syncCursor.lastUpdatedAt,
      lastFullSyncAt: syncCursor.lastFullSyncAt,
    })
    .from(projects)
    .leftJoin(syncCursor, eq(syncCursor.projectId, projects.id))
    .where(where)
    .orderBy(asc(projects.key))
}

export async function getProjectById(id: string) {
  const rows = await db
    .select({
      id: projects.id,
      key: projects.key,
      name: projects.name,
    })
    .from(projects)
    .where(eq(projects.id, id))
    .limit(1)
  return rows[0] ?? null
}

// Статусы, которые реально присутствуют у issue этого проекта. Это и есть
// «наш» набор колонок: чем пользоваться, тем и располагаем. Сортировка
// фиксированная: category (new → indeterminate → done) → name.
export async function listProjectStatuses(projectId: string) {
  // EXISTS вместо SELECT DISTINCT: postgres требует, чтобы выражения в
  // ORDER BY были и в select-list при DISTINCT, а case-сортировка туда
  // тащить не хочется. EXISTS даёт тот же набор без distinct'а.
  return db
    .select({
      id: statuses.id,
      name: statuses.name,
      category: statuses.category,
    })
    .from(statuses)
    .where(
      sql`exists (
        select 1 from ${issues}
        where ${issues.statusId} = ${statuses.id}
          and ${issues.projectId} = ${projectId}
          and ${issues.deletedAt} is null
      )`,
    )
    .orderBy(
      sql`case ${statuses.category} when 'new' then 0 when 'indeterminate' then 1 when 'done' then 2 else 3 end`,
      asc(statuses.name),
    )
}

// Спринты, реально используемые проектом: те, к которым привязана хотя бы
// одна issue. Сортируем active → future → closed → name, чтобы свежие
// спринты были в начале списка.
export async function listProjectSprints(projectId: string) {
  return db
    .selectDistinct({
      id: sprints.id,
      name: sprints.name,
      state: sprints.state,
      startDate: sprints.startDate,
      endDate: sprints.endDate,
    })
    .from(sprints)
    .innerJoin(issues, eq(issues.sprintId, sprints.id))
    .where(eq(issues.projectId, projectId))
    .orderBy(
      sql`case ${sprints.state} when 'active' then 0 when 'future' then 1 when 'closed' then 2 else 3 end`,
      desc(sprints.startDate),
      asc(sprints.name),
    )
}

// Issue-types, доступные для quick-create на этом проекте.
// Та же логика, что в boards/queries.ts; subtask отфильтрован.
export async function listProjectIssueTypes(projectId: string) {
  return db
    .select({
      id: issueTypes.id,
      name: issueTypes.name,
      iconUrl: issueTypes.iconUrl,
    })
    .from(issueTypes)
    .innerJoin(fieldSchemas, eq(fieldSchemas.issueTypeId, issueTypes.id))
    .where(and(eq(fieldSchemas.projectId, projectId), eq(issueTypes.subtask, false)))
    .orderBy(asc(issueTypes.name))
}
