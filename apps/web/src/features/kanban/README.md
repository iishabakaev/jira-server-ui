# features/kanban — project-driven Kanban

The kanban surface is the daily-driver page of the app. Jira is treated as a
DB only: we never fetch board configurations from Jira. The UI picks a
**project** (fuzzy-search by key/name) and renders **our** column layout from
the statuses present in the project's issues.

## Contract

This feature talks to the server through one project-driven Eden endpoint
(plus issue mutations from `features/issues`):

| Verb | Path                              | Used by                        |
| ---- | --------------------------------- | ------------------------------ |
| GET  | `/api/projects` (with `?text=`)   | `useProjects()` *(in `features/projects`)* |
| GET  | `/api/projects/:id`               | `useProjectDetail(id)`         |
| GET  | `/api/projects/:id/kanban`        | `useProjectKanban(id, q)`      |

`KanbanQuery` (see `api.ts`) mirrors the server's `IssueFilter` minus
`projectIds` and `boardId` (project is in the path; boards are not used).

Columns for `groupBy=status` are derived server-side from `statuses` that
actually appear on the project's issues (ordered new → indeterminate → done,
then by name).

## URL contract

`apps/web/src/routes/kanban.tsx` defines a TypeBox search-param schema:

- `project`   — uuid of the active project (was `board` pre-refactor)
- `group`     — `status` (default) | `assignee` | `epic` | `priority` | `sprint`
- `density`   — `compact` | `comfortable` (default) | `spacious`
- `text`      — free-text search (server filters when length ≥ 2)
- `hideDone`  — boolean; when on, sends `statusCategories=['new','indeterminate']`

Saved views, `⌘K` palette, swimlanes, and quick-filter chips arrive in M8.

## Component map

```
features/kanban/
├── components/
│   ├── KanbanPage.tsx      # route container, owns URL <-> query coupling
│   ├── TopBar.tsx          # ProjectPicker + group + density + search
│   ├── Column.tsx          # virtualized column (@tanstack/react-virtual)
│   └── Card.tsx            # density-aware card with sync-state dot
├── hooks.ts                # TanStack Query keys + hooks
├── store.ts                # zustand UI-only state (selection, hover)
├── api.ts                  # Eden Treaty wrappers, KanbanError
├── types.ts                # local IssueSummary mirror (Eden source of truth)
└── index.ts                # public exports
```

The fuzzy `ProjectPicker` lives in `features/projects` and is shared with
`features/timeline`.

## Cross-feature rules

- Direct `fetch` is forbidden; everything goes through `lib/eden`.
- Cross-feature consumers may import from `index.ts` only.
- Server state in TanStack Query; transient UI state in zustand.

## What this feature deliberately does **not** do (yet)

- WIP-limit editor                            → **M8** (UI-only preset, no Jira board.config)
- Saved views                                 → **M8**
- Command palette (`cmdk`)                    → **M8**
- SSE patching (`issue.upserted`/`deleted`)   → enabled when `ssePlugin` ships fan-out (M3 finalisation)
- Issue-editor side panel                     → in `features/issue-editor`
