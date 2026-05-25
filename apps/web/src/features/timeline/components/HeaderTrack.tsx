import { dateToX, HEADER_HEIGHT, headerTicks, ROW_LABEL_WIDTH, windowWidth } from '../lib/geometry'
import type { Zoom } from '../types'

type Props = {
  from: Date
  to: Date
  zoom: Zoom
  // Сегодняшний день — рисуем вертикальную линию. Null, если today вне окна.
  today: Date | null
}

// Заголовок над body: месяцы крупным шрифтом + дни/недели мельче.
// Сетка-фон body наследует те же x-позиции (см. Body.tsx).
export function HeaderTrack({ from, to, zoom, today }: Props) {
  const ticks = headerTicks(from, to, zoom)
  const months = ticks.filter((t) => t.kind === 'month')
  const days = ticks.filter((t) => t.kind !== 'month')
  const width = windowWidth(from, to, zoom)

  let todayX: number | null = null
  if (today && today >= from && today <= to) {
    // dateToX — единый источник истины для перевода даты в пиксели
    // (тот же `PX_PER_DAY[zoom]`, что используют bars в body).
    todayX = dateToX(today, from, zoom)
  }

  return (
    <div
      className="sticky top-0 z-10 flex border-b border-[color:var(--border)] bg-[color:var(--background)]/95 backdrop-blur"
      style={{ height: HEADER_HEIGHT }}
    >
      <div
        className="flex shrink-0 items-center border-r border-[color:var(--border)] px-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[color:var(--text-tertiary)]"
        style={{ width: ROW_LABEL_WIDTH, minWidth: ROW_LABEL_WIDTH }}
      >
        Issue
      </div>
      <div className="relative h-full flex-1" style={{ width }}>
        {/* Месяцы — верхняя половина */}
        <div className="relative h-1/2 border-b border-[color:var(--border)]">
          {months.map((t) => (
            <div
              key={`m-${t.x}`}
              className="absolute top-0 flex h-full items-center px-2 text-[12px] font-semibold text-[color:var(--text-primary)]"
              style={{ left: t.x }}
            >
              {t.label}
            </div>
          ))}
        </div>
        {/* Дни/недели — нижняя половина */}
        <div className="relative h-1/2">
          {days.map((t) => (
            <div
              key={`d-${t.x}`}
              className={`absolute top-0 flex h-full items-end pb-1 text-[10px] ${
                t.kind === 'week'
                  ? 'font-medium text-[color:var(--text-secondary)]'
                  : 'text-[color:var(--text-tertiary)]'
              }`}
              style={{ left: t.x }}
            >
              {t.label}
            </div>
          ))}
          {todayX != null && (
            <div
              // Сегодняшняя дата — чисто визуальный маркер; в body есть
              // дублирующая линия с тем же x.
              aria-hidden
              className="pointer-events-none absolute top-0 h-full w-px bg-[color:var(--accent)]"
              style={{ left: todayX }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
