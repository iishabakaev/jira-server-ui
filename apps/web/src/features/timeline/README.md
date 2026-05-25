# features/timeline — Gantt-планировщик (Milestone 7, MVP)

## Scope (MVP)

- `GET /api/timeline?projectId&from&to&group` returns flat bars (one issue per row).
- Vertical virtualization (`@tanstack/react-virtual`).
- Drag body → moves both `startDate` and `dueDate`.
- Drag right edge → resizes `dueDate`.
- Drag left edge → resizes `startDate`.
- Click → opens issue editor at `/issues/$key`.
- Today line + week stripes + month/week header.
- Zoom: `week | 2w | month | quarter` (URL `?zoom=`).
- Group: `epic | assignee | sprint | none` (URL `?group=`).
- Project selector populated from `GET /api/boards` (one row per distinct
  `projectId`).
- Optimistic patch: `PATCH /api/issues/:k` writes `outbox_events` row in
  the same transaction; sync pip on the bar turns amber → green.

## Deferred (M7-follow-up)

- Dependency arrows (`blocks` / `is blocked by`) and live drag-to-link.
- Capacity overlay (per-assignee row, summed `time_estimate_s` vs.
  `users.capacity_hours_per_week`).
- Bulk-plan mode (`⌘+Shift+P`, arrow-keys-shift, batch outbox).
- Keyboard `[`/`]` shift handles.
- `mv_timeline_bar` materialized view (current MVP does a join-only query —
  fine while project size ≤ ~10k issues).
- SSE-driven invalidation (currently relies on TanStack Query `staleTime`).
- Dedicated `GET /api/projects` endpoint (we proxy via boards on MVP).
- Per-project membership checks on `/api/timeline` (and `/api/issues`) —
  shared M9 work; current MVP behaves the same as kanban list.

## Post-review hardening (M7.1)

After multi-agent review the following were applied in the same milestone:

- Server: `from <= to` + max-window (732 days) guard in `service.window()`,
  with 3 unit tests in `service.test.ts`.
- Server: dropped dead `or(...isNull)` overlap branch in `queries.ts`.
- Web: `parseIsoDate` now throws `RangeError` on malformed input (previously
  silently returned `Invalid Date`).
- Web: `HeaderTrack.todayX` uses the shared `dateToX` helper instead of
  re-inlining `PX_PER_DAY`.
- Web: `Bar` has a re-entry guard on `pointerdown` and unmount-only cleanup
  via `dragRef`; dead `dragDistanceDays` / `previewInterval` exports removed.

## Files

```
features/timeline/
├── components/
│   ├── TimelinePage.tsx       page shell + search-state ↔ TanStack Query
│   ├── TopBar.tsx             project / group / zoom / today / refresh
│   ├── HeaderTrack.tsx        date axis (month + day/week ticks)
│   ├── Body.tsx               virtualized rows + week-stripe overlay
│   ├── Row.tsx                one row (group header or bar)
│   └── Bar.tsx                drag/resize bar with sync pip + a11y label
├── hooks.ts                   useTimelineWindow / usePatchIssueDates
├── store.ts                   transient drag preview, selection
├── api.ts                     Eden Treaty wrappers
├── lib/geometry.ts            pure date↔pixel + buildRows + headerTicks
├── types.ts                   shared TimelineBar / Zoom / RowEntry
└── index.ts                   barrel
```

## Server contract

`apps/server/src/modules/timeline/`:

- `schema.ts` — TypeBox `TimelineQuery` / `TimelineBar` / `TimelineResponse`.
- `queries.ts` — single SQL: project + window-overlap on `coalesce(start,
  due)` ≤ `to` AND `coalesce(due, start)` ≥ `from`. Excludes issues
  with both dates null.
- `service.ts` — `window(query) → TimelineResponse`. Pass-through; grouping
  is client-side.
- `routes.ts` — `GET /api/timeline`, `requireAuth`.

Date mutations reuse the existing `PATCH /api/issues/:k` flow
(`issuesMutations.patch` already accepts `startDate` / `dueDate` and
writes the outbox row in the same transaction).
