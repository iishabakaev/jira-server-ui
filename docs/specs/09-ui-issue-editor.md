# 09 — UI: Issue Editor (Epic / Task+Subtasks unified)

A single editor surface for the three issue archetypes the company uses:

- **Epic** — root planning unit, holds child tasks.
- **Task** — work item that may have subtasks (process steps).
- **Subtask** — a step of its parent task (a sub-step of a process or "change task").

The goal: **avoid Jira's pattern of one full page per issue**. Instead, a Linear-style **side panel** that can promote to a focused full-screen view, with the parent context always visible.

## Where it opens from

- Kanban card click → side panel
- Timeline bar click → side panel
- `⌘ K` → "Open issue ABC-123"
- Direct URL `/issues/:key` → opens panel over the current page (URL preserves origin via `referrer` search param) OR opens full-screen if no origin

## Layout — side panel (default)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Kanban (dimmed)                       │  ABC-123  Task     ●synced   ⤢  ✕ │
│                                       ├────────────────────────────────────│
│                                       │ Epic: Onboarding revamp (ABC-100)  │
│                                       ├────────────────────────────────────│
│                                       │ Summary  ────────────────────────  │
│                                       │ [Allow social login                ]│
│                                       │                                    │
│                                       │ ▸ Description  (editor)            │
│                                       │                                    │
│                                       │ ▸ Subtasks (3 of 5 done)           │
│                                       │   ☑ ABC-124 — Wire Google IdP      │
│                                       │   ☑ ABC-125 — Wire GitHub IdP      │
│                                       │   ☐ ABC-126 — Email link expiry    │
│                                       │   ☐ ABC-127 — QA in staging        │
│                                       │   ☐ ABC-128 — Docs                 │
│                                       │   + Add subtask                    │
│                                       │                                    │
│                                       │ Properties                         │
│                                       │  Status      In progress      ▾    │
│                                       │  Assignee    @j.doe           ▾    │
│                                       │  Priority    High             ▾    │
│                                       │  Sprint      Sprint 32        ▾    │
│                                       │  Story pts   5                     │
│                                       │  Dates       2026-05-12 → 19       │
│                                       │  Labels      auth, mobile          │
│                                       │  Components  identity              │
│                                       │  Custom: Team   Platform           │
│                                       │                                    │
│                                       │ Links                              │
│                                       │  blocks      ABC-130 Stripe import │
│                                       │  related     ABC-99                │
│                                       │                                    │
│                                       │ Tabs: [Comments] [Activity] [Time] │
└───────────────────────────────────────┴────────────────────────────────────┘
```

## Key UX decisions

### 1. Subtasks inline, not a separate page

When viewing a task, subtasks render in a checklist directly under the description. Each row:

- Checkbox → toggles a transition (configurable: "Done" status, configurable in board settings).
- Click row → loads that subtask **into the same panel** with a breadcrumb back to the parent task.
- "Add subtask" inline-creates a new subtask (`POST /api/issues` with `parentKey`).
- Drag-reorder via dnd-kit.

This collapses the three-page Jira flow (parent → click subtask → back) into one surface.

### 2. Epic context strip

If the current issue is a task, the topmost strip shows the parent epic (key, summary, color). Click it to navigate the panel up to the epic. The epic view itself shows all child tasks as a mini-kanban inside the panel.

### 3. Editing is inline, not modal

- Click any property → inline editor at the same location.
- **Status picker lists all reachable statuses** (computed from the per-issue-type workflow graph), not just one-hop transitions. Selecting a status that requires multiple hops opens the **workflow wizard** (see §13 below).
- Assignee is a search box with avatars; supports `@me` shortcut.
- Dates use a single date-range picker with relative shortcuts ("today + 3d").
- Labels use a token input with autocomplete from existing labels in the project.

### 13. Workflow wizard (multi-step transitions)

The status picker decides what to do based on `POST /api/workflow/plan { issueKey, toStatusId }`:

- **0-hop** (target == current): no-op, dismiss.
- **1-hop with no required fields**: optimistic single-shot transition (the old single-call path).
- **1-hop with required fields** OR **multi-hop**: open the wizard.

Wizard layout:

```
┌─────────────────────────────────────────────────────────────────┐
│  Move ABC-123 to "Closed"                          ▔▔ 3 steps ▔▔│
│  Sprint backlog → In Progress → REVIEW → Closed                 │
├─────────────────────────────────────────────────────────────────┤
│  ● Step 1 — Sprint backlog → In Progress     (no fields needed) │
│  ● Step 2 — In Progress → REVIEW             (no fields needed) │
│  ● Step 3 — REVIEW → Closed                                     │
│      ┌────────────────────────────────────────────────┐         │
│      │ Resolution            ▾   [ Done            ▾ ]│         │
│      │ Closure reason        ▾   [ Completed       ▾ ]│         │
│      │ Closure notes              [                  ]│         │
│      └────────────────────────────────────────────────┘         │
│  ── Optional: leave a comment when the chain finishes ──        │
│  [                                                          ]   │
│                                              [Cancel] [Run ▶]   │
└─────────────────────────────────────────────────────────────────┘
```

While the chain runs:

- The status field shows "Closing… (2/3)" with a spinner.
- The card on the kanban shows the same step counter as a sync badge.
- SSE updates the wizard live; on success it auto-dismisses, on `paused` it re-opens with the failed step highlighted and a Retry button.

Implementation lives in `features/workflow-planner/`:

```
features/workflow-planner/
├── components/
│   ├── WorkflowWizard.tsx
│   ├── StepperHeader.tsx
│   ├── StepForm.tsx              # renders required fields per step
│   └── PlanProgress.tsx          # inline card-side progress badge
├── hooks/
│   ├── usePlan.ts                # plan + execute mutations
│   └── usePlanEvents.ts          # SSE subscription per planId
├── store.ts
├── api.ts
└── index.ts
```

The wizard reuses the same `fields/` form components as the issue editor — required fields render exactly the way they do in the right-rail properties grid. No duplicate widget tree.

### 4. Description editor

Rich-text editor — **TipTap** v2 — with:

- Markdown shortcuts (typing `#` → heading).
- Slash commands (`/heading`, `/quote`, `/check`, `/code`, `/mention`, `/issue`).
- Image paste — uploads to Jira via the attachments endpoint, returns an `attachmentId`, embeds as Jira-compatible reference.
- Output normalized to ADF (Atlassian Document Format) for round-tripping.
- Read mode by default; click anywhere to enter edit mode; auto-save on blur with a 1s debounce.

### 5. Save model

There is **no save button**. Every field commits on blur or selection. Each commit:

1. Optimistic update in TanStack Query cache.
2. Server `PATCH /api/issues/:key` with just the changed fields.
3. Sync state pip animates from `pending` → `pushing` → `synced`.

Bulk-staging is available via `⌘ ⏎` mode for power users: hold Cmd to defer commits, Enter to commit all.

### 6. Promote to full-screen

`⤢` button or `f`. The same component re-renders without the panel chrome, with a wider description area, a sticky sidebar on the right for properties.

### 7. Unified flow for "process / change task"

A "process task" is a task whose subtasks are steps. The editor treats it identically — there is no special-case page. Custom flow rules (e.g. "step 3 cannot start until step 2 done") are enforced server-side via outbox event preconditions, not via a separate UI.

If the company wants a visualized workflow per task type, future work can render a small Mermaid-like graph above the subtasks. The spec preserves space for it (`subtasksHeader` slot in `IssuePanel`).

### 8. Activity feed

A separate tab with: status transitions, assignee changes, comments, worklogs, link changes, attachments — chronological, with markers for "edit happened locally vs. in Jira" using sync_state metadata.

### 9. Quick create

Create a new issue without leaving the page:

- `c` from anywhere opens a slim create panel.
- Fields: type (epic/task/subtask), project, summary, parent (if subtask), epic (if task), assignee.
- Submit → DB insert + outbox push → row appears immediately in the kanban with sync_state=pending.

### 10. Linking

The Links section accepts: existing issue picker, paste a key/URL, paste a Jira issue picker URL. New links commit instantly and show sync state per link.

### 11. Comments

- Rich text via the same TipTap.
- `@mention` resolves against `users` table.
- Edit your own (within 5 minutes by default — configurable).
- Reactions postponed for v2.

## Routing model

```
/kanban?... → Kanban page
/timeline?... → Timeline page
/issues/:key?from=kanban&… → Opens IssuePanel as overlay over the from-page
/issues/:key?fullscreen=1 → Promotes to full page
```

When the panel closes, URL pops back to the underlying page's full URL (preserved in `from`).

## Component map

```
features/issue-editor/
├── components/
│   ├── IssuePanel.tsx              # the side panel chrome + slots
│   ├── IssueFull.tsx               # full-screen variant
│   ├── EpicContextStrip.tsx
│   ├── SubtaskList.tsx
│   ├── DescriptionEditor.tsx       # TipTap
│   ├── PropertiesGrid.tsx
│   ├── LinksList.tsx
│   ├── ActivityTab.tsx
│   ├── CommentsTab.tsx
│   ├── WorklogTab.tsx
│   ├── QuickCreate.tsx
│   └── fields/
│       ├── StatusField.tsx
│       ├── AssigneeField.tsx
│       ├── DateRangeField.tsx
│       ├── LabelsField.tsx
│       ├── PriorityField.tsx
│       ├── SprintField.tsx
│       ├── StoryPointsField.tsx
│       └── CustomField.tsx          # generic, driven by schema
├── hooks/
│   ├── useIssue.ts                  # query + mutations
│   ├── useTransitions.ts
│   ├── useAdfEditor.ts
│   └── useFieldSchema.ts            # field config + custom field map
├── store.ts                          # panel open state, draft buffer
├── api.ts
└── index.ts
```

## Field config

Field rendering is **data-driven**. `useFieldSchema(projectId, issueType)` returns:

```ts
type FieldDef = {
  key: string            // 'assignee', 'customfield_10010'
  label: string
  kind: 'user'|'date'|'date-range'|'select'|'multiselect'|'text'|'number'|'tokens'|'option'|'cascading'
  options?: Option[]
  required?: boolean
  readOnly?: boolean
  hidden?: boolean
  order: number
  group: 'properties'|'planning'|'people'|'custom'
}
```

The customfield map (from `projects.metadata.customfield_map`) is the bridge between Jira's opaque ids and our typed components. Admins can re-order or hide fields per project in `/settings/projects/:id/fields`.

## Validation

- Client validates against Zod (`packages/contracts/issue`) for instant feedback.
- Server re-validates and additionally enforces "Jira-shape" rules (e.g. you can't set `sprint` on an issue type that doesn't support sprints in that project).
- A 409 from Jira (e.g. transition no longer allowed) flows back to the field with an inline error and a "refresh field schema" link.

## Empty / loading

- Skeleton fields render immediately so the layout doesn't shift.
- If the issue is freshly created and `sync_state=pending`, the key shows as `(creating…)` until Jira returns a key.

## Accessibility

- Panel is a focus-trap dialog with `aria-modal="true"` (when overlayed).
- Esc closes; focus returns to the trigger.
- All inline editors are reachable via Tab; Space/Enter activates them; Esc cancels the edit.
