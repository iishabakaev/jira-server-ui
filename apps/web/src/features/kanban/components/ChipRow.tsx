import { cn } from '@ui/index'
import { AlertCircle, Bug, CalendarClock, ChevronsUp, Plus, User, UserX } from 'lucide-react'
import type { ReactNode } from 'react'

// Chip-row под subbar'ом — quick-filter chips. Каждая chip — toggle с
// активным состоянием на accent-tint. "+ Filter" — заглушка для full
// builder'а (M8).

export type ChipKey = 'mine' | 'unassigned' | 'due-week' | 'high-priority' | 'bugs' | 'syncing'

const CHIPS: { key: ChipKey; label: string; icon?: ReactNode }[] = [
  { key: 'mine', label: 'Mine', icon: <User className="size-3" strokeWidth={1.75} /> },
  { key: 'unassigned', label: 'Unassigned', icon: <UserX className="size-3" strokeWidth={1.75} /> },
  {
    key: 'due-week',
    label: 'Due this week',
    icon: <CalendarClock className="size-3" strokeWidth={1.75} />,
  },
  {
    key: 'high-priority',
    label: 'High priority',
    icon: <ChevronsUp className="size-3" strokeWidth={1.75} />,
  },
  { key: 'bugs', label: 'Bugs', icon: <Bug className="size-3" strokeWidth={1.75} /> },
  {
    key: 'syncing',
    label: 'Out of sync',
    icon: <AlertCircle className="size-3" strokeWidth={1.75} />,
  },
]

export interface ChipRowProps {
  active: Set<ChipKey>
  onToggle: (k: ChipKey) => void
}

export function ChipRow({ active, onToggle }: ChipRowProps) {
  return (
    <div className="flex h-8 items-center gap-1.5 overflow-x-auto border-b border-[color:var(--border)] px-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {CHIPS.map((c) => {
        const on = active.has(c.key)
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onToggle(c.key)}
            aria-pressed={on}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] border px-2.5 py-1 text-[11.5px] font-medium transition-colors',
              on
                ? 'border-[color:var(--accent-tint-strong)] bg-[color:var(--accent-tint)] text-[color:var(--accent)]'
                : 'border-[color:var(--border)] text-[color:var(--text-secondary)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text-primary)]',
            )}
          >
            {c.icon}
            {c.label}
          </button>
        )
      })}
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] border border-dashed border-[color:var(--border)] px-2.5 py-1 text-[11.5px] font-medium text-[color:var(--text-tertiary)] hover:text-[color:var(--text-primary)]"
      >
        <Plus className="size-3" strokeWidth={1.75} />
        Filter
      </button>
    </div>
  )
}
