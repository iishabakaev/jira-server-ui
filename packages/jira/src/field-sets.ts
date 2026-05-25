// Контракт полей, которые мы запрашиваем у Jira REST.
// Описано в docs/specs/15-performance.md: всегда явный fields=, никогда *all
// в массовых сканах.

// Минимальный набор полей для индекс-сканов (бэкфилл, инкрементальный poll).
// Тяжёлые поля исключены до тех пор, пока issue не открыт в редакторе.
export const FIELDS_SCAN = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'labels',
  'components',
  'fixVersions',
  'duedate',
  'created',
  'updated',
  'parent',
] as const

// Полный набор — только при открытии конкретной задачи в редакторе.
export const FIELDS_FULL = ['*navigable', '*all'] as const

export type FieldsMode = 'scan' | 'full'

export interface ProjectMetadata {
  promoted?: Record<string, string | undefined>
}

// Собирает строку fields= для конкретного проекта в выбранном режиме.
// promoted-поля резолвятся per-project (см. projects.metadata.promoted).
export function buildFieldsList(project: { metadata: ProjectMetadata }, mode: FieldsMode = 'scan'): string {
  if (mode === 'full') return '*all'
  const promoted = Object.values(project.metadata.promoted ?? {}).filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  )
  return [...FIELDS_SCAN, ...promoted].join(',')
}
