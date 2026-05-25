import { t } from 'elysia'
import { StatusCategory, SyncState } from '../issues/schema'

// Контракт timeline-модуля. На M7-MVP отдаём плоский массив "баров"
// (issue с обеими/одной из дат), сгруппировать UI умеет сам по epic
// или assignee (см. features/timeline/lib/geometry.ts).

// ISO date (YYYY-MM-DD). Лимит длины — чтобы Elysia не пропустил длинные
// строки в SQL: даты хранятся как `date` в Postgres.
const IsoDate = t.String({ format: 'date', maxLength: 10 })

// Запрос: проект (required), окно дат, группировка (только подсказка UI —
// сервер её не использует в SQL, но прокидывает в ответ для согласованности
// между запросом и кешируемой страницей).
export const TimelineQuery = t.Object({
  projectId: t.String({ format: 'uuid' }),
  from: IsoDate,
  to: IsoDate,
  group: t.Optional(
    t.Union([t.Literal('epic'), t.Literal('assignee'), t.Literal('sprint'), t.Literal('none')]),
  ),
  // Защита от перегруза payload. UI лениво подгружает следующее окно при
  // скролле — большие диапазоны разрешены, но cap на cardinality нужен.
  limit: t.Optional(t.Integer({ minimum: 1, maximum: 2000 })),
})

// Бар — один issue в Гант-окне. Поля заточены под рендер строки + drag/resize.
// Все date-поля — ISO YYYY-MM-DD. Если у issue нет одной из дат, мы её
// инферируем на клиенте (см. timeline/lib/geometry.ts).
export const TimelineBar = t.Object({
  id: t.String({ format: 'uuid' }),
  key: t.String(),
  summary: t.String(),
  issueTypeId: t.String({ format: 'uuid' }),
  issueTypeName: t.String(),
  issueTypeIconUrl: t.Union([t.String({ maxLength: 2048 }), t.Null()]),
  statusId: t.String({ format: 'uuid' }),
  statusName: t.String(),
  statusCategory: StatusCategory,
  assigneeId: t.Union([t.String(), t.Null()]),
  assigneeDisplayName: t.Union([t.String(), t.Null()]),
  epicJiraId: t.Union([t.String(), t.Null()]),
  sprintId: t.Union([t.String({ format: 'uuid' }), t.Null()]),
  sprintName: t.Union([t.String(), t.Null()]),
  startDate: t.Union([IsoDate, t.Null()]),
  dueDate: t.Union([IsoDate, t.Null()]),
  storyPoints: t.Union([t.Number(), t.Null()]),
  syncState: SyncState,
})

export const TimelineResponse = t.Object({
  projectId: t.String({ format: 'uuid' }),
  from: IsoDate,
  to: IsoDate,
  group: t.Union([
    t.Literal('epic'),
    t.Literal('assignee'),
    t.Literal('sprint'),
    t.Literal('none'),
  ]),
  items: t.Array(TimelineBar),
})

export type TimelineQuery = typeof TimelineQuery.static
export type TimelineBar = typeof TimelineBar.static
export type TimelineResponse = typeof TimelineResponse.static
