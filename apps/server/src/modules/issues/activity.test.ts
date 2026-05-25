import { describe, expect, it } from 'bun:test'
import { type ActivityRow, collectStatusRefs, renderActivity } from './activity'

// Юнит-тест чистого рендерера activity-фида. БД не подключаем — проверяем
// форматирование строк, безопасность к мусору в payload и игнорирование
// неподдерживаемых outbox kinds.

function row(over: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    kind: 'issue.update',
    payload: {},
    userId: '00000000-0000-0000-0000-000000000001',
    attempts: 0,
    state: 'pending',
    lastError: null,
    createdAt: new Date('2026-05-16T10:00:00.000Z'),
    ...over,
  }
}

describe('renderActivity', () => {
  it('renders issue.create with summary truncation', () => {
    const entry = renderActivity(
      row({
        kind: 'issue.create',
        payload: { summary: 'Allow social login via Google and GitHub identity providers' },
      }),
      new Map(),
    )
    expect(entry).not.toBeNull()
    expect(entry!.kind).toBe('issue.create')
    expect(entry!.summaries[0]).toContain('created with summary')
  })

  it('renders issue.update patch as per-field summaries', () => {
    const entry = renderActivity(
      row({
        kind: 'issue.update',
        payload: { patch: { summary: 'New title', assigneeId: null, labels: ['a', 'b'] } },
      }),
      new Map(),
    )
    expect(entry).not.toBeNull()
    expect(entry!.summaries).toEqual(
      expect.arrayContaining(['set summary to New title', 'cleared assignee', 'set labels to [2]']),
    )
  })

  it('renders issue.transition with target status name when available', () => {
    const statusMap = new Map<string, string>([['s-done', 'Closed']])
    const entry = renderActivity(
      row({
        kind: 'issue.transition',
        payload: { toStatusId: 's-done', jiraTransitionId: '31' },
      }),
      statusMap,
    )
    expect(entry!.summaries).toEqual(['moved to Closed'])
  })

  it('falls back to "changed status" when status name is unknown', () => {
    const entry = renderActivity(
      row({
        kind: 'issue.transition',
        payload: { toStatusId: 'unknown', jiraTransitionId: '31' },
      }),
      new Map(),
    )
    expect(entry!.summaries).toEqual(['changed status'])
  })

  it('renders rank-and-transition with status when present', () => {
    const statusMap = new Map<string, string>([['s-prog', 'In Progress']])
    const entry = renderActivity(
      row({
        kind: 'issue.rank-and-transition',
        payload: { toStatusId: 's-prog', orderingRank: '0|a' },
      }),
      statusMap,
    )
    expect(entry!.summaries).toEqual(['reordered and moved to In Progress'])
  })

  it('renders plain rank as reorder', () => {
    const entry = renderActivity(
      row({
        kind: 'issue.rank',
        payload: { orderingRank: '0|a', toStatusId: null },
      }),
      new Map(),
    )
    expect(entry!.summaries).toEqual(['reordered card'])
  })

  it('returns null for unsupported kinds (comment events live in the comments tab)', () => {
    const entry = renderActivity(row({ kind: 'comment.create' }), new Map())
    expect(entry).toBeNull()
  })

  it('survives malformed payloads without throwing', () => {
    const entry = renderActivity(row({ kind: 'issue.update', payload: null }), new Map())
    expect(entry!.summaries).toEqual(['updated issue'])
  })

  it('exposes state, attempts, and lastError to the UI', () => {
    const entry = renderActivity(
      row({
        kind: 'issue.update',
        state: 'error',
        attempts: 3,
        lastError: 'HTTP 502 from Jira',
      }),
      new Map(),
    )
    expect(entry!.state).toBe('error')
    expect(entry!.attempts).toBe(3)
    expect(entry!.lastError).toBe('HTTP 502 from Jira')
  })

  it('handles update with empty patch', () => {
    const entry = renderActivity(row({ kind: 'issue.update', payload: { patch: {} } }), new Map())
    expect(entry!.summaries).toEqual(['updated issue'])
  })

  it('summarises customFields count', () => {
    const entry = renderActivity(
      row({
        kind: 'issue.update',
        payload: { patch: { customFields: { customfield_10010: 'X' } } },
      }),
      new Map(),
    )
    expect(entry!.summaries).toContain('updated 1 custom field')
  })
})

describe('collectStatusRefs', () => {
  it('returns referenced status ids from transition payloads', () => {
    const refs = collectStatusRefs([
      { kind: 'issue.transition', payload: { toStatusId: 's1' } },
      { kind: 'issue.rank-and-transition', payload: { toStatusId: 's2' } },
      { kind: 'issue.update', payload: { patch: { assigneeId: 'a' } } },
      { kind: 'issue.transition', payload: { toStatusId: 's1' } },
    ] as Parameters<typeof collectStatusRefs>[0])
    expect(refs.sort()).toEqual(['s1', 's2'])
  })

  it('ignores non-string status ids', () => {
    const refs = collectStatusRefs([
      { kind: 'issue.transition', payload: { toStatusId: 42 } },
      { kind: 'issue.transition', payload: {} },
    ] as Parameters<typeof collectStatusRefs>[0])
    expect(refs).toEqual([])
  })
})
