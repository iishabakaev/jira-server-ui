import { api } from '../../lib/eden'

// Тонкая Eden-обёртка для projects-эндпойнтов. Никаких прямых fetch'ей
// (см. .agents/PATTERNS.md).

export type ProjectListItem = {
  id: string
  key: string
  name: string
  lastUpdatedAt: string | null
  lastFullSyncAt: string | null
}

export type ProjectAvailableIssueType = {
  id: string
  name: string
  iconUrl: string | null
}

export type ProjectDetail = {
  id: string
  key: string
  name: string
  availableIssueTypes: ProjectAvailableIssueType[]
}

export type ProjectSprint = {
  id: string
  name: string
  state: 'active' | 'future' | 'closed'
  startDate: string | null
  endDate: string | null
}

export class ProjectsError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ProjectsError'
  }
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new ProjectsError(inner?.code ?? 'unknown', inner?.message ?? 'Request failed')
  }
  if (res.data === null) throw new ProjectsError('unknown', 'Empty response')
  return res.data
}

export async function fetchProjects(text?: string | null): Promise<ProjectListItem[]> {
  const query = text && text.trim().length > 0 ? { text: text.trim() } : {}
  const res = await api.api.projects.get({ query })
  return unwrap(res).items
}

export async function fetchProjectDetail(id: string): Promise<ProjectDetail> {
  const res = await api.api.projects({ id }).get()
  return unwrap(res)
}

export async function fetchProjectSprints(id: string): Promise<ProjectSprint[]> {
  const res = await api.api.projects({ id }).sprints.get()
  return unwrap(res).items
}
