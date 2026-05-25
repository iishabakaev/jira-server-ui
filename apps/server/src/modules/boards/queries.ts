import { type Board, boards, db, fieldSchemas, issueTypes, statuses } from '@db'
import { and, eq, inArray } from 'drizzle-orm'

// Read-only выборки доски. Авторизация (видимость доски конкретному
// пользователю) на M4 минимальная — все доски глобальны для авторизованных
// пользователей. Подключим RLS/role-checks, когда появится модель команд.

export async function listBoards(): Promise<Board[]> {
  return db.select().from(boards).orderBy(boards.name)
}

export async function getBoardById(id: string): Promise<Board | null> {
  const rows = await db.select().from(boards).where(eq(boards.id, id)).limit(1)
  return rows[0] ?? null
}

// Резолвит набор jira-id статусов из board.config в локальные uuid.
// Возвращаем Map jiraId → uuid, чтобы дальше колонки могли отрабатывать
// детерминированно даже если запланированный статус не найден в БД.
export async function statusUuidsByJiraIds(jiraIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (jiraIds.length === 0) return map
  const unique = Array.from(new Set(jiraIds))
  const rows = await db
    .select({ id: statuses.id, jiraId: statuses.jiraId })
    .from(statuses)
    .where(inArray(statuses.jiraId, unique))
  for (const r of rows) map.set(r.jiraId, r.id)
  return map
}

// Issue-types, доступные в quick-create для projectId. Берём пересечение
// issue_types ⋈ field_schemas, чтобы возвращать только те типы, у которых
// уже есть закешированная /createmeta-схема. Subtasks отфильтрованы —
// они создаются из subtask-checklist'а карточки, а не из quick-create.
// field_schemas имеет uniqueIndex на (project_id, issue_type_id), поэтому
// дубликатов из join'а не будет; distinct не нужен. Сортировка по name
// даёт стабильный порядок для dropdown'а.
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
    .orderBy(issueTypes.name)
}
