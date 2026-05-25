# 15 — Performance & Jira API Budget

This document is the **operational contract** for how the system spends Jira's API budget, and how the UI stays fast. It supersedes any performance claims elsewhere when they conflict.

## North-star numbers

| Surface                                | Budget          | How                                                                |
| -------------------------------------- | --------------- | ------------------------------------------------------------------ |
| Kanban first paint, warm cache         | **< 150 ms**    | One DB query against `mv_kanban_card`; columns virtualized          |
| Kanban first paint, cold cache         | **< 600 ms**    | Same query; query plan must use the partial filter indexes          |
| Card drag → optimistic DB commit       | **< 50 ms**     | Local single-row update + outbox insert in one tx                   |
| DB commit → Jira reconciled (network OK) | **< 3 s** typical | push-outbox worker, single REST call                              |
| Webhook → SSE delivered to UI          | **< 300 ms**    | Webhook 200 immediately; reconcile job + `pg_notify` fan-out        |
| Backfill rate                          | **50k issues/h** | 100 issues/page × 6 req/s × 1 worker; tuned by `rate-limit.ts`     |
| Jira req per kanban card view          | **0**           | All reads from local DB                                             |
| Jira req per single-edit               | **1**           | One PATCH; reconcile uses the response, no follow-up GET             |
| Jira req per multi-hop workflow plan   | **N**           | One per step. Each plan reads `transitions` cache, never `/createmeta` again |

## Rule 0 — All UI reads come from Postgres. Period.

If a frontend handler ends up triggering a Jira REST call, that is a bug. The webhook + sync + push-outbox flows are responsible for keeping the DB warm; the API layer never reads Jira on a request path.

## Field selection (the single biggest win)

### Search / list endpoints

`GET /rest/api/2/search` accepts an explicit `fields=` list. **Use it. Always.** Without it, Jira returns every field on every issue — on the target instance that means hundreds of customfields per row, > 200 KB per issue.

Two field sets in `packages/jira/src/field-sets.ts`:

```ts
// Минимальный набор для индекс-сканов (бэкап-наполнение, периодический инкремент).
// Тяжёлые поля (description, attachment) исключены до тех пор, пока запись не открыта в редакторе.
export const FIELDS_SCAN = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'labels',
  'components',
  'fixVersions',
  'duedate',
  'created',
  'updated',
  'parent',
  // Promoted custom fields — resolved per project at runtime.
  // The placeholders are replaced by projects.metadata.promoted.* before the call.
]

// Полный набор — используется только при открытии конкретного issue в редакторе.
export const FIELDS_FULL = ['*navigable', '*all']
```

At runtime we build the actual list:

```ts
function buildFieldsList(project: Project, mode: 'scan' | 'full' = 'scan'): string {
  if (mode === 'full') return '*all'
  const promoted = Object.values(project.metadata.promoted).filter(Boolean) as string[]
  return [...FIELDS_SCAN, ...promoted].join(',')
}
```

### Issue detail (editor open)

`GET /rest/api/2/issue/{key}` — pass `fields=*all&expand=renderedFields,transitions,changelog,operations` only on editor-open. For everything else (kanban, timeline) we already have the data.

### Never `expand=changelog` on a list

Changelog inflates payloads by 10–100×. Only request it on a single-issue fetch when the Activity tab opens.

## Paging

```
maxResults=100        // Server 9.x hard cap
startAt=<n>           // for backfill
JQL ORDER BY updated ASC, key ASC     // stable for cursor-based incremental
```

For incremental:

```
updated >= '${last_updated_at}' ORDER BY updated ASC, key ASC
```

After processing a page, advance the cursor to **min(max(jira_updated_at - 1s, last_seen_key))** to tolerate same-second updates without skipping or replaying.

## Batching

Jira REST has limited bulk endpoints, but where they exist we use them.

| Operation                  | Bulk available?                  | Strategy                                     |
| -------------------------- | -------------------------------- | -------------------------------------------- |
| Create issue               | `POST /rest/api/2/issue/bulk` (up to 50) | Used for "split epic into N tasks" flows |
| Add comments               | No                               | Per-issue calls, parallel within concurrency cap |
| Edit fields                | No native bulk                   | Per-issue PATCH; bound concurrency to 3/user, 8/instance |
| Transition                 | No                               | Per-issue; workflow planner serializes per issue |
| Link issues                | No                               | Per-link                                     |
| Worklog                    | No                               | Per-worklog                                  |
| Move to sprint             | `POST /rest/agile/1.0/sprint/{id}/issue` (up to ~50) | Used during sprint planning bulk ops |

Outbox dispatcher applies bulk-creation by grouping pending `issue.create` rows targeting the same project within a 1s window.

## Rate limits

### Towards Jira (per Jira instance)

Token-bucket in `apps/jobs/src/lib/rate-limit.ts`:

```
RPS         = env JIRA_MAX_RPS default 6
BURST       = env JIRA_MAX_BURST default 12
CONCURRENCY = env JIRA_MAX_CONCURRENCY default 8
```

Per-user concurrency cap: 3, so one user's batch can't starve others.

`429 Too Many Requests` honors `Retry-After`. After three consecutive 429s, drop RPS to 50% for the next 60s.

### From Jira webhook (towards us)

`POST /api/webhooks/jira`:

- Always responds 200 immediately. Body is stored in `webhook_inbox`.
- Rate-limit by source IP at 600 req/min/IP. If exceeded, return 429 with `Retry-After: 5`.

### API rate limits (towards our server)

- Authenticated: 200 req/min/user, burst 60.
- Login: 10/min/IP.
- Stored as token buckets keyed by `(scope, principal)` in a Postgres `rate_limits` table, refreshed by background.

## Concurrency model

`apps/jobs/src/lib/rate-limit.ts` exposes:

```ts
// Запускает функцию `fn`, удерживая bucket-токен и инкрементируя
// per-user/per-instance счётчики. Возвращает результат `fn`.
export async function acquireAndRun<T>(opts: {
  userId: string
  instance: string
  cost?: number
}, fn: () => Promise<T>): Promise<T>
```

All Jira calls go through this wrapper. There is no escape hatch.

## Agile API vs. `/rest/api/2`

`/rest/agile/1.0` is **slower** and has tighter rate limits on Server 9.x. We use it **only** where v2 has no equivalent.

| Need                         | Endpoint                                             | Why                                                |
| ---------------------------- | ---------------------------------------------------- | -------------------------------------------------- |
| Board metadata (initial)     | `GET /rest/agile/1.0/board/{id}/configuration`      | No v2 equivalent for column→status mapping + rank field id |
| Sprint list (initial)        | `GET /rest/agile/1.0/board/{id}/sprint?state=...`   | No v2 equivalent for "sprints of this board"        |
| Move issues into a sprint    | `POST /rest/agile/1.0/sprint/{id}/issue`            | The clean batch path                                |
| **Everything else**          | `/rest/api/2/*`                                       |                                                    |

That means **agile API is hit at most**:

- **Once per board** at first sync (configuration).
- **Once per board** at first sync (sprint enumeration).
- During sprint moves (batched).

Subsequent reads:

- Board configuration is cached in `boards.config` and refreshed only when a "board config changed" webhook arrives (Jira Server doesn't emit one consistently; we also re-fetch every 24h as a safety net).
- Sprint membership comes from each issue's sprint custom field (`customfield_10375` by default, resolved via `projects.metadata.promoted.sprint`). No agile-API call per kanban load.
- Backlog = the board's filter JQL applied to `/rest/api/2/search`.

This single change (avoiding agile API on every kanban load) eliminates the slowest single hot path observed on the target instance.

## Webhook subscriptions (precise)

The fewer webhooks we subscribe to, the cheaper our reconcile loop. Subscribe **only** to:

```
jira:issue_created
jira:issue_updated
jira:issue_deleted
jira:worklog_updated
jira:worklog_deleted
jira:sprint_created
jira:sprint_updated
jira:sprint_started
jira:sprint_closed
jira:version_released         (optional, for fixVersion handling)
```

Skip: `comment_created/updated/deleted` (they fire `issue_updated` anyway when triggered through Jira UI, and we re-read issue comments on `issue_updated` via `expand=comment` when present in the cached field config).

## Conditional fetch

Most v2 endpoints don't honor `If-Modified-Since`/`ETag`, but `/rest/api/2/field` and `/rest/api/2/issuetype` do on Server 9.x. The metadata refresh worker stores the `ETag` and skips the body parse if `304`.

## Postgres-side performance rules

- **All hot indexes exist on every query path used by the kanban / timeline filter shape.** Specifically the partial GIN on `issues.custom_fields jsonb_path_ops`, the `text[] GIN` on labels/components, and the `(project_id, status_id)` btree.
- **Materialized views** for kanban + timeline are refreshed incrementally:
  - After webhook reconcile commits, only the touched rows are refreshed (`REFRESH MATERIALIZED VIEW CONCURRENTLY` with a `WHERE id = ANY(...)` filter is NOT supported; instead we use a **plain view** with the same name when refresh cost > read cost). The API contract is the same.
- **Connection pool**: 20 connections for the api process, 10 for the worker. Drizzle/pg-boss share the pool.

## SSE fan-out: Postgres-only

No Redis. The flow is:

```
publish(topic, event):
  INSERT INTO sse_events(topic, type, data) VALUES (...) RETURNING id
  pg_notify('sse:' || topic, JSON.stringify({ id, type, data }))

subscribe (per Elysia process):
  LISTEN sse:user
  LISTEN sse:kanban:abc
  LISTEN sse:...

each NOTIFY callback fans the event out to all EventSource connections subscribed to that topic in this process.
```

Tables:

```sql
-- Кольцевой буфер событий для replay по Last-Event-ID.
CREATE UNLOGGED TABLE sse_events (
  id          bigserial primary key,
  topic       text not null,
  type        text not null,
  data        jsonb not null,
  created_at  timestamptz not null default now()
);
CREATE INDEX sse_events_topic_idx ON sse_events (topic, id);
```

Cleanup job (pg-boss scheduled, every minute):

```sql
DELETE FROM sse_events WHERE created_at < now() - interval '5 minutes';
```

If a NOTIFY payload would exceed 7900 bytes (Postgres limit ~8000), notify carries only the `id`; the listener fetches the row.

## Why this works (and why dropping Redis didn't hurt)

- Pub/sub: `LISTEN/NOTIFY` is sufficient at hundreds of events/sec, which is comfortably above our peak.
- Cache: kanban reads are already indexed Postgres queries; the cache hit-path was Postgres anyway.
- SSE replay: a 5-minute UNLOGGED table is tiny and fast. Unlogged tables skip WAL — perfect for ephemeral state.

## Performance test plan

In `apps/server/perf/`:

- `kanban-1k.bench.ts` — synthetic 1k issue project; measure paint via `mv_kanban_card` SELECT. Target: < 80 ms median.
- `outbox-drain.bench.ts` — enqueue 200 events; measure end-to-end time to all `done` against a Jira mock. Target: < 60 s.
- `sse-fanout.bench.ts` — 200 subscribed clients to one topic; publish 100 events; measure last-arrived latency. Target: p95 < 200 ms.

Benchmarks gate CI for performance-sensitive PRs (label `perf-sensitive`).
