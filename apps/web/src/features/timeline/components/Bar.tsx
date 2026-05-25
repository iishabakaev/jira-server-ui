import { useCallback, useEffect, useRef, useState } from 'react'
import { addDays, PX_PER_DAY, parseIsoDate, snapDays, toIsoDate } from '../lib/geometry'
import { type DragMode, useTimelineUi } from '../store'
import type { TimelineBar, Zoom } from '../types'

// Один issue-бар в Gantt-сетке. Поведение:
//   - drag тело → move (обе даты сдвигаются)
//   - drag правая ручка → resize-end (только dueDate)
//   - drag левая ручка → resize-start (только startDate)
//   - click без drag (порог 4px) → onClick
// Pointer Events с pointer-capture; никаких глобальных listeners на window.

const SYNC_PIP_CLASS: Record<TimelineBar['syncState'], string> = {
  synced: 'bg-emerald-500',
  pending: 'bg-amber-400',
  pushing: 'bg-blue-400',
  error: 'bg-destructive',
  conflict: 'bg-violet-500',
}

const CATEGORY_BG: Record<TimelineBar['statusCategory'], string> = {
  new: 'bg-slate-400/80 hover:bg-slate-400',
  indeterminate: 'bg-blue-500/80 hover:bg-blue-500',
  done: 'bg-emerald-500/70 hover:bg-emerald-500',
}

type DragCommit = {
  barId: string
  startDate: string | null
  dueDate: string | null
}

type DragState = { mode: DragMode; startX: number; dxPx: number }

type Props = {
  bar: TimelineBar
  x: number
  width: number
  zoom: Zoom
  onClick(bar: TimelineBar): void
  onCommit(commit: DragCommit): void
}

export function Bar({ bar, x, width, zoom, onClick, onCommit }: Props) {
  // Локальный preview — позволяет react не пересоздавать virtualizer на каждом
  // pointer-move. После endDrag локальное состояние сбрасываем, кеш обновляется
  // через onCommit → usePatchIssueDates onMutate.
  const [drag, setDrag] = useState<DragState | null>(null)
  // Ref на актуальное состояние drag — нужен unmount-only cleanup, который
  // не должен пересоздаваться при каждом pointer-move (иначе cleanup
  // предыдущего рендера вызывает endDrag дважды).
  const dragRef = useRef<DragState | null>(null)
  dragRef.current = drag

  const startDrag = useTimelineUi((s) => s.startDrag)
  const updateDrag = useTimelineUi((s) => s.updateDrag)
  const endDrag = useTimelineUi((s) => s.endDrag)

  const handlePointerDown = useCallback(
    (mode: DragMode) => (e: React.PointerEvent<HTMLElement>) => {
      // Re-entry guard: повторный pointerdown во время активного drag
      // (multi-touch / синтетический click на ручку, пока тело тащим)
      // оставляет первый capture в силе — иначе store получает второй
      // startDrag без endDrag в паре.
      if (dragRef.current) return
      e.stopPropagation()
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      setDrag({ mode, startX: e.clientX, dxPx: 0 })
      startDrag({ barId: bar.id, mode, dxPx: 0 })
    },
    [bar.id, startDrag],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!drag) return
      const dx = e.clientX - drag.startX
      setDrag((d) => (d ? { ...d, dxPx: dx } : d))
      updateDrag(dx)
    },
    [drag, updateDrag],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (!drag) return
      e.currentTarget.releasePointerCapture(e.pointerId)
      const days = snapDays(drag.dxPx / PX_PER_DAY[zoom], zoom)
      const mode = drag.mode
      const dxPx = drag.dxPx
      setDrag(null)
      endDrag()
      // 4px / "0 дней" — это клик. На небольших зумах 4px может оказаться
      // меньше одного снапа, тогда days=0 и мы корректно считаем это кликом.
      if (Math.abs(dxPx) < 4 || days === 0) {
        onClick(bar)
        return
      }
      const startDate = bar.startDate ? parseIsoDate(bar.startDate) : null
      const dueDate = bar.dueDate ? parseIsoDate(bar.dueDate) : null
      if (!startDate && !dueDate) return

      let nextStart = startDate ? addDays(startDate, days) : null
      let nextDue = dueDate ? addDays(dueDate, days) : null
      if (mode === 'resize-start') {
        nextDue = dueDate
        // Point-bar с одной только dueDate: drag левого края создаёт startDate,
        // отсчитанный от dueDate. Это единственный способ из timeline добавить
        // вторую дату без перехода в side-panel.
        if (!nextStart && dueDate) {
          const candidate = addDays(dueDate, days)
          nextStart = candidate
        }
        if (nextStart && nextDue && nextStart > nextDue) nextStart = nextDue
      } else if (mode === 'resize-end') {
        nextStart = startDate
        if (!nextDue && startDate) {
          const candidate = addDays(startDate, days)
          nextDue = candidate
        }
        if (nextStart && nextDue && nextDue < nextStart) nextDue = nextStart
      }

      const commit: DragCommit = {
        barId: bar.id,
        startDate: nextStart ? toIsoDate(nextStart) : null,
        dueDate: nextDue ? toIsoDate(nextDue) : null,
      }
      // Отправляем только изменённые поля. Идемпотентность гарантируется
      // outbox-логикой на сервере, но лишний PATCH создавал бы ложные строки.
      if (commit.startDate === bar.startDate && commit.dueDate === bar.dueDate) {
        return
      }
      onCommit(commit)
    },
    [bar, drag, endDrag, onClick, onCommit, zoom],
  )

  // Восстанавливаем геометрию из drag-state при превью.
  let translateX = x
  let renderWidth = width
  if (drag) {
    const days = snapDays(drag.dxPx / PX_PER_DAY[zoom], zoom)
    const dxPx = days * PX_PER_DAY[zoom]
    if (drag.mode === 'move') {
      translateX = x + dxPx
    } else if (drag.mode === 'resize-end') {
      renderWidth = Math.max(PX_PER_DAY[zoom], width + dxPx)
    } else if (drag.mode === 'resize-start') {
      // Сдвигаем левый край: и x, и width.
      const clamped = Math.max(-(width - PX_PER_DAY[zoom]), dxPx)
      translateX = x + clamped
      renderWidth = width - clamped
    }
  }

  // Unmount-only cleanup: cleanup пред. рендера НЕ должен вызывать endDrag
  // при каждой смене drag-state, иначе store получает лишние endDrag вызовы.
  // Эффект пустой по deps + ref для актуального drag в момент unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount-only by design
  useEffect(() => {
    return () => {
      if (dragRef.current) endDrag()
    }
  }, [])

  // Tooltip-строка для hover. ISO даты дублируем на assistive-стек через aria-label.
  const startLabel = bar.startDate ?? '—'
  const dueLabel = bar.dueDate ?? '—'
  const ariaLabel =
    `${bar.key}: ${bar.summary}, from ${startLabel} to ${dueLabel}, ` +
    `status ${bar.statusName}${bar.assigneeDisplayName ? `, ${bar.assigneeDisplayName}` : ''}`

  // Если у issue только одна дата, считаем bar "точкой" — рендерим узким
  // прямоугольником с ярко выделенной границей, без поворота (иначе текст
  // в нём становится нечитаем).
  const isPoint = !bar.startDate || !bar.dueDate

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={ariaLabel}
      onPointerDown={handlePointerDown('move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        setDrag(null)
        endDrag()
      }}
      className={`absolute top-1 h-7 select-none rounded-md px-2 text-left text-[11px] font-medium text-white shadow-sm ring-1 ring-black/10 transition-colors ${CATEGORY_BG[bar.statusCategory]} ${
        isPoint ? 'ring-2 ring-amber-300' : ''
      } ${drag ? 'cursor-grabbing opacity-90' : 'cursor-grab'}`}
      style={{
        transform: `translateX(${translateX}px)`,
        width: `${renderWidth}px`,
      }}
    >
      <div className="flex h-full items-center gap-1 truncate">
        <span
          className={`inline-block h-2 w-2 shrink-0 rounded-full ${SYNC_PIP_CLASS[bar.syncState]}`}
        />
        <span className="truncate">
          <span className="font-mono opacity-80">{bar.key}</span>
          <span className="mx-1">·</span>
          <span>{bar.summary}</span>
        </span>
      </div>
      {/* Resize handles:
            - bar с двумя датами — две ручки;
            - point-bar только с dueDate — левая ручка, которая создаёт startDate;
            - point-bar только со startDate — правая ручка, которая создаёт dueDate.
          Это даёт способ добавить вторую дату прямо из timeline без перехода
          в issue side-panel. */}
      {(!isPoint || bar.dueDate) && (
        <span
          aria-hidden
          onPointerDown={handlePointerDown('resize-start')}
          className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-md bg-black/10 hover:bg-black/20"
          title={bar.startDate ? 'Drag to adjust start date' : 'Drag to set start date'}
        />
      )}
      {(!isPoint || bar.startDate) && (
        <span
          aria-hidden
          onPointerDown={handlePointerDown('resize-end')}
          className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-md bg-black/10 hover:bg-black/20"
          title={bar.dueDate ? 'Drag to adjust due date' : 'Drag to set due date'}
        />
      )}
    </button>
  )
}

export type { DragCommit }
