import { Link, useLocation } from '@tanstack/react-router'
import { cn } from '@ui/index'
import { Calendar, KanbanSquare, Search, Settings, Star } from 'lucide-react'

// Rail nav слева — 48px иконочная панель из спецификации ALFAIAAS.
// Активный пункт подсвечивается accent-tint (рендерится через aria-current).
// Tooltip справа — позиционируется относительно кнопки, на hover.

type NavItem = {
  to: '/kanban' | '/timeline' | '/admin/sync' | '/settings/jira'
  label: string
  shortcut?: string[]
  icon: React.ReactNode
}

const ITEMS: NavItem[] = [
  {
    to: '/kanban',
    label: 'Kanban',
    shortcut: ['G', 'K'],
    icon: <KanbanSquare className="size-[18px]" strokeWidth={1.75} />,
  },
  {
    to: '/timeline',
    label: 'Timeline',
    shortcut: ['G', 'T'],
    icon: <Calendar className="size-[18px]" strokeWidth={1.75} />,
  },
]

const FOOT_ITEMS: NavItem[] = [
  {
    to: '/admin/sync',
    label: 'Sync admin',
    icon: <Star className="size-[18px]" strokeWidth={1.75} />,
  },
  {
    to: '/settings/jira',
    label: 'Settings',
    icon: <Settings className="size-[18px]" strokeWidth={1.75} />,
  },
]

export function RailNav({ onSearchClick }: { onSearchClick?: () => void }) {
  const location = useLocation()
  const path = location.pathname

  return (
    <aside
      aria-label="Primary navigation"
      className="flex w-12 flex-col items-center gap-1 border-r border-[color:var(--border)] bg-[color:var(--rail-bg)] py-2"
    >
      <div
        aria-hidden
        title="ALFAIAAS"
        className="mb-1.5 grid size-7 place-items-center rounded-md bg-[color:var(--accent)] text-[12px] font-semibold tracking-tight text-white"
      >
        α
      </div>
      {ITEMS.map((it) => {
        const active = path.startsWith(it.to)
        return <RailLink key={it.to} item={it} active={active} />
      })}
      <button
        type="button"
        onClick={onSearchClick}
        title="Search"
        className={cn(
          'group relative grid size-8 place-items-center rounded-md text-[color:var(--text-tertiary)] transition-colors',
          'hover:bg-[color:var(--surface)] hover:text-[color:var(--text-secondary)]',
        )}
      >
        <Search className="size-[18px]" strokeWidth={1.75} />
        <RailTip label="Search" shortcut={['⌘', 'K']} />
      </button>
      <div className="flex-1" />
      {FOOT_ITEMS.map((it) => {
        const active = path.startsWith(it.to)
        return <RailLink key={it.to} item={it} active={active} />
      })}
      <div
        className="my-1 grid size-7 place-items-center rounded-md"
        title="Sync OK"
        aria-label="Sync OK"
      >
        <span className="size-2 rounded-full bg-[oklch(70%_0.16_145)] shadow-[0_0_0_3px_oklch(70%_0.16_145/.18)]" />
      </div>
    </aside>
  )
}

function RailLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      to={item.to}
      title={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative grid size-8 place-items-center rounded-md text-[color:var(--text-tertiary)] transition-colors',
        'hover:bg-[color:var(--surface)] hover:text-[color:var(--text-secondary)]',
        active && 'bg-[color:var(--accent-tint)] text-[color:var(--accent)] hover:bg-[color:var(--accent-tint)] hover:text-[color:var(--accent)]',
      )}
    >
      {item.icon}
      <RailTip label={item.label} shortcut={item.shortcut} />
    </Link>
  )
}

function RailTip({ label, shortcut }: { label: string; shortcut?: string[] }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 flex -translate-y-1/2 -translate-x-1 items-center gap-1.5 whitespace-nowrap rounded-md',
        'border border-[color:var(--border)] bg-[color:var(--surface-elev)] px-2 py-1 text-[11.5px] font-medium text-[color:var(--text-primary)]',
        'opacity-0 shadow-[var(--shadow-pop)] transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100',
      )}
    >
      {label}
      {shortcut?.map((k) => (
        <span key={k} className="kbd">
          {k}
        </span>
      ))}
    </span>
  )
}
