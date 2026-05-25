import { cn } from '@ui/index'
import { ChevronDown, Moon, Search, Sun } from 'lucide-react'
import { useTheme } from '../../kanban/useTheme'
import { type ProjectListItem, ProjectPicker } from '../../projects'

// Top-bar timeline'а — 44px shell, тот же дизайн, что и у kanban TopBar:
// α-бейдж + ProjectPicker как первая крошка, далее "/" и текст
// "Timeline board". Правый блок: theme-toggle + search-cmdk-placeholder.
// Контролы окна (zoom/group) живут в SubBar ниже.

export interface TopBarProps {
  projects: ProjectListItem[]
  projectId: string | null
  isLoading: boolean
  onProjectChange: (id: string) => void
  onSearchClick?: () => void
}

export function TopBar({
  projects,
  projectId,
  isLoading,
  onProjectChange,
  onSearchClick,
}: TopBarProps) {
  const [theme, toggleTheme] = useTheme()

  return (
    <header className="flex h-11 items-center gap-2 border-b border-[color:var(--border)] px-3.5">
      <span
        aria-hidden
        className="grid size-3.5 place-items-center rounded-[3px] bg-[color:var(--accent)] text-[8.5px] font-bold leading-none text-white"
      >
        α
      </span>
      <ProjectPicker
        projects={projects}
        selectedId={projectId}
        onSelect={onProjectChange}
        isLoading={isLoading && projects.length === 0}
        label={null}
      />
      <span className="px-0.5 text-[11px] text-[color:var(--text-tertiary)]">/</span>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12.5px] font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--surface)]"
      >
        Timeline
        <ChevronDown className="size-3 text-[color:var(--text-tertiary)]" strokeWidth={1.75} />
      </button>

      <div className="flex-1" />

      <Tbtn onClick={toggleTheme} title="Toggle theme (⌘⇧L)">
        {theme === 'dark' ? (
          <Moon className="size-3.5" strokeWidth={1.75} />
        ) : (
          <Sun className="size-3.5" strokeWidth={1.75} />
        )}
      </Tbtn>
      <Tbtn>
        Views
        <ChevronDown className="size-3.5" strokeWidth={1.75} />
      </Tbtn>

      <button
        type="button"
        onClick={onSearchClick}
        className="inline-flex min-w-56 items-center gap-2 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-2 py-1 text-[12px] text-[color:var(--text-tertiary)] hover:border-[color:var(--border-strong)]"
      >
        <Search className="size-3.5" strokeWidth={1.75} />
        Search or jump to…
        <span className="ml-auto flex items-center gap-1">
          <span className="kbd">⌘</span>
          <span className="kbd">K</span>
        </span>
      </button>
    </header>
  )
}

function Tbtn({ className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px] font-medium text-[color:var(--text-secondary)] transition-colors',
        'hover:bg-[color:var(--surface)] hover:text-[color:var(--text-primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  )
}
