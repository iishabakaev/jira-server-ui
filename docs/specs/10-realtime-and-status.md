# 10 — Realtime & Sync Status

A single contract for how the UI learns about state changes and how it tells the user that "something is happening in the background".

## Channel

- **Transport**: Server-Sent Events at `GET /api/events`.
- **Subscription**: query string `?topics=`. Topics use a coarse-to-fine pattern:
  - `user` — events targeted at the current user (toasts, sync errors against their PAT)
  - `kanban:<boardId>` — invalidations for a kanban view
  - `timeline:<projectId>` — invalidations for a timeline view
  - `issue:<key>` — fine-grained per-issue stream (open editor subscribes here)
  - `sync` — sync infra events (admin dashboard)
- **Heartbeat**: `event: ping` every 15s.
- **Resume**: clients pass `Last-Event-ID`; server replays from a Postgres UNLOGGED table `sse_events` (default retention 5 minutes, cleanup every 60s).
- **Fan-out**: `pg_notify('sse:<topic>', payload)`; each Elysia process holds one `LISTEN` per active topic. No Redis.

## Event shapes

```jsonc
// generic envelope
{
  "id": "1729-2",
  "type": "issue.upserted",
  "topic": "kanban:abc",
  "data": { /* type-specific */ },
  "ts": "2026-05-15T10:11:12.345Z",
  "origin": "webhook"   // 'webhook' | 'outbox' | 'local'
}
```

Types:

- `issue.upserted` — `{ id, key, fields:{...minimal}, syncState, etag }`
- `issue.deleted` — `{ id, key }`
- `issue.rank-changed` — `{ id, statusId?, rank }`
- `link.upserted` / `link.deleted`
- `comment.upserted` / `comment.deleted`
- `worklog.upserted`
- `sprint.upserted`
- `sync.state-changed` — `{ targetKind, targetId, prev, next, error? }`
- `sync.conflict` — `{ targetKind, targetId, conflictId }`
- `sync.failed` — `{ targetKind, targetId, lastError }`
- `workflow.plan.created` — `{ planId, issueId, issueKey, totalSteps }`
- `workflow.step.started` — `{ planId, seq, fromStatusName, toStatusName }`
- `workflow.step.done` — `{ planId, seq, toStatusName }`
- `workflow.step.failed` — `{ planId, seq, error }`
- `workflow.plan.paused` — `{ planId, error }`
- `workflow.plan.done` — `{ planId, finalStatusName }`
- `workflow.plan.cancelled` — `{ planId }`
- `auth.pat-needs-reattach`
- `toast` — `{ severity, message, action? }`

## Client integration

`apps/web/src/lib/sse.ts` is a singleton manager:

```ts
sse.subscribe(['kanban:abc'], (evt) => {
  switch (evt.type) {
    case 'issue.upserted':
      queryClient.setQueryData(['kanban', 'abc', filterKey], applyUpsert(evt))
      break
    case 'issue.rank-changed':
      queryClient.setQueryData(...)
      break
    case 'issue.deleted':
      queryClient.setQueryData(...)
      break
  }
})
```

Rules:

- **Never refetch on every event.** We patch the cached query data in place.
- **Coalesce bursts**: events arriving within 16 ms for the same key are merged (last-wins) before applying.
- **Out-of-order safety**: every event carries `etag`/`updatedAt`; client ignores an event older than the cached version.

## Sync state visibility (the user-facing contract)

Every entity that can be edited has a `sync_state`. The user always sees it.

| State      | Visual                                  | Card / row badge                   | Editor header                       |
| ---------- | --------------------------------------- | ---------------------------------- | ----------------------------------- |
| `synced`   | nothing                                 | (none)                             | "Synced ✓" (subtle)                 |
| `pending`  | amber dot + tooltip "Will sync to Jira" | amber dot                          | "Pending sync"                      |
| `pushing`  | blue spinner ring                       | small spinner ring on dot          | "Syncing…"                          |
| `error`    | red dot + retry                         | red dot                            | red banner with last error + Retry  |
| `conflict` | purple dot + "Resolve"                  | purple dot                         | purple banner with Compare + Resolve|

Hover any badge → popover with:

- Last attempt at: …
- Attempts: N
- Last error (if any): "…"
- Buttons: **Retry now** / **Open conflict** / **Discard local change** (for admin)

## Conflict resolution UX

When a conflict is detected (push response indicates Jira changed the same fields):

1. UI shows a purple banner on the affected card/row.
2. Editor panel shows **two columns** (Local | Jira) for the conflicting fields.
3. Actions:
   - "Keep mine" — re-push, overwrite Jira.
   - "Keep Jira" — discard local, pull Jira's value.
   - "Merge" — open a small form where the user picks per-field.
4. Resolution writes a fresh outbox event with `kind: 'issue.update.resolveConflict'`.

The conflicts table holds the snapshot of both sides, so the user can leave and return to resolve later.

## Optimistic UI rules

- Always optimistic for: rank, status transition (within allowed transitions), assignee, priority, due/start date, label add/remove, comment add.
- Optimistic-with-warning for: status transition that requires a workflow screen we don't render — we attempt the transition; if Jira requires fields, the response triggers a "Complete transition" dialog and the issue goes back to its prior status until the user finishes.
- Never optimistic for: issue create (we wait for Jira's `key` to come back — but we still show a placeholder card with `(creating…)` and a sync badge).

## Backpressure

If a worker reports the outbox depth > N (configurable, default 100), the UI shows a small inline banner on affected boards: "Sync is catching up — your changes will be applied shortly." Editing still works.

## Connection lifecycle

- On first paint, open the SSE connection with current topics.
- When the user navigates, update the topic set (we send a `replaceTopics` cookie-encoded preference; or reopen the connection — simpler).
- On reconnect, replay missed events from `sse_events`; if `Last-Event-ID` is older than the retention window, server responds `event: snapshot-required` and the client does a single TanStack Query refetch.

## Testing the realtime path

- `apps/server/tests/sse.test.ts` covers: subscribe, publish, replay-by-last-id, heartbeat.
- `apps/web/tests/sse.test.ts` mocks an EventSource and asserts queryClient cache patches.
