import { useVirtualizer } from '@tanstack/react-virtual'
import { useMemo, useRef } from 'react'
import {
  diffDays,
  HEADER_HEIGHT,
  PX_PER_DAY,
  ROW_HEIGHT_BAR,
  ROW_HEIGHT_GROUP,
  ROW_LABEL_WIDTH,
  windowWidth,
} from '../lib/geometry'
import type { RowEntry, TimelineBar, Zoom } from '../types'
import type { DragCommit } from './Bar'
import { HeaderTrack } from './HeaderTrack'
import { Row } from './Row'

type Props = {
  rows: RowEntry[]
  windowFrom: Date
  windowTo: Date
  zoom: Zoom
  onBarClick(bar: TimelineBar): void
  onBarCommit(commit: DragCommit): void
}

// Вертикально-виртуализированный список строк. Горизонтальная "сетка"
// общая для header'а и тела — её ширина считается один раз.
export function Body({ rows, windowFrom, windowTo, zoom, onBarClick, onBarCommit }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const today = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])

  const width = windowWidth(windowFrom, windowTo, zoom)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]?.kind === 'group' ? ROW_HEIGHT_GROUP : ROW_HEIGHT_BAR),
    overscan: 8,
    // Включаем измерение по горизонтали в виртуалайзер не нужно — мы
    // вертикально-виртуализируем; горизонтальный скролл нативный.
  })

  // Вертикальная "today"-линия — внутри body, в координатах сетки.
  let todayX: number | null = null
  if (today >= windowFrom && today <= windowTo) {
    todayX = diffDays(today, windowFrom) * PX_PER_DAY[zoom]
  }

  // Полосы фоновой сетки. Рисуем каждую неделю — лёгкие vertical lines.
  const weekStripes: number[] = []
  const totalDays = diffDays(windowTo, windowFrom)
  for (let d = 0; d <= totalDays; d += 7) {
    weekStripes.push(d * PX_PER_DAY[zoom])
  }

  return (
    <div ref={scrollRef} className="relative flex-1 overflow-auto">
      {/* Контейнер шириной = label + window. Header sticky-top живёт здесь же. */}
      <div style={{ width: ROW_LABEL_WIDTH + width }}>
        <HeaderTrack from={windowFrom} to={windowTo} zoom={zoom} today={today} />
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {/* Фоновая сетка — позади виртуализированных строк. Pointer-events
              отключаем, чтобы не перехватывать drag/click. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0"
            style={{ left: ROW_LABEL_WIDTH, width }}
          >
            {weekStripes.map((x) => (
              <div
                key={`w-${x}`}
                className="absolute inset-y-0 w-px bg-[color:var(--border)]/60"
                style={{ left: x }}
              />
            ))}
            {todayX != null && (
              <div
                className="absolute inset-y-0 w-px bg-[color:var(--accent)]/70"
                style={{ left: todayX }}
              />
            )}
          </div>

          {virtualizer.getVirtualItems().map((vi) => {
            const entry = rows[vi.index]
            if (!entry) return null
            return (
              <div
                key={entry.kind === 'group' ? `g-${entry.id}` : `b-${entry.id}`}
                data-index={vi.index}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <Row
                  entry={entry}
                  windowFrom={windowFrom}
                  zoom={zoom}
                  onBarClick={onBarClick}
                  onBarCommit={onBarCommit}
                />
              </div>
            )
          })}
        </div>
      </div>
      {/* Скелетон под HEADER_HEIGHT — ловит мышиные события вне body, чтобы
          drag-release не висел в воздухе. Чистая декорация. */}
      <div aria-hidden style={{ height: HEADER_HEIGHT, position: 'absolute' }} />
    </div>
  )
}
