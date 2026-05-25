import { describe, expect, test } from 'bun:test'
import {
  normalizeIssue,
  pickActiveSprintJiraId,
  projectKeyFromIssueKey,
  type NormalizeRefs,
} from './normalize-issue'
import type { JiraIssueRaw } from '@jira/client'
import type { Project } from '@db'

describe('projectKeyFromIssueKey', () => {
  test('parses uppercase keys', () => {
    expect(projectKeyFromIssueKey('ALFAIAAS-4642')).toBe('ALFAIAAS')
  })
  test('uppercases lowercase project component', () => {
    expect(projectKeyFromIssueKey('proj-12')).toBe('PROJ')
  })
  test('returns null when shape is wrong', () => {
    expect(projectKeyFromIssueKey('not-a-key')).toBe(null)
    expect(projectKeyFromIssueKey('')).toBe(null)
    expect(projectKeyFromIssueKey('PROJ')).toBe(null)
  })
})

describe('pickActiveSprintJiraId', () => {
  test('parses GreenHopper opaque strings', () => {
    const v = [
      'com.atlassian.greenhopper.service.sprint.Sprint@1[id=42,name=Sprint A,state=ACTIVE]',
      'com.atlassian.greenhopper.service.sprint.Sprint@2[id=43,name=Sprint B,state=ACTIVE]',
    ]
    expect(pickActiveSprintJiraId(v)).toBe(43)
  })
  test('parses object shape from newer Jira REST', () => {
    expect(
      pickActiveSprintJiraId([
        { id: 7, name: 'Old', state: 'closed' },
        { id: 8, name: 'Now', state: 'active' },
      ]),
    ).toBe(8)
  })
  test('returns null for empty or non-array input', () => {
    expect(pickActiveSprintJiraId(null)).toBe(null)
    expect(pickActiveSprintJiraId([])).toBe(null)
    expect(pickActiveSprintJiraId('not-an-array')).toBe(null)
  })
})

// Тесты normalizeIssue требуют только map'ов в refs (DB не дёргается).
function makeProject(): Project {
  return {
    id: 'p-uuid',
    jiraId: 'p-1',
    key: 'ALFAIAAS',
    name: 'AlfaIaaS',
    projectTypeKey: 'software',
    leadAccountId: null,
    metadata: {
      customfieldMap: {
        customfield_10372: 'Story Points',
        customfield_10375: 'Sprint',
        customfield_11582: 'Rank',
      },
      promoted: {
        storyPoints: 'customfield_10372',
        sprint: 'customfield_10375',
        rank: 'customfield_11582',
      },
    },
    etag: null,
    updatedAt: new Date(),
    syncedAt: new Date(),
  }
}

function makeRefs(): NormalizeRefs {
  const project = makeProject()
  return {
    projectByJiraId: new Map([[project.jiraId, project.id]]),
    projectByKey: new Map([[project.key, project]]),
    issueTypeByJiraId: new Map([['10001', 'it-uuid']]),
    statusByJiraId: new Map([['3', 'st-uuid']]),
    priorityByJiraId: new Map([['2', 'pr-uuid']]),
    resolutionByJiraId: new Map(),
    sprintByJiraId: new Map([[42, 'sp-uuid']]),
  }
}

describe('normalizeIssue', () => {
  test('maps a typical Jira REST issue', () => {
    const raw: JiraIssueRaw = {
      id: 'j-1',
      key: 'ALFAIAAS-100',
      fields: {
        summary: 'Test issue',
        issuetype: { id: '10001' },
        status: { id: '3' },
        priority: { id: '2' },
        labels: ['ops', 'urgent'],
        components: [{ name: 'ui' }],
        fixVersions: [],
        duedate: '2026-01-01',
        updated: '2026-05-15T10:00:00.000Z',
        customfield_10372: 5,
        customfield_10375: ['com.atlassian.greenhopper.service.sprint.Sprint@1[id=42,name=Foo,state=ACTIVE]'],
        customfield_11582: '0|i00007:',
        customfield_99999: 'free-form',
      },
    }
    const n = normalizeIssue(raw, makeRefs())
    expect(n).not.toBe(null)
    if (!n) throw new Error()
    expect(n.projectId).toBe('p-uuid')
    expect(n.key).toBe('ALFAIAAS-100')
    expect(n.summary).toBe('Test issue')
    expect(n.issueTypeId).toBe('it-uuid')
    expect(n.statusId).toBe('st-uuid')
    expect(n.priorityId).toBe('pr-uuid')
    expect(n.labels).toEqual(['ops', 'urgent'])
    expect(n.components).toEqual(['ui'])
    expect(n.storyPoints).toBe('5')
    expect(n.sprintId).toBe('sp-uuid')
    expect(n.orderingRank).toBe('0|i00007:')
    // Промотированные ключи не дублируются в customFields.
    expect(n.customFields.customfield_10372).toBeUndefined()
    expect(n.customFields.customfield_10375).toBeUndefined()
    expect(n.customFields.customfield_11582).toBeUndefined()
    expect(n.customFields.customfield_99999).toBe('free-form')
    expect(n.jiraUpdatedAt.toISOString()).toBe('2026-05-15T10:00:00.000Z')
  })
  test('returns null when project key cannot be resolved', () => {
    const raw: JiraIssueRaw = {
      id: 'j-2',
      key: 'OTHER-1',
      fields: { summary: 'x', issuetype: { id: '10001' }, status: { id: '3' } },
    }
    expect(normalizeIssue(raw, makeRefs())).toBe(null)
  })
  test('returns null when issueType or status is unknown', () => {
    const refs = makeRefs()
    const raw: JiraIssueRaw = {
      id: 'j-3',
      key: 'ALFAIAAS-1',
      fields: {
        summary: 'x',
        issuetype: { id: 'unknown' },
        status: { id: '3' },
      },
    }
    expect(normalizeIssue(raw, refs)).toBe(null)
  })
  test('extracts plain-text from ADF description', () => {
    const raw: JiraIssueRaw = {
      id: 'j-4',
      key: 'ALFAIAAS-2',
      fields: {
        summary: 's',
        issuetype: { id: '10001' },
        status: { id: '3' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Hello, world.' }] },
          ],
        },
        updated: '2026-01-01T00:00:00.000Z',
      },
    }
    const n = normalizeIssue(raw, makeRefs())
    expect(n?.descriptionText).toBe('Hello, world.')
  })
})
