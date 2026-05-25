# 07 — UI: Kanban (main page)

The Kanban view is the daily-driver surface. Designed for **speed** (sub-second paint), **scan-ability** (grouping, density, color-coding), and **decisive editing** (inline edits, optimistic DnD, command palette).

## Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Top bar:  [Project ▾] [Board ▾]   filters   ────────  views   ⌘K  user  │
│  Sub bar:  [Group: Status ▾]  [Layout: Columns/Swimlanes ▾]  [Density ▾]│
├──────────────────────────────────────────────────────────────────────────┤
│  ▼ Swimlane: Epic — "Onboarding revamp"                       3 / 8 done │
│  ┌──── To Do (5) ──┐ ┌── In Progress (3) ──┐ ┌── Review (2) ┐ ┌─ Done ─┐│
│  │ ▓ card           │ │ ▓ card               │ │ ▓ card        │ │ card  ││
│  │ ▓ card  ●sync    │ │ ▓ card               │ │               │ │ card  ││
│  │ ▓ card           │ │ ▓ card               │ │               │ │       ││
│  └──────────────────┘ └──────────────────────┘ └───────────────┘ └───────┘│
│  ▼ Swimlane: Epic — "Billing"                                  1 / 5 done │
│  …                                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

## Key UX decisions (and why)

### 1. Group + Layout are two independent axes

- **Group by**: `status` (default), `assignee`, `epic`, `priority`, `sprint`. Determines **columns**.
- **Layout**: `columns` (single horizontal lane) or `swimlanes` (rows). Determines whether we further split by a second axis.

Combination examples:

| Group  | Layout         | What you see                                                  |
| ------ | -------------- | ------------------------------------------------------------- |
| status | columns        | Classic Jira board                                            |
| status | swimlanes:epic | Linear-style: every epic gets a horizontal lane               |
| assignee | columns      | "Who's doing what" pivot                                      |
| epic   | columns        | One column per epic, drag tasks between epics                 |

Picked because: Jira's built-in swimlanes are awkward, and splitting "group" from "layout" maps cleanly to how teams actually want to slice the board.

### 2. Filters live in the URL

TanStack Router search-param schema:

```ts
const kanbanSearch = z.object({
  project: z.string().optional(),
  board:   z.string().optional(),
  group:   z.enum(['status','assignee','epic','priority','sprint']).default('status'),
  layout:  z.enum(['columns','swimlanes-epic','swimlanes-assignee','swimlanes-sprint']).default('columns'),
  density: z.enum(['compact','comfortable','spacious']).default('comfortable'),
  assignees: z.array(z.string()).optional(),
  epics:     z.array(z.string()).optional(),
  sprints:   z.array(z.string()).optional(),
  labels:    z.array(z.string()).optional(),
  priorities:z.array(z.string()).optional(),
  text:      z.string().optional(),
  hideDone:  z.boolean().default(false),
  viewId:    z.string().optional(),   // saved view loader
})
```

This makes every view shareable as a URL and survives page reload without state-management gymnastics.

### 3. Saved views

`/api/boards/:id/views`. A view is `{ id, name, ownerId, shared: boolean, search: KanbanSearch }`. Top bar exposes "My views" and "Shared views". Cmd+S saves current URL state as a view; Cmd+Shift+S to update an existing view.

### 4. Density

- `compact`: 1-line summary, no avatars, key only.
- `comfortable` (default): summary + key + assignee avatar + epic chip + priority icon + sync state dot + small footer.
- `spacious`: also shows description preview, labels, due date.

Density is a Tailwind variant on the card; we don't ship three card components.

### 5. Drag and drop

`@dnd-kit/core`. On drop:

1. Compute new `ordering_rank` between neighbors (LexoRank-compatible string algorithm — see `lib/rank.ts`).
2. Optimistically update the TanStack Query cache (`setQueryData`).
3. Fire `POST /api/issues/batch-rank` with `{ id, statusId?, rank }`. The "batch" endpoint exists because a single drag can imply both a column move (status transition) and a rank move.
4. Server commits in one tx, enqueues outbox push, returns the new authoritative rank.
5. On error, the optimistic update is rolled back and the card shows a red border + tooltip.

Why LexoRank-style strings: lets us insert between two cards without renumbering, which is critical for kanban performance and matches Jira's own scheme.

### 6. WIP limits (local-only)

WIP limits are stored on `boards.metadata.wipLimits` and don't leak to Jira. When a column exceeds its limit:

- Column header turns amber.
- Drag in is permitted (we don't block work) but a toast warns.
- Tooltip explains "WIP limit is configured by team-admin".

### 7. Quick filters bar

Always-visible chips below the top bar: "Mine", "Unassigned", "Due this week", "Blocked", "Recently updated". They toggle pre-built filter sets. Hidden by default for `density=compact`.

### 8. Selection and multi-action

- Click selects (single).
- Shift-click range-selects within a column.
- Cmd/Ctrl-click toggles.
- Selected cards get a docked action bar at the bottom: assign, label, move to sprint, transition, archive, copy keys.

### 9. Command palette (⌘K)

`cmdk` library. Sections:

- **Navigate**: go to issue by key/summary, jump to board, jump to user's queue.
- **Filter**: pre-built filter chips become commands.
- **Mutate**: transition selected, assign to me, set priority, add label.
- **Create**: new issue (opens issue editor preselected to current project/epic).
- **Toggle**: density, group, layout, hideDone.

Every action with a hotkey shows the hotkey in the palette.

### 10. Sync status indicators

Each card has a 6px dot in the footer:

| Color   | State        | Meaning                                |
| ------- | ------------ | -------------------------------------- |
| (none)  | `synced`     | quiet                                  |
| amber   | `pending`    | local change not yet pushed            |
| blue (animated) | `pushing` | being pushed right now              |
| red     | `error`      | push failed, retrying                  |
| purple  | `conflict`   | manual resolution required             |

Hover for tooltip. Click on amber/red opens a small popover with "Retry now" and the last error.

### 11. Subtasks and progress

If `density != compact`, an Epic card shows a progress bar (done / total) sourced from `epic_jira_id` aggregations. A task with subtasks shows `[3/5]` next to the key.

### 12. Performance budget

- **Virtualized columns**: `@tanstack/react-virtual`, fixed-height cards per density.
- **No N+1 queries**: kanban data is one request returning groups+cards from `mv_kanban_card`.
- **TanStack Query**: `staleTime: 30s`, `gcTime: 5min`. SSE invalidates the query for events touching the current filter scope.
- **Memoization**: rely on React Compiler; no manual `useMemo`/`useCallback` except where the compiler can't see through (e.g. dnd-kit listeners).
- **CSS-only hover effects**: no JS for visual states.
- **Initial paint**: the first request gates rendering, but we render the column skeleton immediately so the user sees structure within ~50 ms.

## Component map

```
features/kanban/
├── components/
│   ├── KanbanPage.tsx          # route container
│   ├── TopBar.tsx
│   ├── SubBar.tsx              # group/layout/density selectors
│   ├── FilterChips.tsx
│   ├── BoardGrid.tsx           # owns layout (columns vs swimlanes)
│   ├── Swimlane.tsx
│   ├── Column.tsx              # virtualized
│   ├── Card.tsx
│   ├── SelectionBar.tsx
│   ├── SavedViews.tsx
│   └── EmptyState.tsx
├── hooks/
│   ├── useKanban.ts            # composes router state + query + sse
│   ├── useDnd.ts               # dnd-kit wiring
│   ├── useSelection.ts
│   └── useViews.ts
├── store.ts                    # transient UI (drag preview, hover, selection)
├── api.ts                      # api.boards[id].kanban.get(...), batch-rank, ...
└── index.ts
```

## Edge cases (must handle)

- **Status not in the board's columns**: still shown in a synthetic "Other" column at the right, opt-in to hide.
- **Issue moves out of filter scope due to a webhook**: animate out of the board.
- **User loses Jira connectivity mid-drag**: card snaps back, banner appears.
- **Rank collision** between optimistic and reconciled value: server response is authoritative; TanStack Query refetch the affected pair.
- **Permission lost mid-session**: server returns 403; UI shows a "read-only" banner and disables drag.

## Accessibility

- All actions reachable by keyboard.
- DnD has a keyboard mode (`dnd-kit` `KeyboardSensor`): pick up with Space, arrows to move, Space to drop, Esc to cancel. Announce moves with a polite ARIA live region.
- Color is never the only signal — sync states also have an icon glyph.
