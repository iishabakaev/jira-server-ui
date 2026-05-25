# CODEBASE_MAP — one paragraph per top-level folder

> Keep this file short and current. When the repo shape changes, update this map in the same PR.

## `apps/server`
Elysia HTTP + SSE server. Mounts modules (auth, users, issues, boards, timeline, workflow, sync, admin). Routes only parse, validate (via Elysia `t.*`), and call services. Services never call Jira directly — they write to the DB and enqueue outbox rows in the same transaction.

## `apps/web`
React 19 SPA, Vite build, TanStack Router with file-based routes. Feature-sliced: each `features/<name>/` owns components, hooks, zustand store, and a thin `api.ts` wrapping Eden Treaty. Server state in TanStack Query; URL state via TanStack Router search-param TypeBox schemas.

## `apps/jobs`
pg-boss workers. Tasks: `push-outbox` (drains outbox → Jira REST), `full-sync` (paginated JQL backfill), `incremental-sync` (since-cursor pulls), `webhook-reconcile` (applies webhook payloads), `refresh-metadata` (projects/fields/statuses), `refresh-workflow` (transitions cache), `workflow-run` (advances workflow_plans step by step). Every Jira call goes through `lib/rate-limit.ts` — no exceptions.

## `packages/db`
**Canonical model.** Drizzle schemas live as TS files in `src/schema/`. Generated migrations in `drizzle/`. `client.ts` builds the singleton on `drizzle-orm/bun-sql`. Comments inside this package are written in Russian.

## `packages/jira`
Typed Jira REST 2/agile-1 client. Auth-header injection, response shaping. Has `field-sets.ts` with the explicit `FIELDS_SCAN` list used by the sync engine. Agile API is used **only** for board configuration, sprint enumeration (both at first sync), and sprint bulk moves — never on hot paths.

## `packages/eden`
A tiny package that re-exports `type App` from `apps/server/src/types/app.ts`. This is the only allowed bridge from web → server types.

## `packages/ui`
shadcn/ui components committed as owned source files. Tailwind v4 design tokens.

## `packages/config`
Shared `tsconfig`, Biome, Tailwind presets.

## `infra/docker`
**One** multi-stage `Dockerfile` that builds a single product image, plus `entrypoint.sh` switching on `ROLE=api|worker|web`.

## `infra/compose`
`compose.yaml` wiring three replicas of the product image + one Postgres. **No Redis.**

## `docs/specs`
Numbered Markdown specs. Read in order; `15-performance.md` is the authoritative performance contract.

## `.agents`
Conventions for AI agents working on this repo: this file, `DO_NOT.md`, `PATTERNS.md`. They are the prompt input for future agent work.
