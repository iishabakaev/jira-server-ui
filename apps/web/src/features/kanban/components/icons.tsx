import {
  Bookmark,
  Bug,
  CheckSquare,
  ChevronsDown,
  ChevronsUp,
  Equal,
  GitBranch,
  Layers,
  Minus,
  Package,
  RefreshCw,
  Settings,
  Zap,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'

// Карта иконок типов issue → lucide компонент. Цвет подаётся через
// CSS-переменную (--type-*), поэтому компонент не задаёт fill/stroke
// напрямую. Иерархия (см. .agents/PATTERNS.md):
//   Epic → Task → Process Task / Change Task (subtask)
//   Platform Devops Task — артефакт, развёртываемый вместе с кодом,
//   содержит change tasks. На UI отображаем package-иконкой.

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { strokeWidth?: number }>

const TYPE_ICON: Record<string, IconCmp> = {
  epic: Zap,
  task: CheckSquare,
  bug: Bug,
  story: Bookmark,
  subtask: GitBranch,
  'process task': RefreshCw,
  'change task': Settings,
  'platform devops task': Package,
}

export function TypeGlyph({
  type,
  size = 14,
}: {
  type: string | null | undefined
  size?: number
}) {
  const key = (type ?? 'task').toLowerCase()
  const Icon = TYPE_ICON[key] ?? Layers
  const bg = (
    {
      epic: 'var(--type-epic)',
      task: 'var(--type-task)',
      bug: 'var(--type-bug)',
      story: 'var(--type-story)',
      subtask: 'var(--type-subtask)',
      // Цвета новых типов берутся из тех же CSS-переменных через fallback:
      // process / change — оттенки task'а, platform devops — отдельная "epic"
      // палитра, потому что артефакт стоит на верхнем уровне иерархии.
      'process task': 'var(--type-subtask)',
      'change task': 'var(--type-subtask)',
      'platform devops task': 'var(--type-epic)',
    } as Record<string, string>
  )[key] ?? 'var(--type-task)'
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[3px] text-white"
      style={{ width: size, height: size, background: bg }}
      aria-hidden
    >
      <Icon
        width={Math.round(size * 0.72)}
        height={Math.round(size * 0.72)}
        strokeWidth={1.75}
      />
    </span>
  )
}

// Иконка приоритета. Используем chevron-стрелки разной плотности — это
// классический Jira-словарь (см. spec).
const PRIO_ICON: Record<string, IconCmp> = {
  Highest: ChevronsUp,
  High: ChevronsUp,
  Medium: Equal,
  Low: ChevronsDown,
  Lowest: ChevronsDown,
}

export function PriorityIcon({
  priority,
  size = 12,
}: {
  priority: string | null | undefined
  size?: number
}) {
  if (!priority) return null
  const Icon = PRIO_ICON[priority] ?? Minus
  const color = (
    {
      Highest: 'var(--p-highest)',
      High: 'var(--p-high)',
      Medium: 'var(--p-medium)',
      Low: 'var(--p-low)',
      Lowest: 'var(--p-lowest)',
    } as Record<string, string>
  )[priority] ?? 'var(--p-medium)'
  return (
    <span
      data-prio={priority}
      title={`${priority} priority`}
      className="inline-flex shrink-0 items-center"
      style={{ color }}
      aria-label={`${priority} priority`}
    >
      <Icon width={size} height={size} strokeWidth={2} />
    </span>
  )
}
