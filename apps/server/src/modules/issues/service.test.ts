import { describe, expect, it } from 'bun:test'
import type { IssueSummary } from './schema'
import { groupIssues } from './service'

// Юнит-тест для чистой функции группировки. Прямая БД и Drizzle тут
// не нужны — мы валидируем лишь раскладку плоского списка по группам.

function makeIssue(over: Partial<IssueSummary>): IssueSummary {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    key: 'TEST-1',
    jiraId: '1',
    projectId: '00000000-0000-0000-0000-0000000000aa',
    summary: 'sample',
    issueTypeId: '00000000-0000-0000-0000-0000000000bb',
    issueTypeName: 'Task',
    issueTypeIconUrl: null,
    isSubtask: false,
    statusId: '00000000-0000-0000-0000-0000000000cc',
    statusName: 'To Do',
    statusCategory: 'new',
    priorityId: null,
    priorityName: null,
    priorityIconUrl: null,
    assigneeId: null,
    assigneeDisplayName: null,
    reporterId: null,
    parentJiraId: null,
    epicJiraId: null,
    sprintId: null,
    sprintName: null,
    labels: [],
    components: [],
    fixVersions: [],
    dueDate: null,
    startDate: null,
    storyPoints: null,
    orderingRank: null,
    jiraUpdatedAt: '2026-05-15T00:00:00.000Z',
    syncState: 'synced',
    ...over,
  }
}

describe('groupIssues', () => {
  it('groups by status, preserving first-seen order', () => {
    const items = [
      makeIssue({ id: '1', statusId: 's1', statusName: 'To Do' }),
      makeIssue({ id: '2', statusId: 's2', statusName: 'In Progress' }),
      makeIssue({ id: '3', statusId: 's1', statusName: 'To Do' }),
      makeIssue({ id: '4', statusId: 's2', statusName: 'In Progress' }),
    ]
    const groups = groupIssues(items, 'status')
    expect(groups).toHaveLength(2)
    expect(groups[0]!.groupId).toBe('s1')
    expect(groups[0]!.groupLabel).toBe('To Do')
    expect(groups[0]!.count).toBe(2)
    expect(groups[1]!.groupId).toBe('s2')
    expect(groups[1]!.count).toBe(2)
  })

  it('groups by assignee, prefers display name and falls back to id', () => {
    const items = [
      makeIssue({ id: '1', assigneeId: 'alice', assigneeDisplayName: 'Alice A.' }),
      makeIssue({ id: '2', assigneeId: null }),
      makeIssue({ id: '3', assigneeId: 'alice', assigneeDisplayName: 'Alice A.' }),
      makeIssue({ id: '4', assigneeId: 'bob', assigneeDisplayName: null }),
    ]
    const groups = groupIssues(items, 'assignee')
    expect(groups).toHaveLength(3)
    const labels = groups.map((g) => g.groupLabel).sort()
    expect(labels).toEqual(['Alice A.', 'Unassigned', 'bob'].sort())
    const unassigned = groups.find((g) => g.groupId === null)
    expect(unassigned?.count).toBe(1)
    expect(unassigned?.groupLabel).toBe('Unassigned')
  })

  it('groups by epic, "No epic" bucket for null epicJiraId', () => {
    const items = [
      makeIssue({ id: '1', epicJiraId: 'EPIC-100' }),
      makeIssue({ id: '2', epicJiraId: null }),
      makeIssue({ id: '3', epicJiraId: 'EPIC-100' }),
    ]
    const groups = groupIssues(items, 'epic')
    expect(groups).toHaveLength(2)
    const noEpic = groups.find((g) => g.groupId === null)
    expect(noEpic?.groupLabel).toBe('No epic')
    expect(noEpic?.count).toBe(1)
  })

  it('groups by priority, falls back to "No priority" for null priorityId', () => {
    const items = [
      makeIssue({ id: '1', priorityId: 'p1', priorityName: 'High' }),
      makeIssue({ id: '2', priorityId: null }),
    ]
    const groups = groupIssues(items, 'priority')
    expect(groups).toHaveLength(2)
    const noPriority = groups.find((g) => g.groupId === null)
    expect(noPriority?.groupLabel).toBe('No priority')
    const high = groups.find((g) => g.groupId === 'p1')
    expect(high?.groupLabel).toBe('High')
  })

  it('returns empty array when input is empty', () => {
    expect(groupIssues([], 'status')).toEqual([])
  })

  it('keeps card order within a bucket (input order preserved)', () => {
    const items = [
      makeIssue({ id: 'a', statusId: 's1' }),
      makeIssue({ id: 'b', statusId: 's1' }),
      makeIssue({ id: 'c', statusId: 's1' }),
    ]
    const [g] = groupIssues(items, 'status')
    expect(g!.items.map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })
})
