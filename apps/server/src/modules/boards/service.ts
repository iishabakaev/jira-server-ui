import type { Board } from '@db'
import type { GroupBy, IssueFilter, IssueSummary } from '../issues/schema'
import { groupIssues, issuesService } from '../issues/service'
import {
  getBoardById,
  listProjectIssueTypes,
  listBoards as repoListBoards,
  statusUuidsByJiraIds,
} from './queries'
import type { BoardDetail, BoardKanbanColumn, BoardKanbanResponse, BoardListItem } from './schema'

// Сервис boards. Важная инвариант: контракт API возвращает uuid статусов,
// но board.config из Jira хранит jira_id (string). Резолвим один раз
// внутри сервиса, чтобы клиент видел только uuid.

function toListItem(b: Board): BoardListItem {
  return {
    id: b.id,
    jiraId: b.jiraId,
    name: b.name,
    type: b.type,
    projectId: b.projectId,
  }
}

async function buildColumns(config: Board['config']): Promise<{
  columns: BoardKanbanColumn[]
  jiraIdToUuid: Map<string, string>
  uuidToColumn: Map<string, BoardKanbanColumn>
}> {
  const allJiraIds = config.columns.flatMap((c) => c.statusIds)
  const jiraIdToUuid = await statusUuidsByJiraIds(allJiraIds)

  const columns: BoardKanbanColumn[] = []
  const uuidToColumn = new Map<string, BoardKanbanColumn>()

  for (const col of config.columns) {
    const statusIds = col.statusIds
      .map((j) => jiraIdToUuid.get(j))
      .filter((x): x is string => Boolean(x))
    const view: BoardKanbanColumn = {
      name: col.name,
      // Группа = первая (она же главная) status uuid колонки. Null —
      // только для синтетического "Other" ниже. Это даёт стабильный
      // React-key и доступ к id для DnD в M5.
      groupId: statusIds[0] ?? null,
      statusIds,
      wipLimit: col.wipLimit ?? null,
      count: 0,
      items: [],
    }
    columns.push(view)
    for (const sid of statusIds) uuidToColumn.set(sid, view)
  }

  return { columns, jiraIdToUuid, uuidToColumn }
}

export const boardsService = {
  async list(): Promise<BoardListItem[]> {
    const rows = await repoListBoards()
    return rows.map(toListItem)
  },

  async detail(id: string): Promise<BoardDetail | null> {
    const board = await getBoardById(id)
    if (!board) return null
    const { columns } = await buildColumns(board.config)
    // Список доступных issue-types подгружаем здесь, а не отдельным
    // эндпойнтом: quick-create живёт на kanban-странице, которая уже
    // тянет board detail. Лишний HTTP-roundtrip ни к чему.
    const availableIssueTypes = board.projectId ? await listProjectIssueTypes(board.projectId) : []
    return {
      id: board.id,
      jiraId: board.jiraId,
      name: board.name,
      type: board.type,
      projectId: board.projectId,
      filterJql: board.filterJql,
      rankCustomFieldId: board.config.rankCustomFieldId ?? null,
      // Идём по индексу, а не по name — конфиг доски в Jira теоретически
      // может содержать одноимённые колонки.
      columns: columns.map((c, i) => ({
        name: c.name,
        statusJiraIds: board.config.columns[i]?.statusIds ?? [],
        statusIds: c.statusIds,
        wipLimit: c.wipLimit,
      })),
      defaults: board.config.defaults ?? {},
      availableIssueTypes,
    }
  },

  // Раскладывает карточки по колонкам board (groupBy=status), либо строит
  // динамические группы (groupBy ≠ status) поверх board.projectId.
  async kanban(
    id: string,
    rawFilter: Omit<IssueFilter, 'projectIds' | 'boardId'>,
  ): Promise<BoardKanbanResponse | null> {
    const board = await getBoardById(id)
    if (!board) return null

    const groupBy: GroupBy = rawFilter.groupBy ?? 'status'
    const projectIds = board.projectId ? [board.projectId] : undefined
    const filter: IssueFilter = {
      ...rawFilter,
      projectIds,
      boardId: board.id,
      groupBy,
    }
    const { items, cursor } = await issuesService.list(filter)

    if (groupBy !== 'status') {
      const dynamic = groupIssues(items, groupBy).map<BoardKanbanColumn>((g) => ({
        name: g.groupLabel,
        groupId: g.groupId,
        statusIds: [],
        wipLimit: null,
        count: g.count,
        items: g.items,
      }))
      return { boardId: board.id, groupBy, columns: dynamic, cursor }
    }

    const { columns, uuidToColumn } = await buildColumns(board.config)
    const otherItems: IssueSummary[] = []
    for (const item of items) {
      const col = uuidToColumn.get(item.statusId)
      if (col) {
        col.items.push(item)
        col.count += 1
      } else {
        otherItems.push(item)
      }
    }
    const other: BoardKanbanColumn | undefined = otherItems.length
      ? {
          name: 'Other',
          groupId: null,
          statusIds: [],
          wipLimit: null,
          count: otherItems.length,
          items: otherItems,
        }
      : undefined

    return { boardId: board.id, groupBy, columns, other, cursor }
  },
}
