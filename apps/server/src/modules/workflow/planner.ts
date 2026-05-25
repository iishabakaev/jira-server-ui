import { db, statuses, transitions } from '@db'
import type { TransitionFieldRequirement } from '@db/schema/workflow'
import { and, eq, inArray } from 'drizzle-orm'

// BFS-планировщик пути по кэшу transitions. Чистая функция `findPath`
// вынесена для тестов: ей передаётся seed adjacency, без обращения в БД.
//
// Возвращает кратчайший путь (наименьшее число шагов). При нескольких
// одинаково коротких — выбирает путь с меньшим суммарным числом обязательных
// полей (см. 14-workflow-engine.md §"Choosing among multiple paths").

export interface PathStep {
  fromStatusId: string
  toStatusId: string
  jiraTransitionId: string
  requiredFields: TransitionFieldRequirement[]
}

interface Edge extends PathStep {
  issueTypeId: string
}

// Чистая функция: BFS по предзаполненному списку рёбер. Возвращает null
// если пути нет. Тесты используют это напрямую.
export function findPath(
  edges: Edge[],
  issueTypeId: string,
  fromStatusId: string,
  toStatusId: string,
): PathStep[] | null {
  if (fromStatusId === toStatusId) return []

  // Группируем рёбра по from для быстрого выбора.
  const byFrom = new Map<string, Edge[]>()
  for (const e of edges) {
    if (e.issueTypeId !== issueTypeId) continue
    const list = byFrom.get(e.fromStatusId) ?? []
    list.push(e)
    byFrom.set(e.fromStatusId, list)
  }

  type Candidate = { node: string; path: PathStep[] }
  const queue: Candidate[] = [{ node: fromStatusId, path: [] }]
  const visited = new Set<string>([fromStatusId])
  let best: PathStep[] | null = null
  // BFS обходит уровнями; чтобы выбрать "меньше required-полей" среди
  // путей одинаковой длины, идём дальше, пока длина не превзойдёт best.
  while (queue.length) {
    const head = queue.shift()!
    if (best && head.path.length >= best.length) continue
    const outgoing = byFrom.get(head.node) ?? []
    for (const e of outgoing) {
      if (visited.has(e.toStatusId) && best === null) continue
      const nextPath = [
        ...head.path,
        {
          fromStatusId: e.fromStatusId,
          toStatusId: e.toStatusId,
          jiraTransitionId: e.jiraTransitionId,
          requiredFields: e.requiredFields,
        },
      ]
      if (e.toStatusId === toStatusId) {
        if (!best || preferred(nextPath, best)) best = nextPath
        continue
      }
      visited.add(e.toStatusId)
      queue.push({ node: e.toStatusId, path: nextPath })
    }
  }
  return best
}

function countRequired(path: PathStep[]): number {
  let n = 0
  for (const s of path) for (const f of s.requiredFields) if (f.required) n += 1
  return n
}

function preferred(a: PathStep[], b: PathStep[]): boolean {
  if (a.length < b.length) return true
  if (a.length > b.length) return false
  return countRequired(a) < countRequired(b)
}

// DB-обёртка: грузит все рёбра для типа issue и вызывает чистую findPath.
// Возвращает шаги уже с именами статусов и transition-name'ами (UI ждёт
// их в PlanPreview).
export interface ResolvedStep extends PathStep {
  fromStatusName: string
  toStatusName: string
  transitionName: string
}

export async function planPathForIssueType(
  issueTypeId: string,
  fromStatusId: string,
  toStatusId: string,
): Promise<ResolvedStep[] | null> {
  const rows = await db
    .select({
      issueTypeId: transitions.issueTypeId,
      fromStatusId: transitions.fromStatusId,
      toStatusId: transitions.toStatusId,
      jiraTransitionId: transitions.jiraTransitionId,
      name: transitions.name,
      requiredFields: transitions.requiredFields,
    })
    .from(transitions)
    .where(eq(transitions.issueTypeId, issueTypeId))

  const edges: Edge[] = rows.map((r) => ({
    issueTypeId: r.issueTypeId,
    fromStatusId: r.fromStatusId,
    toStatusId: r.toStatusId,
    jiraTransitionId: r.jiraTransitionId,
    requiredFields: r.requiredFields,
  }))

  const path = findPath(edges, issueTypeId, fromStatusId, toStatusId)
  if (path === null) return null
  if (path.length === 0) return []

  // Собираем status-names + transition-names одним запросом.
  const statusIds = new Set<string>()
  for (const s of path) {
    statusIds.add(s.fromStatusId)
    statusIds.add(s.toStatusId)
  }
  const statusRows = await db
    .select({ id: statuses.id, name: statuses.name })
    .from(statuses)
    .where(inArray(statuses.id, Array.from(statusIds)))
  const statusName = new Map(statusRows.map((s) => [s.id, s.name]))

  // transition-name есть прямо в rows; делаем lookup по (from,to).
  const trName = new Map<string, string>()
  for (const r of rows) {
    trName.set(`${r.fromStatusId}|${r.toStatusId}`, r.name)
  }

  return path.map((s) => ({
    ...s,
    fromStatusName: statusName.get(s.fromStatusId) ?? s.fromStatusId,
    toStatusName: statusName.get(s.toStatusId) ?? s.toStatusId,
    transitionName: trName.get(`${s.fromStatusId}|${s.toStatusId}`) ?? 'Transition',
  }))
}

// Сторонний use case: список ребёр fromStatusId — нужно роутам, чтобы
// быстро дать "достижимые статусы" для UI status dropdown без второго BFS.
export async function listOutgoingTransitions(issueTypeId: string, fromStatusId: string) {
  return db
    .select()
    .from(transitions)
    .where(
      and(eq(transitions.issueTypeId, issueTypeId), eq(transitions.fromStatusId, fromStatusId)),
    )
}

// BFS-обход всех достижимых статусов из fromStatusId по transitions-кэшу.
// Используется UI для multi-hop dropdown (см. features/workflow-planner):
// показываем не только one-hop options, но и все статусы, в которые можно
// прийти через цепочку транзишенов одного issue type.
export interface ReachableStatus {
  statusId: string
  statusName: string
  // 1 = достижим напрямую (one-hop), >=2 = multi-hop через wizard.
  minSteps: number
}

// Чистая BFS-функция для тестов: возвращает Map<statusId, minSteps>
// для всех вершин, достижимых из fromStatusId (исключая саму fromStatusId).
export function bfsReachable(
  edges: Array<{ fromStatusId: string; toStatusId: string }>,
  fromStatusId: string,
): Map<string, number> {
  const byFrom = new Map<string, string[]>()
  for (const r of edges) {
    const list = byFrom.get(r.fromStatusId) ?? []
    list.push(r.toStatusId)
    byFrom.set(r.fromStatusId, list)
  }

  const dist = new Map<string, number>()
  const queue: string[] = [fromStatusId]
  dist.set(fromStatusId, 0)
  while (queue.length) {
    const node = queue.shift()!
    const d = dist.get(node)!
    for (const next of byFrom.get(node) ?? []) {
      if (dist.has(next)) continue
      dist.set(next, d + 1)
      queue.push(next)
    }
  }
  dist.delete(fromStatusId)
  return dist
}

export async function allReachableStatuses(
  issueTypeId: string,
  fromStatusId: string,
): Promise<ReachableStatus[]> {
  const rows = await db
    .select({
      fromStatusId: transitions.fromStatusId,
      toStatusId: transitions.toStatusId,
    })
    .from(transitions)
    .where(eq(transitions.issueTypeId, issueTypeId))

  const dist = bfsReachable(rows, fromStatusId)
  const ids = Array.from(dist.keys())
  if (ids.length === 0) return []

  const statusRows = await db
    .select({ id: statuses.id, name: statuses.name })
    .from(statuses)
    .where(inArray(statuses.id, ids))
  const nameById = new Map(statusRows.map((s) => [s.id, s.name]))

  return ids
    .map<ReachableStatus>((id) => ({
      statusId: id,
      statusName: nameById.get(id) ?? id,
      minSteps: dist.get(id)!,
    }))
    .sort((a, b) => a.minSteps - b.minSteps || a.statusName.localeCompare(b.statusName))
}
