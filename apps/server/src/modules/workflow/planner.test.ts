import { describe, expect, it } from 'bun:test'
import type { TransitionFieldRequirement } from '@db/schema/workflow'
import { bfsReachable, findPath } from './planner'

// Юнит-тест BFS: чистая функция, никаких DB. Стенд состоит из вершин-статусов
// и рёбер-transitions для одного issueType.

const TYPE = 'type1'
const NO_FIELDS: TransitionFieldRequirement[] = []

function edge(
  from: string,
  to: string,
  jiraId = `t:${from}->${to}`,
  fields: TransitionFieldRequirement[] = NO_FIELDS,
) {
  return {
    issueTypeId: TYPE,
    fromStatusId: from,
    toStatusId: to,
    jiraTransitionId: jiraId,
    requiredFields: fields,
  }
}

describe('findPath', () => {
  it('returns empty path when from === to', () => {
    expect(findPath([], TYPE, 'a', 'a')).toEqual([])
  })

  it('returns null when no path exists', () => {
    const edges = [edge('a', 'b'), edge('b', 'c')]
    expect(findPath(edges, TYPE, 'a', 'z')).toBeNull()
  })

  it('finds direct one-hop transition', () => {
    const edges = [edge('a', 'b')]
    const path = findPath(edges, TYPE, 'a', 'b')
    expect(path).not.toBeNull()
    expect(path!).toHaveLength(1)
    expect(path![0]!.toStatusId).toBe('b')
  })

  it('finds shortest path in a graph with multiple routes', () => {
    // a → b → c → d   (3 hops)
    // a → x → d       (2 hops, shortest)
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('a', 'x'), edge('x', 'd')]
    const path = findPath(edges, TYPE, 'a', 'd')
    expect(path!.map((p) => p.toStatusId)).toEqual(['x', 'd'])
  })

  it('prefers fewer-required-fields path among same-length alternatives', () => {
    const req: TransitionFieldRequirement = {
      field: 'resolution',
      name: 'Resolution',
      required: true,
      schemaType: 'option',
    }
    // a→b→d (no req) vs a→x→d (b→d step has required field) → BFS должен взять b.
    const edges = [
      edge('a', 'b'),
      edge('b', 'd'),
      edge('a', 'x'),
      edge('x', 'd', 't:x->d:req', [req]),
    ]
    const path = findPath(edges, TYPE, 'a', 'd')
    expect(path).not.toBeNull()
    expect(path!.map((p) => p.toStatusId)).toEqual(['b', 'd'])
  })

  it('handles cycles without infinite loop', () => {
    const edges = [edge('a', 'b'), edge('b', 'a'), edge('b', 'c')]
    const path = findPath(edges, TYPE, 'a', 'c')
    expect(path!.map((p) => p.toStatusId)).toEqual(['b', 'c'])
  })

  it('ignores edges from other issue types', () => {
    const edges = [edge('a', 'b'), { ...edge('a', 'b'), issueTypeId: 'other' }]
    const path = findPath(edges, TYPE, 'a', 'b')
    expect(path).toHaveLength(1)
  })
})

describe('bfsReachable', () => {
  // Контракт: возвращает map от statusId к минимальной дистанции (в hop'ах)
  // от fromStatusId, без самой fromStatusId. Используется allReachableStatuses
  // и через неё — UI multi-hop dropdown.

  const e = (from: string, to: string) => ({ fromStatusId: from, toStatusId: to })

  it('returns empty map for isolated node', () => {
    expect(bfsReachable([], 'a').size).toBe(0)
  })

  it('one-hop targets have distance 1', () => {
    const dist = bfsReachable([e('a', 'b'), e('a', 'c')], 'a')
    expect(dist.get('b')).toBe(1)
    expect(dist.get('c')).toBe(1)
    expect(dist.has('a')).toBe(false)
  })

  it('multi-hop targets keep shortest distance', () => {
    //   a → b → d (2)
    //   a → c → d (2)
    //   a → e → f → d (3)  — длиннее, не должно перекрыть 2
    const edges = [
      e('a', 'b'),
      e('b', 'd'),
      e('a', 'c'),
      e('c', 'd'),
      e('a', 'e'),
      e('e', 'f'),
      e('f', 'd'),
    ]
    const dist = bfsReachable(edges, 'a')
    expect(dist.get('d')).toBe(2)
    expect(dist.get('e')).toBe(1)
    expect(dist.get('f')).toBe(2)
  })

  it('handles cycles without infinite loop', () => {
    const dist = bfsReachable([e('a', 'b'), e('b', 'a'), e('b', 'c')], 'a')
    expect(dist.get('b')).toBe(1)
    expect(dist.get('c')).toBe(2)
    expect(dist.has('a')).toBe(false)
  })

  it('does not include the source even via a cycle back', () => {
    const dist = bfsReachable([e('a', 'b'), e('b', 'a')], 'a')
    expect(dist.has('a')).toBe(false)
    expect(dist.get('b')).toBe(1)
  })
})
