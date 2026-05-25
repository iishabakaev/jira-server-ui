// Классификатор иерархии issue-типов. Источник правды — спецификация продукта
// (см. .agents/PATTERNS.md): Epic → Task → Process / Change Task (subtask),
// плюс отдельный артефакт-тип Platform Devops Task, который содержит change
// tasks и развёртывается вместе с кодом.
//
// Маппинг базируется на имени issue-типа: исторически Jira-инстансы используют
// одну и ту же таксономию имён для проектов одной команды, поэтому без
// дополнительной настройки достаточно сравнения по name.toLowerCase().
//
// «level» используется UI'ем для:
//   - сортировки колонок группировки (epic выше task'а),
//   - сворачивания/раскрытия дерева subtasks,
//   - стилизации иконки/border'а карточки.

export type HierarchyLevel = 'epic' | 'artifact' | 'task' | 'subtask' | 'other'

export function classifyIssueType(name: string | null | undefined): HierarchyLevel {
  const n = (name ?? '').toLowerCase().trim()
  if (!n) return 'other'
  if (n === 'epic') return 'epic'
  if (n === 'platform devops task' || n === 'devops task' || n === 'platform task') {
    return 'artifact'
  }
  if (n === 'sub-task' || n === 'subtask' || n === 'process task' || n === 'change task') {
    return 'subtask'
  }
  if (n === 'task' || n === 'story' || n === 'bug' || n === 'improvement') return 'task'
  return 'other'
}

// Числовая ось сортировки: чем меньше — тем выше в иерархии. Удобно для
// сравнения двух типов внутри одной колонки kanban'а или таймлайна.
export function hierarchyOrder(name: string | null | undefined): number {
  switch (classifyIssueType(name)) {
    case 'epic':
      return 0
    case 'artifact':
      return 1
    case 'task':
      return 2
    case 'subtask':
      return 3
    default:
      return 4
  }
}
