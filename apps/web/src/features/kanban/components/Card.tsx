import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@ui/badge'
import { cn } from '@ui/index'
import type { Density, IssueSummary } from '../types'
import type { KanbanDraggableData } from '../useKanbanDnd'
import { PriorityIcon, TypeGlyph } from './icons'

// Карточка issue в новом дизайне ALFAIAAS:
//  L1 — type glyph + key (моно)
//  Summary — 2 строки comfortable / 1 compact / 3 spacious
//  L2 — assignee avatar, epic chip, priority, sync pip
// Density управляет паддингом и видимостью элементов.

const DENSITY_PADDING: Record<Density, string> = {
  compact: 'px-2 py-1.5 gap-0',
  comfortable: 'px-2.5 py-2.5 gap-2',
  spacious: 'px-3 py-3 gap-2.5',
}

const SUMMARY_CLAMP: Record<Density, string> = {
  compact: 'line-clamp-1 text-[12.5px]',
  comfortable: 'line-clamp-2 text-[13px]',
  spacious: 'line-clamp-3 text-[13px]',
}

// Палитра аватара по строке assigneeId — стабильный hue из хэша.
function hashHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

function initials(name: string | null | undefined): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return ((parts[0]![0] ?? '') + (parts[parts.length - 1]![0] ?? '')).toUpperCase()
}

export interface CardProps {
  issue: IssueSummary
  density: Density
  columnId: string
  selected?: boolean
  onClick?: () => void
}

export function Card({ issue, density, columnId, selected, onClick }: CardProps) {
  const draggable = useDraggable({
    id: issue.id,
    data: {
      type: 'card',
      issueId: issue.id,
      columnId,
    } satisfies KanbanDraggableData,
  })

  const showL2 = density !== 'compact'
  const assigneeName = issue.assigneeDisplayName ?? issue.assigneeId ?? null
  const assigneeHue = issue.assigneeId ? hashHue(issue.assigneeId) : 0

  return (
    <article
      ref={draggable.setNodeRef}
      data-selected={selected ? 'true' : 'false'}
      data-key={issue.key}
      style={{
        transform: CSS.Translate.toString(draggable.transform),
        opacity: draggable.isDragging ? 0.5 : 1,
      }}
      {...draggable.attributes}
      {...draggable.listeners}
      onClick={onClick}
      className={cn(
        'group flex cursor-grab select-none flex-col rounded-md border border-[color:var(--border)] bg-[color:var(--surface-elev)] transition-all',
        'hover:border-[color:var(--border-strong)] hover:shadow-[var(--shadow-sm)]',
        'data-[selected=true]:border-[color:var(--accent)] data-[selected=true]:border-2',
        draggable.isDragging && 'cursor-grabbing scale-[1.01] rotate-[0.4deg] shadow-[var(--shadow-drag)]',
        DENSITY_PADDING[density],
      )}
      aria-label={`${issue.key} ${issue.summary}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <header className="flex items-start gap-1.5">
        <TypeGlyph type={issue.issueTypeName} />
        <span className="font-mono text-[10.5px] font-medium text-[color:var(--text-tertiary)]">
          {issue.key}
        </span>
      </header>

      <p
        className={cn(
          'overflow-hidden font-medium leading-[1.35] tracking-[-0.005em] text-[color:var(--text-primary)]',
          SUMMARY_CLAMP[density],
        )}
      >
        {issue.summary}
      </p>

      {showL2 ? (
        <footer className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-tertiary)]">
          {issue.assigneeId ? (
            <span
              title={assigneeName ?? undefined}
              className="grid size-4 place-items-center rounded-full text-[8.5px] font-semibold text-white"
              style={{ background: `hsl(${assigneeHue} 50% 50%)` }}
            >
              {initials(assigneeName)}
            </span>
          ) : (
            <span className="grid size-4 place-items-center rounded-full bg-[color:var(--surface)] text-[8.5px] font-semibold text-[color:var(--text-tertiary)]">
              ?
            </span>
          )}
          {issue.epicJiraId ? (
            <Badge
              variant="soft"
              title={issue.epicJiraId}
              className="h-4 max-w-[110px] truncate px-1.5 text-[10.5px]"
            >
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-[color:var(--type-epic)]"
              />
              {issue.epicJiraId}
            </Badge>
          ) : null}
          {issue.storyPoints != null ? (
            <span className="text-[10.5px] font-medium">{issue.storyPoints}sp</span>
          ) : null}
          <span className="ml-auto inline-flex items-center gap-1.5">
            <PriorityIcon priority={issue.priorityName} />
            {issue.syncState !== 'synced' ? (
              <span className="pip" data-state={issue.syncState} title={`Sync: ${issue.syncState}`} />
            ) : null}
          </span>
        </footer>
      ) : null}

      {density === 'spacious' && issue.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {issue.labels.slice(0, 4).map((l) => (
            <Badge key={l} variant="soft" className="text-[10px]">
              {l}
            </Badge>
          ))}
        </div>
      ) : null}
    </article>
  )
}
