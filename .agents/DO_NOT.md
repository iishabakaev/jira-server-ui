# DO NOT — anti-patterns for the jira-ui codebase

These are non-negotiable. Violating them is a bug, not a tradeoff.

## Language / comments

- **Do not write English code comments.** All inline / block / JSDoc comments must be in Russian. Identifiers (function names, variables, types, file names) stay English. Markdown docs (`docs/**`) stay English — the rule is for *code* comments only.

## Validation

- **Do not introduce Zod.** Validation is Elysia's `t.*` (TypeBox). The same schema serves the server, Eden Treaty (frontend types), and Swagger.
- **Do not create `packages/contracts`.** The Elysia route + its `t.*` schema is the contract.

## Data flow

- **Do not call Jira from a route handler.** Mutations go: route → service → `db.transaction(...)` writing the local row + an `outbox_events` row. Workers (`apps/jobs/`) are the only code that talks to Jira REST.
- **Do not read Jira from the UI request path.** All UI reads come from Postgres. If a feature seems to need a live Jira read, propose a sync-driven design first.
- **Do not bypass the outbox** for any state-changing Jira call. Even admin tools enqueue rows.

## Infrastructure

- **Do not add Redis** (or Memcached, or any external cache). Postgres absorbs pub/sub (`LISTEN/NOTIFY`), cache (indexed reads), and SSE replay (UNLOGGED `sse_events` table). The product image is **one image**; the only external service is **Postgres**.
- **Do not add a new external job runner.** pg-boss on Postgres is the queue. If a workflow demands DAGs / visual ops UI, propose Trigger.dev v3 self-hosted as a drop-in *replacement*, not an addition.
- **Do not add a separate web server.** The `web` role is `bun --static` serving the SPA bundle.

## Jira API usage

- **Do not call `/rest/agile/1.0` outside the three sanctioned cases**: board configuration, sprint enumeration (both at first sync), sprint bulk moves. Everything else is `/rest/api/2/search` with an explicit `fields=` list. See `docs/specs/15-performance.md`.
- **Do not request `fields=*all`** on the kanban / timeline / scan path. Use `buildFieldsList(project, 'scan')`.
- **Do not request `expand=changelog`** on list endpoints. Only on the single-issue editor open.

## Schema

- **Do not duplicate schema in markdown.** Schemas live in `packages/db/src/schema/*.ts`. Docs reference the file; they do not mirror it.
- **Do not hand-write migrations.** `bun run --filter @app/db generate` produces SQL from the Drizzle schema diff.
