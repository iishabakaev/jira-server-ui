# 06 — API Surface

Elysia + Eden Treaty. Validation is **Elysia's built-in TypeBox via `t.*`** — there is no Zod, no `packages/contracts`. The frontend imports `type App = typeof app` from `@eden` and uses `treaty<App>()` for transport. Types flow from `t.Object({...})` definitions on every route.

## Conventions

- Prefix: `/api`.
- Auth: cookie-session; `requireAuth` macro applied at the module level.
- Validation: inline `body: t.Object({...})`, `query: t.Object({...})`, `params: t.Object({...})`, `response: { 200: t.Object({...}), 400: t.Object({...}) }`.
- Errors: a uniform shape `{ error: { code, message, details? } }`. `4xx` for client, `5xx` for server, `409` for sync conflicts, `423` for rate-limit / locked.
- IDs: routes always state whether they accept the issue **key** (`ABC-123`) or our internal **UUID**.
- Pagination: cursor-based; cursor is opaque `base64url`.

## Bootstrap

```ts
// apps/server/src/index.ts
import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { cors } from '@elysiajs/cors'
import { staticPlugin } from '@elysiajs/static'
import { auth } from './plugins/auth'
import { errorPlugin } from './plugins/error'
import { sse } from './plugins/sse'
import { authModule } from './modules/auth/routes'
import { usersModule } from './modules/users/routes'
import { issuesModule } from './modules/issues/routes'
import { boardsModule } from './modules/boards/routes'
import { timelineModule } from './modules/timeline/routes'
import { workflowModule } from './modules/workflow/routes'
import { syncModule } from './modules/sync/routes'

export const app = new Elysia({ prefix: '/api' })
  .use(errorPlugin)
  .use(cors({ credentials: true }))
  .use(auth)
  .use(sse)
  .use(authModule)
  .use(usersModule)
  .use(issuesModule)
  .use(boardsModule)
  .use(timelineModule)
  .use(workflowModule)
  .use(syncModule)
  .use(swagger({ path: '/docs', exclude: ['/api/webhooks/jira'] })) // opt-in OpenAPI
  .listen({ port: Bun.env.PORT ?? 3000 })

export type App = typeof app
```

## Schema patterns (Elysia `t.*`)

Reused, named pieces live in `apps/server/src/modules/<mod>/schema.ts`. Example:

```ts
// apps/server/src/modules/issues/schema.ts
import { t } from 'elysia'

export const SyncState = t.Union([
  t.Literal('synced'),
  t.Literal('pending'),
  t.Literal('pushing'),
  t.Literal('error'),
  t.Literal('conflict'),
])

export const IssueFilter = t.Object({
  projectIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
  boardId:    t.Optional(t.String({ format: 'uuid' })),
  sprintIds:  t.Optional(t.Array(t.String({ format: 'uuid' }))),
  assigneeIds:t.Optional(t.Array(t.String())),
  epicKeys:   t.Optional(t.Array(t.String())),
  statusCategories: t.Optional(t.Array(t.Union([
    t.Literal('new'), t.Literal('indeterminate'), t.Literal('done'),
  ]))),
  labels:     t.Optional(t.Array(t.String())),
  components: t.Optional(t.Array(t.String())),
  priorities: t.Optional(t.Array(t.String())),
  text:       t.Optional(t.String()),
  updatedAfter: t.Optional(t.String({ format: 'date-time' })),
  groupBy:    t.Optional(t.Union([
    t.Literal('status'), t.Literal('assignee'),
    t.Literal('epic'), t.Literal('priority'),
  ])),
  cursor:     t.Optional(t.String()),
  limit:      t.Optional(t.Integer({ minimum: 1, maximum: 500 })),
})

export const IssuePatch = t.Partial(t.Object({
  summary:     t.String({ minLength: 1 }),
  description: t.Any(),                              // ADF or wiki, opaque
  assigneeId:  t.Nullable(t.String()),
  priorityId:  t.Nullable(t.String()),
  labels:      t.Array(t.String()),
  dueDate:     t.Nullable(t.String({ format: 'date' })),
  startDate:   t.Nullable(t.String({ format: 'date' })),
  storyPoints: t.Nullable(t.Number()),
  sprintId:    t.Nullable(t.String({ format: 'uuid' })),
  epicKey:     t.Nullable(t.String()),
  parentKey:   t.Nullable(t.String()),
  customFields:t.Record(t.String(), t.Unknown()),
}))
```

Eden Treaty derives `IssuePatch` and `IssueFilter` types on the frontend automatically — no `infer<…>`, no codegen.

## Module → route map

### `auth`

```
POST   /api/auth/keycloak/login         → 302 (no body)
GET    /api/auth/keycloak/callback      → 302 + Set-Cookie
POST   /api/auth/local/login            body: {username, password}
POST   /api/auth/local/change-password  requireAuth + provider=local
POST   /api/auth/logout                 → 204
GET    /api/auth/me                     → { user, jiraConnected, ... }
POST   /api/auth/jira-pat               body: {token}
DELETE /api/auth/jira-pat
GET    /api/auth/jira-pat/test
```

### `users`

```
GET    /api/users?q=…&ids=…    → autocomplete from local mirror
GET    /api/users/:id          → details
```

### `issues`

```
GET    /api/issues                          → list grouped by `groupBy`
GET    /api/issues/:keyOrId                 → full issue
POST   /api/issues                          → create (via outbox)
PATCH  /api/issues/:keyOrId                 → partial update
POST   /api/issues/:keyOrId/transition      → SINGLE-hop transition (no required fields)
                                              for multi-hop, see /api/workflow/*
DELETE /api/issues/:keyOrId                 → soft delete
POST   /api/issues/:keyOrId/comments        → add comment
PATCH  /api/issues/:keyOrId/comments/:cid   → edit
DELETE /api/issues/:keyOrId/comments/:cid
POST   /api/issues/:keyOrId/worklogs        → log work
POST   /api/issues/:keyOrId/links           → create link
DELETE /api/issues/links/:id
POST   /api/issues/:keyOrId/rank            → reorder card
POST   /api/issues/batch-rank               → atomic multi-card reorder
GET    /api/issues/:keyOrId/transitions     → cached reachable statuses (for status picker)
```

Example route declaration:

```ts
// apps/server/src/modules/issues/routes.ts
issuesModule.patch(
  '/:keyOrId',
  async ({ params, body, user, set }) => {
    const next = await issuesService.patch(user!.id, params.keyOrId, body)
    return { issue: next }
  },
  {
    requireAuth: true,
    params: t.Object({ keyOrId: t.String() }),
    body: IssuePatch,
    response: {
      200: t.Object({ issue: IssueSummary }),
      404: ErrorEnvelope,
      409: ErrorEnvelope,
    },
  },
)
```

### `boards`

```
GET    /api/boards                       → list user-visible boards
GET    /api/boards/:id                   → details + column→status mapping
GET    /api/boards/:id/kanban            → grouped cards (uses /issues filter under the hood)
PATCH  /api/boards/:id/wip-limits        → local-only WIP limits
GET    /api/boards/:id/views             → saved views
POST   /api/boards/:id/views
DELETE /api/boards/:id/views/:viewId
```

### `timeline`

```
GET    /api/timeline                       → bars + links for a window
PATCH  /api/timeline/issues/:id/dates      → { startDate?, dueDate? }
POST   /api/timeline/links                 → blocks/relates
DELETE /api/timeline/links/:id
```

### `workflow` (new)

```
POST   /api/workflow/plan                  body: { issueKey, toStatusId }
                                            → PlanPreview (see 14-workflow-engine.md)
POST   /api/workflow/execute               body: { planId, fieldValuesByStep, finalComment? }
                                            → { planId, state }
GET    /api/workflow/plans/:id             → plan + steps + last error
POST   /api/workflow/plans/:id/retry       → resume from failed step
POST   /api/workflow/plans/:id/cancel      → cancel a draft/queued/paused plan
GET    /api/workflow/active?issueKey=…     → current active plan for an issue, if any
```

TypeBox shapes for the planner:

```ts
// apps/server/src/modules/workflow/schema.ts
export const TransitionFieldReq = t.Object({
  field: t.String(),
  name: t.String(),
  required: t.Boolean(),
  schemaType: t.String(),
  allowedValues: t.Optional(t.Array(t.Object({
    id: t.String(),
    value: t.Optional(t.String()),
    name: t.Optional(t.String()),
  }))),
})

export const PlanPreview = t.Object({
  planId: t.String(),
  totalSteps: t.Integer(),
  hasRequiredFields: t.Boolean(),
  steps: t.Array(t.Object({
    seq: t.Integer(),
    fromStatusName: t.String(),
    toStatusName: t.String(),
    transitionName: t.String(),
    requiredFields: t.Array(TransitionFieldReq),
  })),
})

export const ExecuteBody = t.Object({
  planId: t.String({ format: 'uuid' }),
  fieldValuesByStep: t.Record(t.String(), t.Record(t.String(), t.Unknown())),
  finalComment: t.Optional(t.String()),
})
```

### `sync`

```
POST   /api/webhooks/jira                  → shared-secret header, persists raw, 200 immediately
GET    /api/sync/status                    → operator dashboard data
POST   /api/sync/projects/:id/full-sync    → admin only
POST   /api/sync/outbox/:id/retry          → admin only
GET    /api/sync/outbox                    → admin: pending|error|dead
GET    /api/sync/conflicts                 → unresolved conflicts for current user
POST   /api/sync/conflicts/:id/resolve     → { strategy: 'keep_local'|'keep_remote'|'merge', merged? }
```

### `sse`

```
GET    /api/events?topics=kanban:abc,issue:ABC-123,workflow,sync
       Headers: Last-Event-ID  (for replay)
       Response: text/event-stream
```

The Elysia process opens a `LISTEN` on each subscribed topic channel and fans `NOTIFY` payloads to connected EventSource clients. Replay buffer lives in an UNLOGGED Postgres table (`sse_events`). See `15-performance.md`.

Event shapes are documented in `10-realtime-and-status.md`.

## Eden Treaty client

```ts
// apps/web/src/lib/eden.ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@eden'

export const api = treaty<App>(import.meta.env.VITE_API_URL, {
  fetch: { credentials: 'include' },
})
```

Usage:

```ts
const { data, error } = await api.issues({ keyOrId: 'ABC-123' }).patch({
  assigneeId: someUserId,
  storyPoints: 5,
})
```

All shapes here are TypeBox types from the server — no `import`-from-contracts step.

## Error code catalog

| HTTP | code                       | when                                              |
| ---- | -------------------------- | ------------------------------------------------- |
| 400  | `validation_failed`        | TypeBox rejected the body/query/params            |
| 401  | `unauthenticated`          | no session                                        |
| 403  | `forbidden`                | role check failed                                 |
| 404  | `not_found`                | unknown id/key                                    |
| 409  | `sync_conflict`            | conflicting state with Jira (write-time)          |
| 409  | `optimistic_lock_failed`   | etag mismatch on PATCH                            |
| 409  | `workflow_active`          | another plan is already running for this issue    |
| 422  | `no_workflow_path`         | planner could not reach `toStatusId`              |
| 423  | `jira_locked`              | rate-limited; client should back off              |
| 502  | `jira_unavailable`         | upstream error                                    |
| 500  | `internal`                 | catch-all                                         |

## OpenAPI

`@elysiajs/swagger` is mounted at `/api/docs` (opt-out via `EXPOSE_OPENAPI=false`). For *internal* consumers, Eden Treaty is preferred — the OpenAPI doc is for external clients only.

## Why not OpenAPI codegen?

Elysia's typed surface + Eden Treaty give us the *same* DX without a generation step. Codegen tools introduce stale-types failure modes; an inline `t.Object({...})` cannot drift.

## Why TypeBox instead of Zod?

- Elysia already speaks TypeBox natively; using Zod adds a translation layer.
- Eden Treaty derives types from the TypeBox declaration directly — no `z.infer<…>` step.
- Validation runs at the Elysia boundary with its compiled validator; faster than Zod.
- A single shared schema definition appears once, in the route file. The frontend, the backend, and Swagger all consume it.
