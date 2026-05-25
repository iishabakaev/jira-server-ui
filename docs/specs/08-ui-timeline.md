# 08 — UI: Timeline (Gantt with dependencies)

The Timeline view is for planning: spanning weeks/months, moving deadlines, drawing dependencies, comparing scope vs. capacity. The goal is faster planning than Jira's Plans/Advanced Roadmaps without leaving the team's data.

## Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Top bar: [Project ▾] [Group ▾]  filters  Zoom [W][2W][M][Q]  capacity ☐  │
├─────┬──────────────────────────────────────────────────────────────────────┤
│ ▼ E │ Mon  Tue  Wed  Thu  Fri  Sat  Sun  Mon  Tue  ...                    │
│  ▼ Epic — Onboarding revamp                                                │
│ ──  │ ████████████──┐                                                       │
│ AB-1│ Sign up flow  │                                                       │
│ ──  │     ◇────────►│██████████─┐                                           │
│ AB-2│      depends on AB-1, Email magic links                               │
│ ──  │                            │                                          │
│ ▼ Epic — Billing                 ▼                                          │
│ ──  │             ██████─────┐                                              │
│ BL-1│  Stripe import         │                                              │
│ ──  │                         │       (capacity row, when toggled)          │
│ ──  │  ░░░░░░░░░░░░░░░░░░░░░  J. Doe — 32h / 40h this week                  │
└─────┴──────────────────────────────────────────────────────────────────────┘
```

## Key UX decisions

### 1. Grouping options

Same axis system as kanban: `epic` (default), `assignee`, `sprint`, `team`. Group rows are collapsible; collapsed rows still show a rolled-up bar (min/max of children).

### 2. Direct manipulation

Every visible bar supports:

- **Drag body** → move the whole bar (changes both `startDate` and `dueDate`, keeping duration).
- **Drag right edge** → extend due date.
- **Drag left edge** → push start date.
- **Hover edge** → cursor changes to resize.
- **Click + Cmd-drag from edge** → start a dependency arrow.
- **Click bar** → side panel opens (`09-ui-issue-editor.md`).
- **Right-click** → context menu (assignment, sprint, priority, copy key, delete).

Each commit calls `PATCH /api/timeline/issues/:id/dates` and the same outbox flow applies — optimistic UI, sync status badge on the bar.

### 3. Dependency arrows

Two link types matter:

- `blocks` (outbound) / `is blocked by` (inbound).
- `relates to` (rendered dashed, no arrowhead).

Hovering an arrow highlights both endpoints. Clicking deletes (with confirm if not undoable). To create: hold `Cmd/Ctrl`, click and drag from one bar's edge to another. The arrow draws live, snap-to-bar.

### 4. Zoom

Four steps: **week**, **2 weeks**, **month**, **quarter**. Zoom changes pixel-per-day, snap unit (day vs. week), and label density. State in URL (`zoom=2w`).

### 5. Today line and milestones

- A vertical line marks today.
- "Milestone" issues (issue type configurable; defaults to `Milestone` if present, else just labeled `🏁`) render as a diamond not a bar.
- Sprint boundaries can be overlaid as faint vertical bands (toggle).

### 6. Capacity view (toggle)

When **Capacity** is on, each `assignee` group gets an extra row showing summed estimates per period vs. configured capacity (default 40h/week, configurable per user in settings). Bars over capacity get an amber background.

This pulls from `worklogs` (already in DB), `issues.time_estimate_s`, and `users.capacity_hours_per_week`. No Jira calls.

### 7. Filter / search

Same filter chip set as kanban, scoped to date window. URL-driven.

### 8. Lazy windowing

The visible date window determines the SQL `WHERE` clause; we only fetch bars whose `start_date <= window.end AND due_date >= window.start`. As the user scrolls horizontally, TanStack Query prefetches the next window.

### 9. Bulk planning mode (advanced)

`⌘ + Shift + P` enters bulk plan mode:

- Click a bar to select; range and multi-select supported.
- Arrow keys shift selected bars by snap unit.
- `=` and `-` adjust duration.
- `Enter` commits all changes in a single `batchPatch` outbox event.
- `Esc` reverts and exits the mode.

Why: planning often means "everything from here slides right by 3 days" — that needs a batch.

### 10. Cross-project view (admin)

If the user has multi-project access and selects `Project: all`, the timeline groups by project first, then epic. Useful for portfolio planning.

## Component map

```
features/timeline/
├── components/
│   ├── TimelinePage.tsx
│   ├── TopBar.tsx
│   ├── HeaderTrack.tsx         # date axis
│   ├── Body.tsx                # virtualized rows
│   ├── Row.tsx
│   ├── Bar.tsx                 # the issue bar (drag, resize, sync badge)
│   ├── DependencyLayer.tsx     # SVG overlay for arrows
│   ├── CapacityBar.tsx
│   └── BulkPlanOverlay.tsx
├── hooks/
│   ├── useTimeline.ts
│   ├── useBarDrag.ts
│   ├── useDependencyDraw.ts
│   └── useCapacity.ts
├── store.ts                    # zoom, selection, drag state, capacity toggle
├── api.ts
└── lib/
    ├── rank.ts                 # shared with kanban
    ├── geometry.ts             # date<->pixel conversions
    └── snap.ts
```

## Performance budget

- 2000 visible bars at month zoom: 60 fps drag — achieved by:
  - Bars positioned via CSS `transform: translateX(...)`; only the dragged bar mutates style during drag, others stay static.
  - DOM is virtualized vertically; the date track is fixed-cost per pixel.
  - Dependency arrows are drawn in a **single** SVG layer with a path-d string per arrow; on drag we only update the dragged endpoints.
- Window changes (scroll/zoom) target **< 100 ms** to next paint via incremental TanStack Query patches.

## Conflict handling

If a webhook arrives moving a bar the user is currently dragging, the live drag wins until the user releases; on release we reconcile (server merges and may report `conflict` → user gets a popover with both versions).

## Accessibility

- Bars are buttons; arrow keys move focus, Enter opens the side panel.
- Keyboard shift: `[`/`]` shift start/due by 1 snap unit; `Shift+[`/`]` shifts the whole bar.
- Screen reader: each bar reads "KEY: summary, from DATE to DATE, assignee NAME, status STATUS".

## Why not pull in a Gantt library?

Most libraries either (a) don't support live drag-from-bar dependencies, (b) lock the styling into their own design system, or (c) don't virtualize well. The data model is simple (bars + arrows), and the interactions are bespoke (capacity, bulk plan, sync badges). Owning the implementation is cheaper than fighting a library.

Acceptable fallback if implementation effort is over budget: `@gantt-task-react` or `wx-react-gantt` as a temporary scaffold, with the explicit plan to replace.
