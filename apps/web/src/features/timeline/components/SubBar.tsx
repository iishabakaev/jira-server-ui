import { Segment } from '@ui/segment'
import { CalendarDays, Download } from 'lucide-react'
import type { TimelineGroupBy, Zoom } from '../types'

// Sub-bar timeline'а (36px) — Group + Zoom сегменты слева, Today/Refresh
// справа. Визуально идентичен kanban SubBar, использует тот же Segment.

export interface SubBarProps {
  group: TimelineGroupBy
  zoom: Zoom
  isRefreshing: boolean
  onGroupChange: (g: TimelineGroupBy) => void
  onZoomChange: (z: Zoom) => void
  onGoToday: () => void
  onRefresh: () => void
}

export function SubBar({
  group,
  zoom,
  isRefreshing,
  onGroupChange,
  onZoomChange,
  onGoToday,
  onRefresh,
}: SubBarProps) {
  return (
    <div className="flex h-9 items-center gap-3.5 border-b border-[color:var(--border)] px-3.5">
      <GroupLabel>Group</GroupLabel>
      <Segment<TimelineGroupBy>
        value={group}
        ariaLabel="Group by"
        onChange={onGroupChange}
        items={[
          { value: 'epic', label: 'Epic' },
          { value: 'assignee', label: 'Assignee' },
          { value: 'sprint', label: 'Sprint' },
          { value: 'none', label: 'None' },
        ]}
      />

      <GroupLabel>Zoom</GroupLabel>
      <Segment<Zoom>
        value={zoom}
        ariaLabel="Zoom"
        onChange={onZoomChange}
        items={[
          { value: 'week', label: 'W' },
          { value: '2w', label: '2W' },
          { value: 'month', label: 'M' },
          { value: 'quarter', label: 'Q' },
        ]}
      />

      <div className="flex-1" />

      <button
        type="button"
        onClick={onGoToday}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)]"
      >
        <CalendarDays className="size-3.5" strokeWidth={1.75} />
        Today
      </button>

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
