import { barGeometry, ROW_HEIGHT_BAR, ROW_HEIGHT_GROUP, ROW_LABEL_WIDTH } from '../lib/geometry'
import type { RowEntry, TimelineBar, Zoom } from '../types'
import { Bar, type DragCommit } from './Bar'

type Props = {
  entry: RowEntry
  windowFrom: Date
  zoom: Zoom
  onBarClick(bar: TimelineBar): void
  onBarCommit(commit: DragCommit): void
}

// Одна строка timeline'а. Высота фиксирована по типу узла — virtualizer
// получает predictable size.
export function Row({ entry, windowFrom, zoom, onBarClick, onBarCommit }: Props) {
  if (entry.kind === 'group') {
    return (
      <div
        className="flex items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[color:var(--text-secondary)]"
        style={{ height: ROW_HEIGHT_GROUP }}
      >
        <span className="truncate">{entry.label}</span>
        <span className="text-[color:var(--text-tertiary)]">· {entry.count}</span>
      </div>
    )
  }

  const geom = barGeometry(entry.bar, windowFrom, zoom)
  return (
    <div
      className="relative flex items-center border-b border-[color:var(--border)] transition-colors hover:bg-[color:var(--surface)]"
      style={{ height: ROW_HEIGHT_BAR }}
    >
      {/* Левый фиксированный лейбл — issue key, чтобы строка читалась
          независимо от ширины контента справа. */}
      <div
        className="sticky left-0 z-[1] flex h-full items-center gap-2 border-r border-[color:var(--border)] bg-[color:var(--background)] px-3 text-[12px] text-[color:var(--text-primary)]"
        style={{ width: ROW_LABEL_WIDTH, minWidth: ROW_LABEL_WIDTH }}
      >
        <span className="font-mono text-[11px] text-[color:var(--text-tertiary)]">
          {entry.bar.key}
        </span>
        <span className="truncate">{entry.bar.summary}</span>
      </div>
      <div className="relative h-full flex-1">
        {geom && (
          <Bar
            bar={entry.bar}
            x={geom.x}
            width={geom.width}
            zoom={zoom}
            onClick={onBarClick}
            onCommit={onBarCommit}
          />
        )}
      </div>
    </div>
  )
}
