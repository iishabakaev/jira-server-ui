# 11 — Observability, Errors, Operations

## Logging

- **Library**: `pino` (server + jobs). Bun-native, zero-dependency JSON logger.
- **Format**: NDJSON to stdout. Level via `LOG_LEVEL` env (`info` default, `debug` in dev).
- **Required fields on every line**: `ts`, `level`, `msg`, `service`, `requestId`, `userId?`, `traceId?`.
- **PII**: PATs and session secrets are **never** logged. A central `redact` config strips known fields.
- **HTTP access log**: one line per request with status, duration, route name, sizes.

## Tracing

- **OpenTelemetry** SDK in server and jobs. Exporter: OTLP HTTP to a configurable collector (`OTEL_EXPORTER_OTLP_ENDPOINT`).
- Default span propagation: web sends `traceparent` header from a Sentry-style boot; server creates a root span if absent.
- **Span shape**:
  - HTTP request span (`elysia.request`)
  - Service span (`issues.patch`)
  - DB query spans (auto via Drizzle middleware)
  - Outbox push span (`outbox.push:issue.update`)
  - Jira REST span (`jira.PUT /rest/api/2/issue/:key`)
- The trace context flows through the outbox — store `traceparent` on the outbox row so the eventual Jira push is in the same trace as the user's mutation.

## Metrics

Prometheus-compatible endpoint at `/metrics` (server and jobs). Key counters / histograms:

- `http_requests_total{route,method,status}`
- `http_request_duration_seconds{route,method}`
- `jira_requests_total{op,status}` (only from workers)
- `jira_request_duration_seconds{op}`
- `outbox_depth{state}` — gauge
- `outbox_push_duration_seconds{kind}`
- `outbox_attempts_total{kind,outcome}` (outcome ∈ done|retried|dead)
- `webhook_inbox_depth` — gauge
- `webhook_process_duration_seconds`
- `sse_connections` — gauge
- `sse_events_published_total{topic}`
- `db_pool_in_use` — gauge

## Error normalization

Every error thrown in a route is caught by `apps/server/src/plugins/error.ts`:

```ts
.error({
  ValidationError, JiraConflict, NotFound, Forbidden, ...
})
.onError(({ code, error, set }) => {
  log(error)
  return mapError(code, error)  // → { error: { code, message, details? } }
})
```

The frontend's Eden client uses `onError` to:

- 401 → trigger silent re-login; if it fails, redirect to `/login`.
- 403 → toast + read-only mode where applicable.
- 423 → retry-after backoff for the affected query/mutation.
- 5xx → toast + Sentry capture.

## Frontend error reporting

- **Sentry-compatible**: we use the OSS-friendly `glitchtip` or self-hosted Sentry. Both speak the Sentry SDK.
- Errors include trace id (so we can pivot to backend logs).
- We strip URL search params from breadcrumbs to avoid leaking filter contents.

## Health checks

```
GET /api/health/live   → 200 if process is alive
GET /api/health/ready  → 200 if DB reachable (Postgres is the only external dep)
```

Used by Docker/K8s probes.

## Operational dashboards (suggested)

A small admin page in the app itself at `/admin/sync`:

- Outbox depth per state, last 24h chart
- Webhook inbox depth, last 24h chart
- Per-project backfill status (last run, next scheduled, errors)
- Rate-limit hits in the last hour
- Failed pushes with "Retry now" / "Mark dead"

Backed by the same metrics endpoint and a small Postgres query.

## Backups & disaster recovery

- **Postgres**: nightly `pg_dump` to encrypted object storage. Hourly WAL archiving for PITR.
- The `sse_events` table is UNLOGGED, so a crash empties it; that's acceptable — clients reconnect and refetch via TanStack Query.
- **Resync from Jira**: a full re-sync of all projects is supported via admin action. Target: 100% repopulate within 24h for typical org size (5–10k issues per project, ~50 projects).

## Rate-limit budgets

Server (per IP, defaults; configurable):

- Authenticated: 200 req/min, burst 60.
- Webhook endpoint: 600 req/min from Jira IPs allowlist.
- Login: 10/min.

Jira-side (per worker):

- Default: 6 req/s, max in-flight 8.
- Per-user concurrency: 3.
- 429 responses extend backoff using `Retry-After`.

## Secrets management

- Local dev: `.env` files (gitignored).
- Production: env vars supplied by the deployment orchestrator (Compose `env_file`, K8s `Secret`, or Vault).
- KEK rotation: run `bun run keys:rotate` to add a new key id, re-encrypt all DEKs lazily on next access.

## Auditing

`audit_log` rows for:

- Auth actions (login, logout, PAT attach/remove)
- Admin actions (sync trigger, conflict resolve, saved-view ownership change)
- Outbox `dead` transitions

Retention: 1 year, queryable from `/admin/audit`.
