import { Segment } from '@ui/segment'
import { Download, Rows3 } from 'lucide-react'
import type { Density } from '../types'

// Sub-bar (36px) — Group / Layout / Density сегменты и sub-link'и
// (Show subtasks / Export). Слой между TopBar и ChipRow.

export type GroupBy = 'status' | 'assignee' | 'epic' | 'priority' | 'sprint'
export type Layout = 'board' | 'list'

export interface SubBarProps {
  groupBy: GroupBy
  density: Density
  layout: Layout
  showSubtasks: boolean
  isRefreshing: boolean
  hideDone: boolean
  onGroupByChange: (g: GroupBy) => void
  onDensityChange: (d: Density) => void
  onLayoutChange: (l: Layout) => void
  onToggleSubtasks: () => void
  onHideDoneChange: (b: boolean) => void
  onRefresh: () => void
}

export function SubBar({
  groupBy,
  density,
  layout,
  showSubtasks,
  isRefreshing,
  hideDone,
  onGroupByChange,
  onDensityChange,
  onLayoutChange,
  onToggleSubtasks,
  onHideDoneChange,
  onRefresh,
}: SubBarProps) {
  return (
    <div className="flex h-9 items-center gap-3.5 border-b border-[color:var(--border)] px-3.5">
      <GroupLabel>Group</GroupLabel>
      <Segment<GroupBy>
        value={groupBy}
        ariaLabel="Group by"
        onChange={onGroupByChange}
        items={[
          { value: 'status', label: 'Status' },
          { value: 'epic', label: 'Epic' },
          { value: 'assignee', label: 'Assignee' },
          { value: 'priority', label: 'Priority' },
        ]}
      />

      <GroupLabel>Layout</GroupLabel>
      <Segment<Layout>
        value={layout}
        ariaLabel="Layout"
        onChange={onLayoutChange}
        items={[
          { value: 'board', label: 'Board' },
          { value: 'list', label: 'List' },
        ]}
      />

      <GroupLabel>Density</GroupLabel>
      <Segment<Density>
        value={density}
        ariaLabel="Density"
        onChange={onDensityChange}
        items={[
          { value: 'compact', label: 'Compact' },
          { value: 'comfortable', label: 'Comfortable' },
          { value: 'spacious', label: 'Spacious' },
        ]}
      />

      <div className="flex-1" />

      <button
        type="button"
        onClick={onToggleSubtasks}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)]"
        aria-pressed={showSubtasks}
      >
        <Rows3 className="size-3.5" strokeWidth={1.75} />
        {showSubtasks ? 'Hide subtasks' : 'Show subtasks'}
      </button>

      <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]">
        <input
          type="checkbox"
          checked={hideDone}
          onChange={(e) => onHideDoneChange(e.target.checked)}
          className="size-3 rounded border-[color:var(--border)]"
        />
        Hide done
      </label>

      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)] disabled:opacity-50"
      >
        <Download className="size-3.5" strokeWidth={1.75} />
        {isRefreshing ? 'Loading…' : 'Refresh'}
      </button>
    </div>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[color:var(--text-tertiary)]">
      {children}
    </span>
  )
}
