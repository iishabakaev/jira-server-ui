import { db, issues, issueTypes, sprints, statuses, users } from '@db'
import { and, eq, gte, isNull, lte, not, sql } from 'drizzle-orm'
import type { StatusCategory } from '../issues/schema'
import type { TimelineBar, TimelineQuery } from './schema'

// Read-only выборка баров для Gantt-окна. Один запрос с join'ами на
// статусы/типы/спринты/users — те же поля, что использует kanban-список,
// но фильтр построен вокруг date-window.
//
// Какой issue попадает в окно [from, to]:
//   - есть хотя бы одна из дат (start_date или due_date — обе null исключают)
//   - интервал issue [start_date ?? due_date, due_date ?? start_date]
//     пересекается с [from, to]: start <= to AND end >= from.
// Это даёт корректное поведение для:
//   - issue с обеими датами: классический "overlap"
//   - issue только с due_date: точка на дате due (one-day bar в UI)
//   - issue только с start_date: точка на дате start

const KNOWN_CATEGORIES: ReadonlyArray<StatusCategory> = ['new', 'indeterminate', 'done']

function normalizeCategory(raw: string): StatusCategory {
  return (KNOWN_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as StatusCategory)
    : 'indeterminate'
}

export async function listTimelineBars(query: TimelineQuery): Promise<TimelineBar[]> {
  const limit = Math.min(Math.max(query.limit ?? 1000, 1), 2000)

  // Window-фильтр: issue.start ≤ to AND issue.end ≥ from, где start/end
  // инферим coalesce'ом, чтобы не дублировать ветки SQL для single-date issues.
  // Postgres `date` сравнивается с ISO-строкой напрямую — drizzle биндит её
  // как параметр, без шаманства с типами.
  const start = sql<string>`coalesce(${issues.startDate}, ${issues.dueDate})`
  const end = sql<string>`coalesce(${issues.dueDate}, ${issues.startDate})`

  const rows = await db
    .select({
      id: issues.id,
      key: issues.key,
      summary: issues.summary,
      issueTypeId: issues.issueTypeId,
      issueTypeName: issueTypes.name,
      issueTypeIconUrl: issueTypes.iconUrl,
      statusId: issues.statusId,
      statusName: statuses.name,
      statusCategory: statuses.category,
      assigneeId: issues.assigneeId,
      assigneeDisplayName: users.displayName,
      epicJiraId: issues.epicJiraId,
      sprintId: issues.sprintId,
      sprintName: sprints.name,
      startDate: issues.startDate,
      dueDate: issues.dueDate,
      storyPoints: issues.storyPoints,
      syncState: issues.syncState,
    })
    .from(issues)
    .innerJoin(statuses, eq(statuses.id, issues.statusId))
    .innerJoin(issueTypes, eq(issueTypes.id, issues.issueTypeId))
    .leftJoin(sprints, eq(sprints.id, issues.sprintId))
    .leftJoin(users, eq(users.jiraAccountId, issues.assigneeId))
    .where(
      and(
        eq(issues.projectId, query.projectId),
        isNull(issues.deletedAt),
        // Хотя бы одна дата должна быть: оба null исключаем.
        not(and(isNull(issues.startDate), isNull(issues.dueDate))!),
        // Overlap: start ≤ to AND end ≥ from. `start`/`end` коалесятся,
        // поэтому достаточно прямого сравнения — single-date issues
        // обрабатываются той же формулой.
        lte(start, query.to),
        gte(end, query.from),
      ),
    )
    .orderBy(issues.startDate, issues.dueDate, issues.key)
    .limit(limit)

  return rows.map(
    (r): TimelineBar => ({
      id: r.id,
      key: r.key,
      summary: r.summary,
      issueTypeId: r.issueTypeId,
      issueTypeName: r.issueTypeName,
      issueTypeIconUrl: r.issueTypeIconUrl,
      statusId: r.statusId,
      statusName: r.statusName,
      statusCategory: normalizeCategory(r.statusCategory),
      assigneeId: r.assigneeId,
      assigneeDisplayName: r.assigneeDisplayName ?? null,
      epicJiraId: r.epicJiraId,
      sprintId: r.sprintId,
      sprintName: r.sprintName ?? null,
      startDate: r.startDate ?? null,
      dueDate: r.dueDate ?? null,
      storyPoints: r.storyPoints != null ? Number(r.storyPoints) : null,
      syncState: r.syncState,
    }),
  )
}
