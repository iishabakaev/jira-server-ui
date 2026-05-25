import { api } from '../../lib/eden'
import type { IssueSummary, QuickCreateInput } from './types'

// Тонкая Eden-обёртка для quick-create. Единственная точка, через которую
// фичевые компоненты говорят с сервером (см. .agents/PATTERNS.md).

export class QuickCreateError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'QuickCreateError'
  }
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new QuickCreateError(inner?.code ?? 'unknown', inner?.message ?? 'Request failed')
  }
  if (res.data === null) throw new QuickCreateError('unknown', 'Empty response')
  return res.data
}

// POST /api/issues — quick-create. Сервер пишет локальную строку с временным
// key вроде `PROJ-DRAFT-xxxxxxxx` и outbox-событие `issue.create`. После
// синхронизации с Jira worker подменит key/jiraId на настоящие.
export async function createIssue(input: QuickCreateInput): Promise<IssueSummary> {
  const res = await api.api.issues.post(input)
  return unwrap(res).issue as IssueSummary
}
