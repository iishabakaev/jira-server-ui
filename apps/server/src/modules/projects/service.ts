import { db, issues } from '@db'
import { inArray } from 'drizzle-orm'
import type { GroupBy, IssueFilter, IssueSummary, StatusCategory } from '../issues/schema'
import { groupIssues, issuesService } from '../issues/service'
import {
  getProjectById,
  listProjectIssueTypes,
  listProjectSprints,
  listProjectStatuses,
  listProjects as repoListProjects,
} from './queries'
import type {
  ProjectDetail,
  ProjectKanbanColumn,
  ProjectKanbanResponse,
  ProjectListItem,
  ProjectSprint,
} from './schema'

// Сервис projects: наш «board-free» kanban. Колонки строятся из statuses,
// присутствующих у issues проекта; никаких обращений к Jira Agile API.

export const projectsService = {
  async list(text: string | null): Promise<ProjectListItem[]> {
    const rows = await repoListProjects(text)
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      lastUpdatedAt: r.lastUpdatedAt ? r.lastUpdatedAt.toISOString() : null,
      lastFullSyncAt: r.lastFullSyncAt ? r.lastFullSyncAt.toISOString() : null,
    }))
  },

  async sprints(projectId: string): Promise<ProjectSprint[] | null> {
    const project = await getProjectById(projectId)
    if (!project) return null
    const rows = await listProjectSprints(project.id)
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      state: (['active', 'future', 'closed'] as const).includes(
        r.state as 'active' | 'future' | 'closed',
      )
        ? (r.state as 'active' | 'future' | 'closed')
        : 'closed',
      startDate: r.startDate ? r.startDate.toISOString() : null,
      endDate: r.endDate ? r.endDate.toISOString() : null,
    }))
  },

  async detail(id: string): Promise<ProjectDetail | null> {
    const project = await getProjectById(id)
    if (!project) return null
    const availableIssueTypes = await listProjectIssueTypes(project.id)
    return {
      id: project.id,
      key: project.key,
      name: project.name,
      availableIssueTypes,
    }
  },

  // Раскладывает issues по колонкам нашего kanban'а. Для groupBy=status
  // колонки — все распознанные статусы проекта (даже если в окне фильтра
  // нет ни одной карточки в колонке, она пустая, но видна — это нужно
  // как drop-target для DnD).
  async kanban(
    projectId: string,
    rawFilter: Omit<IssueFilter, 'projectIds' | 'boardId'>,
  ): Promise<ProjectKanbanResponse | null> {
    const project = await getProjectById(projectId)
    if (!project) return null

    const groupBy: GroupBy = rawFilter.groupBy ?? 'status'
    const filter: IssueFilter = {
      ...rawFilter,
      projectIds: [project.id],
      groupBy,
    }
    const { items, cursor } = await issuesService.list(filter)

    if (groupBy !== 'status') {
      // Динамические группировки (assignee/epic/priority/sprint) — пустые
      // группы не предсказуемы, поэтому строим только из присутствующих.
      const groups = groupIssues(items, groupBy)

      // ─── Эпики: подменяем groupId/Label на key/summary эпика ───
      // groupBy=epic кладёт в groupId сырое значение epicJiraId. UI
      // должен показывать «PROJ-123 · Epic summary», а DnD/identity —
      // опираться на uuid issue-эпика. Лукапим epic-карточки одной партией.
      const epicByJiraId = new Map<
        string,
        { id: string; key: string; summary: string; issueTypeName: string }
      >()
      if (groupBy === 'epic') {
        const epicJiraIds = Array.from(
          new Set(groups.map((g) => g.groupId).filter((x): x is string => Boolean(x))),
        )
        if (epicJiraIds.length > 0) {
          const epicRows = await db
            .select({
              id: issues.id,
              key: issues.key,
              jiraId: issues.jiraId,
              summary: issues.summary,
            })
            .from(issues)
            .where(inArray(issues.jiraId, epicJiraIds))
          for (const r of epicRows) {
            epicByJiraId.set(r.jiraId, {
              id: r.id,
              key: r.key,
              summary: r.summary,
              issueTypeName: 'Epic',
            })
          }
        }
      }

      const dynamic = groups.map<ProjectKanbanColumn>((g) => {
        if (groupBy === 'epic' && g.groupId) {
          const epic = epicByJiraId.get(g.groupId)
          if (epic) {
            return {
              name: `${epic.key} · ${epic.summary}`,
              groupId: epic.id,
              statusIds: [],
              statusCategory: null,
              count: g.count,
              items: g.items,
            }
          }
        }
        return {
          name: g.groupLabel,
          groupId: g.groupId,
          statusIds: [],
          statusCategory: null,
          count: g.count,
          items: g.items,
        }
      })
      return { projectId: project.id, groupBy, columns: dynamic, cursor }
    }

    // ─── Группировка по статусу ───
    // Колонки = все статусы, встреченные у этого проекта (см. queries.ts:
    // listProjectStatuses). Каждая колонка отдельная — мы не схлопываем
    // одинаковые имена в одну, как делал Jira board.config, чтобы поведение
    // оставалось предсказуемым.
    const projectStatuses = await listProjectStatuses(project.id)

    const colByStatusId = new Map<string, ProjectKanbanColumn>()
    const columns: ProjectKanbanColumn[] = projectStatuses.map((s) => {
      const col: ProjectKanbanColumn = {
        name: s.name,
        groupId: s.id,
        statusIds: [s.id],
        statusCategory: normalizeCategory(s.category),
        count: 0,
        items: [],
      }
      colByStatusId.set(s.id, col)
      return col
    })

    const otherItems: IssueSummary[] = []
    for (const item of items) {
      const col = colByStatusId.get(item.statusId)
      if (col) {
        col.items.push(item)
        col.count += 1
      } else {
        // Карточка попала в статус, который ещё не «известен» kanban'у —
        // листим в Other. На практике это значит, что filter фильтрует
        // окно ужe, чем listProjectStatuses (например, по labels), и status
        // не был ни у одной из выборки. На отображение колонок не влияет.
        otherItems.push(item)
      }
    }

    const other: ProjectKanbanColumn | undefined = otherItems.length
      ? {
          name: 'Other',
          groupId: null,
          statusIds: [],
          statusCategory: null,
          count: otherItems.length,
          items: otherItems,
        }
      : undefined

    return { projectId: project.id, groupBy, columns, other, cursor }
  },
}

const KNOWN_CATEGORIES: StatusCategory[] = ['new', 'indeterminate', 'done']
function normalizeCategory(raw: string): StatusCategory {
  return (KNOWN_CATEGORIES as readonly string[]).includes(raw)
    ? (raw as StatusCategory)
    : 'indeterminate'
}
