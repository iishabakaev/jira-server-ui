import { getIssueByKeyOrId, getIssueDetail, listActivity, listIssues } from './queries'
import type { GroupBy, IssueFilter, IssueGroup, IssueSummary } from './schema'

// Сервис issues. На M4 модуль read-only:
//   - list → пагинированный список карточек по фильтру
//   - get  → полная сводка одной карточки (description-эндпойнт появится в M6)
//   - group → раскладывает плоский список карточек по группам для kanban-ответа
// Мутации (patch, transition, batch-rank) приедут в milestone 5.

function groupKey(item: IssueSummary, by: GroupBy): { id: string | null; label: string } {
  switch (by) {
    case 'status':
      return { id: item.statusId, label: item.statusName }
    case 'assignee':
      return item.assigneeId
        ? { id: item.assigneeId, label: item.assigneeDisplayName ?? item.assigneeId }
        : { id: null, label: 'Unassigned' }
    case 'epic':
      return item.epicJiraId
        ? { id: item.epicJiraId, label: item.epicJiraId }
        : { id: null, label: 'No epic' }
    case 'priority':
      return item.priorityId
        ? { id: item.priorityId, label: item.priorityName ?? 'Priority' }
        : { id: null, label: 'No priority' }
    case 'sprint':
      return item.sprintId
        ? { id: item.sprintId, label: item.sprintName ?? item.sprintId }
        : { id: null, label: 'Backlog' }
  }
}

export function groupIssues(items: IssueSummary[], by: GroupBy): IssueGroup[] {
  // Map с порядком вставки сохраняет первый порядок появления группы;
  // дальнейшая стабильная сортировка — задача роута/каркаса (board.config).
  const buckets = new Map<string, IssueGroup>()
  for (const item of items) {
    const { id, label } = groupKey(item, by)
    const key = id ?? `__null__:${label}`
    let g = buckets.get(key)
    if (!g) {
      g = { groupId: id, groupLabel: label, count: 0, items: [] }
      buckets.set(key, g)
    }
    g.items.push(item)
    g.count += 1
  }
  return Array.from(buckets.values())
}

export const issuesService = {
  async list(filter: IssueFilter) {
    return listIssues(filter)
  },
  async get(keyOrId: string) {
    return getIssueByKeyOrId(keyOrId)
  },
  async getDetail(keyOrId: string) {
    return getIssueDetail(keyOrId)
  },
  async listActivity(issueId: string) {
    return listActivity(issueId)
  },
}
