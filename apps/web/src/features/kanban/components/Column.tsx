import { useDroppable } from '@dnd-kit/core'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@ui/index'
import { useRef } from 'react'
import type { Density, IssueSummary } from '../types'
import type { KanbanDroppableData } from '../useKanbanDnd'
import { Card } from './Card'

// Колонка статуса. Дизайн ALFAIAAS: 280px шириной (240/320 для compact/spacious),
// заголовок 32px uppercase tracking-wide, тонкий border, счётчик/WIP лимит
// справа. Виртуализация — для длинных колонок (>200 issues).

const ROW_HEIGHT: Record<Density, number> = {
  compact: 40,
  comfortable: 88,
  spacious: 132,
}

const ROW_GAP = 8

const COL_WIDTH: Record<Density, string> = {
  compact: 'w-[240px]',
  comfortable: 'w-[280px]',
  spacious: 'w-[320px]',
}

export interface ColumnProps {
  name: string
  count: number
  items: IssueSummary[]
  density: Density
  wipLimit: number | null
  columnId: string
  selectedIds?: Set<string>
  onCardClick?: (issue: IssueSummary) => void
}

export function Column({
  name,
  count,
  items,
  density,
  wipLimit,
  columnId,
  selectedIds,
  onCardClick,
}: ColumnProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const rowSize = ROW_HEIGHT[density] + ROW_GAP

  const droppable = useDroppable({
    id: `col:${columnId}`,
    data: { type: 'column', columnId } satisfies KanbanDroppableData,
  })

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowSize,
    overscan: 6,
  })

  const overLimit = typeof wipLimit === 'number' && wipLimit > 0 && count > wipLimit

  return (
    <section
      data-over={droppable.isOver ? 'true' : 'false'}
      data-wip-over={overLimit ? 'true' : 'false'}
      className={cn(
        'flex h-full min-h-0 shrink-0 flex-col rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] transition-colors',
        'data-[over=true]:border-[color:var(--border-strong)] data-[over=true]:bg-[color:var(--surface-elev)]',
        'data-[wip-over=true]:border-[color:var(--state-pending)]/40',
        COL_WIDTH[density],
      )}
      aria-label={`Column ${name}`}
    >
      <header
        className={cn(
          'sticky top-0 z-[1] flex h-8 items-center gap-2 rounded-t-lg border-b border-[color:var(--border)] bg-[color:var(--surface)] px-2.5 transition-colors',
          overLimit && 'bg-[color:var(--state-pending-tint)]',
        )}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[color:var(--text-secondary)]">
          {name}
        </span>
        {typeof wipLimit === 'number' && wipLimit > 0 ? (
          <span className="font-mono text-[10px] font-medium text-[color:var(--text-tertiary)]">
            {count}/{wipLimit}
          </span>
        ) : null}
        <span
          className={cn(
            'ml-auto inline-grid h-4 min-w-[18px] place-items-center rounded border border-[color:var(--border)] bg-[color:var(--surface-elev)] px-[5px] text-[10.5px] font-semibold text-[color:var(--text-secondary)]',
            overLimit &&
              'border-transparent bg-[color:var(--state-pending)] text-[oklch(20%_0.05_80)]',
          )}
        >
          {count}
        </span>
      </header>

      <div ref={droppable.setNodeRef} className="flex min-h-0 flex-1 flex-col">
        <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {items.length === 0 ? (
            <div className="m-1 rounded-md border border-dashed border-[color:var(--border)] px-2 py-6 text-center text-[11.5px] text-[color:var(--text-tertiary)]">
              Drop cards here
            </div>
          ) : (
            <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const issue = items[vi.index]!
                return (
                  <div
                    key={issue.id}
                    data-index={vi.index}
                    className="absolute left-0 right-0"
                    style={{ transform: `translateY(${vi.start}px)` }}
                  >
                    <div style={{ paddingBottom: ROW_GAP }}>
                      <Card
                        issue={issue}
                        density={density}
                        columnId={columnId}
                        selected={selectedIds?.has(issue.id)}
                        onClick={() => onCardClick?.(issue)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
