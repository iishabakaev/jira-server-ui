# 05 — Sync Engine

The sync engine is the heart of the system. It owns four flows:

1. **Backfill** (initial / configurable window) — pull bounded history from Jira into the DB.
2. **Incremental ingest** — Jira webhooks (preferred) + a polling safety net for any project the webhook missed.
3. **Write-back** — every UI mutation flows through the **transactional outbox** and is pushed to Jira asynchronously, with retries.
4. **Workflow execution** — drives multi-step transition plans (`14-workflow-engine.md`) by enqueuing one outbox row per step and waiting for each to land before advancing.

The default queue is **pg-boss** (Postgres-only — no extra service). The abstraction in `apps/jobs/src/lib/queue.ts` exposes `enqueue`, `defer`, `schedule` so engines depend on the interface, not the implementation. Trigger.dev v3 remains a drop-in replacement if a deployment wants its DAG UI.

## Design rules (do not violate)

1. **The UI never calls Jira.** It calls our server.
2. **The server's mutation endpoints never call Jira.** They write to the DB and append an outbox row in the **same transaction**.
3. **Workers are the only code that talks to Jira REST.** They hold PATs, respect rate limits, and reconcile responses back into the DB.
4. **Every outbound side effect is idempotent.** The `idempotency_key` on `outbox_events` is the deduplication boundary.
5. **Every state-changing webhook is applied through a normalizer**, never directly into row updates from raw payload shapes.
6. **A change with `sync_state != 'synced'` is visible in the UI with a status indicator** (see `10-realtime-and-status.md`).

## Flow 1 — Backfill (full sync)

Triggered by:

- App admin clicks "Run full sync" on a project.
- First connection of a new project (auto).
- A persistent drift detector (see below) decides the cursor is unreliable.

Implementation: `apps/jobs/src/tasks/full-sync.ts`, a pg-boss job with internal checkpoints.

```
inputs:  { projectId, sinceISO?, untilISO?, requestedBy }
outputs: { issueCount, durationMs, finishedAt }

steps:
  1. lock(projectId)                        -- one full sync per project at a time
  2. refresh-metadata(projectId)            -- project, issueTypes, statuses, fields, link types
  3. refresh-board-config(projectId)        -- ONE call to /rest/agile/1.0/board/{id}/configuration per board
  4. refresh-sprints(projectId)             -- /rest/agile/1.0/board/{id}/sprint?state=active,future,closed (paged)
  5. compute JQL: "project = KEY AND updated >= sinceISO ORDER BY updated ASC, key ASC"
  6. paginate /rest/api/2/search (maxResults=100, startAt=cursor):
       fields = buildFieldsList(project, 'scan')   -- explicit promoted + scan set, NOT *all
       a. GET /rest/api/2/search?jql=…&fields=<list>&expand=names
            (NO changelog, NO renderedFields, NO transitions — those cost 10-100× more)
       b. for each issue:
            - normalize → row (custom fields decoded against projects.metadata.customfieldMap)
            - upsert (issues, links via parent/epic/sprint custom fields)
            - publish 'issue.upserted' to SSE
       c. checkpoint startAt + max(jira_updated_at) - 1s in sync_cursor
       d. throttle via packages/jobs/src/lib/rate-limit.ts (default 6 req/s, see 15-performance.md)
  7. set sync_cursor.last_full_sync_at = now
  8. unlock
```

Steps 3 and 4 use `/rest/agile/1.0` and are the **only** agile-API calls in the steady-state. Step 6 — the bulk of the work — runs entirely on `/rest/api/2`. See `15-performance.md` for why and `13-jira-reality.md` for the discovered board id / rank field id.

Resumable: each step is durable, the checkpoint is in `sync_cursor`, so a restart picks up where it left off.

### Window control

`infra` env: `SYNC_DEFAULT_WINDOW_DAYS=365`. The admin UI lets per-project override (e.g. one project wants 90d to limit storage).

## Flow 2 — Incremental ingest

### 2a. Webhooks (preferred)

Configure Jira to POST to `https://<our-host>/api/webhooks/jira`. Subscribe to: issue created/updated/deleted, comment created/updated/deleted, worklog events, sprint events, issue link events.

Server endpoint:

```
POST /api/webhooks/jira
  - verify shared secret header (HMAC over body if available, else static token)
  - persist raw payload to webhook_inbox(id, kind, payload, received_at, processed_at?)
  - 200 OK immediately
  - enqueue 'webhook-reconcile' job
```

Webhook reconciliation worker:

```
1. fetch oldest unprocessed webhook_inbox row(s) (FOR UPDATE SKIP LOCKED, batch of 50)
2. for each:
    a. normalize → diff against current row (by jira_updated_at)
    b. if our row's jira_updated_at >= incoming.updated → ignore (out of order, we already have newer)
    c. else upsert
    d. publish SSE 'issue.upserted' / 'issue.deleted'
    e. mark processed
3. commit
```

Why `webhook_inbox` instead of processing inline: we want webhook 200s to be unconditional and fast; processing is independent and retryable.

### 2b. Polling safety net

pg-boss scheduled job `incremental-sync`, runs every 2 minutes per project:

```
jql    = `project = KEY AND updated > ${sync_cursor.last_updated_at} ORDER BY updated ASC, key ASC`
fields = buildFieldsList(project, 'scan')   -- explicit list, NOT *all
limit  = 200 issues, paged by maxResults=100
```

Always `/rest/api/2/search` — never `/rest/agile/1.0` on the polling path. This catches anything webhooks missed (network blip, mis-subscribed event, Jira restart).

### 2c. Webhook authenticity

- A static shared secret in `JIRA_WEBHOOK_SECRET` env is required on every request as `X-Webhook-Token`.
- The endpoint is rate-limited per source IP.
- Raw payloads are retained for 14 days for forensics.

## Flow 3 — Write-back via outbox

### Server side (synchronous)

Every mutation route (issue patch, transition, link create, comment create, worklog) goes through a service that wraps:

```ts
// apps/server/src/modules/issues/mutations.ts (sketch)
export async function patchIssue(userId: string, issueId: string, patch: IssuePatch) {
  return db.transaction(async (tx) => {
    const next = await tx.update(issues)
      .set({ ...applyPatch(patch), sync_state: 'pending', updated_at: now() })
      .where(eq(issues.id, issueId))
      .returning()
    await tx.insert(outbox_events).values({
      idempotency_key: `issue.update:${issueId}:${hash(patch)}:${now()}`,
      user_id: userId,
      kind: 'issue.update',
      target_kind: 'issue',
      target_id: issueId,
      payload: patch,
    })
    return next[0]
  })
}
```

The transaction guarantees: if the outbox row exists, the change is reflected; if the row doesn't exist, neither is the patch.

After commit, the route publishes an SSE event `issue.changed.local` to notify the UI of the new `sync_state=pending`.

### Worker side (asynchronous)

`apps/jobs/src/tasks/push-outbox.ts`, runs continuously (pg-boss polling at 1s, batch size 50):

```
loop:
  rows = SELECT … FROM outbox_events
         WHERE state = 'pending'
         AND (locked_until IS NULL OR locked_until < now())
         ORDER BY created_at
         LIMIT 50 FOR UPDATE SKIP LOCKED
  for each row:
    mark row.state='in_flight', locked_by=worker_id, locked_until=now()+30s
    try:
      bearer = jiraCredentialService.getBearer(row.user_id)
      switch row.kind:
        case 'issue.update':      PUT  /rest/api/2/issue/{key}  body: { fields: payload }
        case 'issue.transition':  POST /rest/api/2/issue/{key}/transitions body: { transition: { id }}
        case 'issue.create':      POST /rest/api/2/issue
        case 'comment.create':    POST /rest/api/2/issue/{key}/comment
        case 'worklog.create':    POST /rest/api/2/issue/{key}/worklog
        case 'link.create':       POST /rest/api/2/issueLink
        …
      reconcile response → upsert(issues) with the authoritative jira_updated_at
      set target row sync_state='synced', sync_error=null
      set outbox row state='done'
    catch:
      attempts += 1
      backoff = expo(attempts, jitter)
      if attempts < MAX_ATTEMPTS (default 10) AND not non-retryable:
        state='pending', locked_until=now()+backoff, last_error=str(err)
      else:
        state='dead'
        target row sync_state='error', sync_error=str(err)
        publish SSE 'sync.failed'
```

Lease semantics (`locked_by`, `locked_until`) make the table safe across multiple worker processes.

### Non-retryable errors

- `400` with structured Jira error indicating invalid field → mark `dead`, surface to UI for user correction.
- `403`/`401` → likely PAT expired/revoked → mark `dead` and flag the user's PAT as `needs_reattach`. UI prompts re-auth.
- `404` on a target id we created locally but Jira has not yet acknowledged (e.g. comment on an issue not yet created) → reschedule with extra delay, but eventually `dead` if root parent never lands.

### Ordering and dependencies

Two ordering rules:

1. **Per target**: pushes for the same `target_id` are serialized — only one `in_flight` at a time. Achieved by `partial unique index on (target_kind, target_id) where state='in_flight'`.
2. **Parent before child**: an outbox row may declare `requires` references to other outbox row idempotency keys. The dispatcher only picks a row up if all `requires` are `done`. Used for "create epic + create task linked to epic" sequences.

### Conflict detection

When the worker pushes an update but the Jira `updated` timestamp in the response indicates Jira had a newer revision than our `synced_at`:

```
if response.fields.updated > target.synced_at AND
   server-side merge is non-trivial (we changed field X, Jira changed field X):
       mark target sync_state='conflict'
       store payload + jira-side fields in conflicts table
       SSE 'sync.conflict'
else:
       merge cleanly, sync_state='synced'
```

Conflicts surface in the UI as a banner on the affected card with a "Resolve" action (`10-realtime-and-status.md`).

## Rate limiting Jira

- A token bucket per Jira server, default 6 req/s, configurable.
- Per-user concurrency cap (default 3) so a single user's batch can't starve others.
- 429 responses obeyed with `Retry-After`.

## Flow 4 — Workflow execution

`apps/jobs/src/tasks/workflow-run.ts` advances a `workflow_plan` one step at a time. Each step:

1. Sets the issue's `sync_state='pushing'`.
2. Inserts an outbox row `kind='issue.transition'` with `idempotency_key = 'workflow:<planId>:<seq>'` and the step's pre-validated field values.
3. Waits (via a tiny pubsub on `outbox_events` updates) until that idempotency key reaches `done` or `dead`.
4. Updates `workflow_steps.state`; on success advances `seq+1`; on failure pauses the plan.

The workflow worker **never calls Jira directly** — `push-outbox` is the actual Jira-facing worker, so rate limits, retries, and PAT loading all stay in one place. See `14-workflow-engine.md` for the full feature spec.

## Status & resume

- `apps/server/src/modules/sync/routes.ts` exposes:
  - `GET /api/sync/status` — `{ backfill, outbox: {pending, in_flight, error, dead}, lastWebhookAt, activePlans }`
  - `POST /api/sync/projects/:id/full-sync` — trigger backfill (admin only)
  - `POST /api/sync/outbox/:id/retry` — manual re-queue (admin only)
- pg-boss exposes its own metadata tables; the admin UI surfaces what's needed (`/admin/sync`).

## Pluggable queue contract

```ts
// apps/jobs/src/lib/queue.ts (sketch)
export interface Queue {
  enqueue<T>(name: string, payload: T, opts?: EnqueueOpts): Promise<{ id: string }>
  schedule(name: string, cron: string): Promise<void>
  defineTask<T>(name: string, handler: (ctx: TaskCtx<T>) => Promise<unknown>): void
}
```

Implementations: `pgBossQueue` (default), `triggerDevQueue` (optional). Tasks import only this interface, so we can swap the queue without touching task code.
