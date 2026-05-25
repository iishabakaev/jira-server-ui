import type { ProjectListItem } from '../api'

// Лёгкий fuzzy-скор на основе подстроки + бонусов за позицию матча.
// Алгоритм: ищем все символы query по порядку в строке (subsequence).
// Бонусы:
//   - exact prefix (key совпадает префиксом) — +1000
//   - exact full-match (key или name) — +2000
//   - близость матча к началу (− позиция первого символа)
//   - плотность матча (− длина диапазона)
// Возвращает score или null, если match невозможен.

function subsequenceMatch(query: string, target: string): { start: number; end: number } | null {
  if (query.length === 0) return { start: 0, end: 0 }
  let qi = 0
  let firstMatch = -1
  let lastMatch = -1
  for (let i = 0; i < target.length && qi < query.length; i += 1) {
    if (target[i] === query[qi]) {
      if (firstMatch === -1) firstMatch = i
      lastMatch = i
      qi += 1
    }
  }
  if (qi !== query.length) return null
  return { start: firstMatch, end: lastMatch }
}

export type ScoredProject = {
  project: ProjectListItem
  score: number
}

export function scoreProject(p: ProjectListItem, query: string): number | null {
  const q = query.trim().toLowerCase()
  if (q.length === 0) return 0

  const key = p.key.toLowerCase()
  const name = p.name.toLowerCase()
  const composed = `${key} ${name}`

  // Точные / префиксные совпадения резко увеличивают вес.
  if (key === q || name === q) return 10_000
  if (key.startsWith(q)) return 5_000 - key.length
  if (name.startsWith(q)) return 4_000 - name.length

  // Подстрока внутри key/name.
  const keyIdx = key.indexOf(q)
  if (keyIdx >= 0) return 3_000 - keyIdx - key.length
  const nameIdx = name.indexOf(q)
  if (nameIdx >= 0) return 2_000 - nameIdx - name.length

  // Финальный fallback: subsequence по «key name». Удобно для запросов
  // типа `kbn-acc` → ищем k…b…n…a…c…c.
  const match = subsequenceMatch(q, composed)
  if (!match) return null
  const span = match.end - match.start
  return 1_000 - match.start - span
}

export function filterProjects(items: ProjectListItem[], query: string): ProjectListItem[] {
  if (query.trim().length === 0) return items
  const scored: ScoredProject[] = []
  for (const p of items) {
    const score = scoreProject(p, query)
    if (score === null) continue
    scored.push({ project: p, score })
  }
  scored.sort((a, b) => b.score - a.score || a.project.key.localeCompare(b.project.key))
  return scored.map((s) => s.project)
}
