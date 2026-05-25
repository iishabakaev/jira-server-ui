import { db, issues, projects, issueTypes, statuses, priorities, resolutions, sprints, type Project, type Issue } from '@db'
import { eq, inArray, sql } from 'drizzle-orm'
import type { JiraIssueRaw } from '@jira/client'

// Нормализатор issue: Jira REST payload → строка таблицы `issues`.
//
// Все служебные ссылки (status_id, issue_type_id, priority_id, resolution_id,
// sprint_id) резолвятся по jira_id из соответствующих таблиц. Это значит,
// что для корректного апсёрта issue нужно предварительно прогнать
// `refresh-metadata` для всех значений, иначе строка будет отброшена.
//
// Кастом-поля раскладываются по двум целям:
//   - "Промотированные" (story_points, sprint, epic_link, epic_name, rank)
//     попадают в типизированные колонки. Маппинг customfield-id → имя
//     лежит в projects.metadata.promoted.
//   - Всё остальное сохраняется как JSONB `custom_fields`.

interface FieldsBag {
  summary?: string | null
  description?: unknown
  issuetype?: { id: string } | null
  status?: { id: string } | null
  priority?: { id: string } | null
  resolution?: { id: string } | null
  reporter?: { name?: string; accountId?: string } | null
  assignee?: { name?: string; accountId?: string } | null
  parent?: { id: string; key: string } | null
  labels?: string[]
  components?: Array<{ name: string }>
  fixVersions?: Array<{ name: string }>
  duedate?: string | null
  // Поле появляется только при expand=changelog или *all; на скан-пути
  // отсутствует и не используется.
  created?: string
  updated?: string
  timeestimate?: number | null
  timespent?: number | null
  [k: string]: unknown
}

export interface NormalizedIssue {
  jiraId: string
  projectId: string
  key: string
  summary: string
  descriptionText: string | null
  description: unknown
  issueTypeId: string
  statusId: string
  priorityId: string | null
  resolutionId: string | null
  reporterId: string | null
  assigneeId: string | null
  parentJiraId: string | null
  epicJiraId: string | null
  sprintId: string | null
  labels: string[]
  components: string[]
  fixVersions: string[]
  dueDate: string | null
  startDate: string | null
  storyPoints: string | null
  timeEstimateS: number | null
  timeSpentS: number | null
  customFields: Record<string, unknown>
  orderingRank: string | null
  jiraUpdatedAt: Date
}

export interface NormalizeRefs {
  projectByJiraId: Map<string, string>
  projectByKey: Map<string, Project>
  issueTypeByJiraId: Map<string, string>
  statusByJiraId: Map<string, string>
  priorityByJiraId: Map<string, string>
  resolutionByJiraId: Map<string, string>
  sprintByJiraId: Map<number, string>
}

// Заполняет справочники из БД одним батчем; вызывается на старте полной/
// инкрементальной синхронизации и затем переиспользуется на всю партию.
export async function loadRefs(): Promise<NormalizeRefs> {
  const [prjRows, itRows, stRows, prRows, rsRows, spRows] = await Promise.all([
    db.select().from(projects),
    db.select({ id: issueTypes.id, jiraId: issueTypes.jiraId }).from(issueTypes),
    db.select({ id: statuses.id, jiraId: statuses.jiraId }).from(statuses),
    db.select({ id: priorities.id, jiraId: priorities.jiraId }).from(priorities),
    db.select({ id: resolutions.id, jiraId: resolutions.jiraId }).from(resolutions),
    db.select({ id: sprints.id, jiraId: sprints.jiraId }).from(sprints),
  ])
  const projectByJiraId = new Map<string, string>()
  const projectByKey = new Map<string, Project>()
  for (const r of prjRows) {
    projectByJiraId.set(r.jiraId, r.id)
    projectByKey.set(r.key, r)
  }
  return {
    projectByJiraId,
    projectByKey,
    issueTypeByJiraId: new Map(itRows.map((r) => [r.jiraId, r.id])),
    statusByJiraId: new Map(stRows.map((r) => [r.jiraId, r.id])),
    priorityByJiraId: new Map(prRows.map((r) => [r.jiraId, r.id])),
    resolutionByJiraId: new Map(rsRows.map((r) => [r.jiraId, r.id])),
    sprintByJiraId: new Map(spRows.map((r) => [r.jiraId, r.id])),
  }
}

// Резолвит проект-проектную ссылку по issue.key (PROJ-123 → PROJ).
export function projectKeyFromIssueKey(key: string): string | null {
  const m = key.match(/^([A-Z][A-Z0-9_]*)-\d+$/i)
  const head = m?.[1]
  return head ? head.toUpperCase() : null
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

// Достаёт плоский текст из ADF для FTS-фильтров. На M2 — лучшее усилие:
// рекурсивно собираем все text-ноды. Полноценную (де)сериализацию
// делает lib/adf.ts в редакторе issue.
function adfToPlain(adf: unknown): string | null {
  if (!adf || typeof adf !== 'object') return null
  const out: string[] = []
  const stack: unknown[] = [adf]
  while (stack.length) {
    const node = stack.pop()
    if (!node || typeof node !== 'object') continue
    const obj = node as Record<string, unknown>
    if (obj.type === 'text' && typeof obj.text === 'string') {
      out.push(obj.text)
    }
    if (Array.isArray(obj.content)) {
      for (const child of obj.content) stack.push(child)
    }
  }
  return out.length ? out.join(' ').trim() || null : null
}

// Извлекает спринт из значения customfield_sprint. Jira Server отдаёт массив
// либо текстовых GreenHopper-строк ("com.atlassian.greenhopper...[id=123,..]")
// либо уже разобранных объектов { id, name, state }.
export function pickActiveSprintJiraId(raw: unknown): number | null {
  if (!Array.isArray(raw) || !raw.length) return null
  // Идём с конца — последний в массиве в Jira-агиле обычно "самый актуальный".
  for (let i = raw.length - 1; i >= 0; i -= 1) {
    const item = raw[i]
    if (item && typeof item === 'object' && 'id' in item) {
      const id = (item as { id: unknown }).id
      const n = typeof id === 'number' ? id : Number.parseInt(String(id), 10)
      if (Number.isFinite(n)) return n
    }
    if (typeof item === 'string') {
      const m = item.match(/\[.*?id=(\d+)/)
      const n = m?.[1]
      if (n) return Number.parseInt(n, 10)
    }
  }
  return null
}

export function normalizeIssue(raw: JiraIssueRaw, refs: NormalizeRefs): NormalizedIssue | null {
  const f = (raw.fields ?? {}) as FieldsBag
  const projectKey = projectKeyFromIssueKey(raw.key)
  const project = projectKey ? refs.projectByKey.get(projectKey) : undefined
  if (!project) return null

  const issueTypeId = f.issuetype?.id ? refs.issueTypeByJiraId.get(f.issuetype.id) : undefined
  const statusId = f.status?.id ? refs.statusByJiraId.get(f.status.id) : undefined
  if (!issueTypeId || !statusId) return null

  const priorityId = f.priority?.id
    ? refs.priorityByJiraId.get(f.priority.id) ?? null
    : null
  const resolutionId = f.resolution?.id
    ? refs.resolutionByJiraId.get(f.resolution.id) ?? null
    : null

  const promoted = project.metadata.promoted ?? {}
  const customFields: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith('customfield_')) continue
    if (v === null || v === undefined) continue
    customFields[k] = v
  }

  const storyPointsRaw = promoted.storyPoints ? f[promoted.storyPoints] : null
  const storyPoints =
    typeof storyPointsRaw === 'number' && Number.isFinite(storyPointsRaw)
      ? String(storyPointsRaw)
      : null

  const orderingRank = promoted.rank ? asString(f[promoted.rank]) : null
  const epicJiraId = promoted.epicLink ? asString(f[promoted.epicLink]) : null
  const sprintJiraId = promoted.sprint ? pickActiveSprintJiraId(f[promoted.sprint]) : null
  const sprintId = sprintJiraId != null ? refs.sprintByJiraId.get(sprintJiraId) ?? null : null

  // Убираем промотированные ключи из дженерик-бэга, чтобы не дублировать.
  for (const k of Object.values(promoted)) {
    if (typeof k === 'string') delete customFields[k]
  }

  const updatedRaw = asString(f.updated)
  if (!updatedRaw) return null // защита: без updated нельзя корректно делать out-of-order check
  const jiraUpdatedAt = new Date(updatedRaw)
  if (Number.isNaN(jiraUpdatedAt.getTime())) return null

  const reporterId = f.reporter?.accountId ?? f.reporter?.name ?? null
  const assigneeId = f.assignee?.accountId ?? f.assignee?.name ?? null

  return {
    jiraId: raw.id,
    projectId: project.id,
    key: raw.key.toUpperCase(),
    summary: typeof f.summary === 'string' ? f.summary : '',
    descriptionText: adfToPlain(f.description),
    description: (f.description as object | null) ?? null,
    issueTypeId,
    statusId,
    priorityId,
    resolutionId,
    reporterId,
    assigneeId,
    parentJiraId: f.parent?.id ?? null,
    epicJiraId,
    sprintId,
    labels: Array.isArray(f.labels) ? (f.labels.filter((x) => typeof x === 'string') as string[]) : [],
    components: Array.isArray(f.components)
      ? f.components.map((c) => c?.name).filter((n): n is string => typeof n === 'string')
      : [],
    fixVersions: Array.isArray(f.fixVersions)
      ? f.fixVersions.map((c) => c?.name).filter((n): n is string => typeof n === 'string')
      : [],
    dueDate: asString(f.duedate),
    startDate: null,
    storyPoints,
    timeEstimateS: asNumber(f.timeestimate),
    timeSpentS: asNumber(f.timespent),
    customFields,
    orderingRank,
    jiraUpdatedAt,
  }
}

// Атомарный upsert по jira_id одним INSERT … ON CONFLICT DO UPDATE WHERE.
// Раньше read-then-write имел TOCTOU между webhook и incremental-sync
// (architect+code review). Условие WHERE:
//   excluded.jira_updated_at > issues.jira_updated_at         — out-of-order check
//   AND issues.sync_state NOT IN ('pending','pushing')        — не затираем локальные мутации
export async function upsertIssue(n: NormalizedIssue): Promise<boolean> {
  const values = {
    jiraId: n.jiraId,
    projectId: n.projectId,
    key: n.key,
    summary: n.summary,
    descriptionText: n.descriptionText,
    description: n.description as Issue['description'],
    issueTypeId: n.issueTypeId,
    statusId: n.statusId,
    priorityId: n.priorityId,
    resolutionId: n.resolutionId,
    reporterId: n.reporterId,
    assigneeId: n.assigneeId,
    parentJiraId: n.parentJiraId,
    epicJiraId: n.epicJiraId,
    sprintId: n.sprintId,
    labels: n.labels,
    components: n.components,
    fixVersions: n.fixVersions,
    dueDate: n.dueDate,
    storyPoints: n.storyPoints,
    timeEstimateS: n.timeEstimateS,
    timeSpentS: n.timeSpentS,
    customFields: n.customFields,
    orderingRank: n.orderingRank,
    jiraUpdatedAt: n.jiraUpdatedAt,
    syncedAt: new Date(),
    syncState: 'synced' as const,
  }
  const result = await db
    .insert(issues)
    .values(values)
    .onConflictDoUpdate({
      target: issues.jiraId,
      set: {
        projectId: n.projectId,
        key: n.key,
        summary: n.summary,
        descriptionText: n.descriptionText,
        description: n.description as Issue['description'],
        issueTypeId: n.issueTypeId,
        statusId: n.statusId,
        priorityId: n.priorityId,
        resolutionId: n.resolutionId,
        reporterId: n.reporterId,
        assigneeId: n.assigneeId,
        parentJiraId: n.parentJiraId,
        epicJiraId: n.epicJiraId,
        sprintId: n.sprintId,
        labels: n.labels,
        components: n.components,
        fixVersions: n.fixVersions,
        dueDate: n.dueDate,
        storyPoints: n.storyPoints,
        timeEstimateS: n.timeEstimateS,
        timeSpentS: n.timeSpentS,
        customFields: n.customFields,
        orderingRank: n.orderingRank,
        jiraUpdatedAt: n.jiraUpdatedAt,
        syncedAt: new Date(),
        syncState: 'synced',
        syncError: null,
        updatedAt: new Date(),
      },
      setWhere: sql`excluded.jira_updated_at > ${issues.jiraUpdatedAt}
        AND ${issues.syncState} not in ('pending', 'pushing')`,
    })
    .returning({ id: issues.id })
  return result.length > 0
}

// Soft-delete по jira_id. Возвращает количество затронутых строк.
export async function softDeleteIssueByJiraId(jiraId: string): Promise<number> {
  const rows = await db
    .update(issues)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(issues.jiraId, jiraId))
    .returning({ id: issues.id })
  return rows.length
}

// Возвращает существующие jiraId среди указанных — для эффективного диффа
// в reconcile'е. Сохранён здесь, потому что используется и full-sync'ом.
export async function existingJiraIdsAmong(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await db.select({ jiraId: issues.jiraId }).from(issues).where(inArray(issues.jiraId, ids))
  return new Set(rows.map((r) => r.jiraId))
}
