import type { RowEntry, TimelineBar, TimelineGroupBy, Zoom } from '../types'

// Гео-преобразования. Никаких импортов из React/zustand — всё чисто,
// чтобы можно было покрыть юнит-тестами без DOM.

const MS_PER_DAY = 86_400_000

// Пиксели на день для каждой зум-степени. Подобраны так, чтобы:
//   week     — день читается как заметная колонка
//   2w       — половина week, ещё видно границы дней
//   month    — день — узкий столбец, заголовки помесячные
//   quarter  — день почти не виден, заголовок — недели
export const PX_PER_DAY: Record<Zoom, number> = {
  week: 56,
  '2w': 28,
  month: 16,
  quarter: 6,
}

// Шаг snap'а при drag/resize (в днях). Месяц/quarter снапятся к неделе,
// чтобы пользователь не дёргался в попытке попасть в один день.
export const SNAP_DAYS: Record<Zoom, number> = {
  week: 1,
  '2w': 1,
  month: 1,
  quarter: 7,
}

// Высоты строк фиксированы — даёт честный virtualizer без measureElement.
export const ROW_HEIGHT_BAR = 36
export const ROW_HEIGHT_GROUP = 28
export const HEADER_HEIGHT = 56
export const ROW_LABEL_WIDTH = 220

// Парсит YYYY-MM-DD в локальный midnight Date. `new Date('YYYY-MM-DD')`
// интерпретируется как UTC midnight — в локальных таймзонах это «вчера»
// для negative offsets. Парсим компоненты вручную.
//
// Валидация: бросаем `RangeError` на malformed input. Раньше silent NaN
// уходили в `addDays`, ломая весь рендер; теперь caller (route /timeline
// validateSearch, drag-handler) обязан ловить и откатывать.
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
// Eden treaty при некоторых конфигурациях (t.String({format:'date'}) +
// response-schema валидация) отдает поле уже как `Date`. Тогда в template-
// строках/JSX оно стрингуется в `Date.toString()` формат
// "Fri May 01 2026 03:00:00 GMT+0300", который не подходит под YYYY-MM-DD.
// Поэтому принимаем и Date, и строку; YYYY-MM-DD парсится как локальный
// midnight, остальное — через нативный конструктор.
export function parseIsoDate(input: string | Date): Date {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new RangeError(`Invalid ISO date: ${String(input)}`)
    }
    return new Date(input.getFullYear(), input.getMonth(), input.getDate())
  }
  const m = ISO_DATE_RE.exec(input)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    // Дополнительно ловим '2026-13-01' / '2026-02-30': если Date нормализовал
    // компоненты (Feb 30 → Mar 02), значит входная дата невалидна.
    const date = new Date(y, mo - 1, d)
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) {
      throw new RangeError(`Invalid ISO date: ${input}`)
    }
    return date
  }
  // Fallback: пробуем нативный конструктор (покрывает Date.toString()-form,
  // ISO-datetime "...T...Z", и т.п.). Если получилось — берем локальный
  // midnight, чтобы геометрия timeline'а оставалась в "calendar day" логике.
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid ISO date: ${input}`)
  }
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
}

// Обратное: Date → YYYY-MM-DD без UTC-сдвига.
export function toIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addDays(date: Date, days: number): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + days)
  return out
}

export function diffDays(a: Date, b: Date): number {
  // Через timestamp — устойчиво к переходам на летнее время.
  return Math.round((a.getTime() - b.getTime()) / MS_PER_DAY)
}

// Окно времени по зум-уровню и якорной дате. Возвращаем расширенный
// диапазон, чтобы скролл не упирался в правую границу мгновенно.
export function defaultWindow(anchor: Date, zoom: Zoom): { from: Date; to: Date } {
  const spans: Record<Zoom, { back: number; fwd: number }> = {
    week: { back: 14, fwd: 42 },
    '2w': { back: 21, fwd: 56 },
    month: { back: 30, fwd: 90 },
    quarter: { back: 60, fwd: 180 },
  }
  const s = spans[zoom]
  return { from: addDays(anchor, -s.back), to: addDays(anchor, s.fwd) }
}

// Преобразуем дату-точку в X-пиксель относительно начала окна.
export function dateToX(date: Date, from: Date, zoom: Zoom): number {
  return diffDays(date, from) * PX_PER_DAY[zoom]
}

// И обратно — пиксель в дату, с учётом snap. Используется в drag-handler'ах.
export function xToDate(x: number, from: Date, zoom: Zoom): Date {
  const days = Math.round(x / PX_PER_DAY[zoom])
  return addDays(from, days)
}

// Snap количества дней к шагу зум-уровня.
export function snapDays(days: number, zoom: Zoom): number {
  const step = SNAP_DAYS[zoom]
  return Math.round(days / step) * step
}

// Полная ширина окна в пикселях — для CSS-контейнера body+header.
export function windowWidth(from: Date, to: Date, zoom: Zoom): number {
  return Math.max(0, diffDays(to, from)) * PX_PER_DAY[zoom]
}

// Геометрия одного бара: [x, width]. Если у issue только одна дата —
// рисуем фиксированной шириной в один snap-step (point-bar).
export function barGeometry(
  bar: TimelineBar,
  from: Date,
  zoom: Zoom,
): { x: number; width: number; startDate: Date; endDate: Date } | null {
  const startIso = bar.startDate ?? bar.dueDate
  const endIso = bar.dueDate ?? bar.startDate
  if (!startIso || !endIso) return null
  const startDate = parseIsoDate(startIso)
  const endDate = parseIsoDate(endIso)
  const x = dateToX(startDate, from, zoom)
  // +1 — бар покрывает включительно последний день. Без +1 single-day issue
  // схлопывался бы в 0px.
  const days = Math.max(1, diffDays(endDate, startDate) + 1)
  const width = days * PX_PER_DAY[zoom]
  return { x, width, startDate, endDate }
}

// Группировка для левой колонки. Сохраняем порядок первого появления —
// детерминированный, без дополнительных sort'ов.
export function buildRows(
  bars: TimelineBar[],
  group: TimelineGroupBy,
): { rows: RowEntry[]; groupCount: number } {
  if (group === 'none') {
    const rows: RowEntry[] = bars.map((b) => ({
      kind: 'bar',
      id: b.id,
      bar: b,
      groupId: 'all',
    }))
    return { rows, groupCount: 0 }
  }

  const groups = new Map<string, { label: string; bars: TimelineBar[] }>()

  function keyOf(b: TimelineBar): { id: string; label: string } {
    if (group === 'epic') {
      const id = b.epicJiraId ?? '__no_epic__'
      const label = b.epicJiraId ?? 'No epic'
      return { id, label }
    }
    if (group === 'assignee') {
      const id = b.assigneeId ?? '__unassigned__'
      const label = b.assigneeDisplayName ?? b.assigneeId ?? 'Unassigned'
      return { id, label }
    }
    const id = b.sprintId ?? '__no_sprint__'
    const label = b.sprintName ?? 'No sprint'
    return { id, label }
  }

  for (const bar of bars) {
    const { id, label } = keyOf(bar)
    const existing = groups.get(id)
    if (existing) existing.bars.push(bar)
    else groups.set(id, { label, bars: [bar] })
  }

  const rows: RowEntry[] = []
  for (const [groupId, { label, bars: groupBars }] of groups) {
    rows.push({ kind: 'group', id: groupId, label, count: groupBars.length })
    for (const bar of groupBars) {
      rows.push({ kind: 'bar', id: bar.id, bar, groupId })
    }
  }
  return { rows, groupCount: groups.size }
}

// Делит окно на месяцы и недели — заголовок над body. Возвращает массив
// тиков {date, x, label, kind}. `kind` диктует размер шрифта/цвет.
export type HeaderTick = {
  date: Date
  x: number
  label: string
  kind: 'month' | 'week' | 'day'
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

export function headerTicks(from: Date, to: Date, zoom: Zoom): HeaderTick[] {
  const ticks: HeaderTick[] = []
  const totalDays = Math.max(0, diffDays(to, from))

  // Месяцы — всегда.
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  if (cursor < from) cursor = new Date(from.getFullYear(), from.getMonth() + 1, 1)
  while (cursor <= to) {
    ticks.push({
      date: new Date(cursor),
      x: dateToX(cursor, from, zoom),
      label: `${MONTH_SHORT[cursor.getMonth()]} ${cursor.getFullYear()}`,
      kind: 'month',
    })
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  }

  // Дни/недели — зависит от зума.
  if (zoom === 'week' || zoom === '2w') {
    for (let d = 0; d <= totalDays; d += 1) {
      const date = addDays(from, d)
      ticks.push({
        date,
        x: dateToX(date, from, zoom),
        label: String(date.getDate()),
        kind: 'day',
      })
    }
  } else {
    // Помечаем понедельники.
    for (let d = 0; d <= totalDays; d += 1) {
      const date = addDays(from, d)
      if (date.getDay() !== 1) continue
      ticks.push({
        date,
        x: dateToX(date, from, zoom),
        label: String(date.getDate()),
        kind: 'week',
      })
    }
  }
  return ticks
}
