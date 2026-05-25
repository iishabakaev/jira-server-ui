# Custom Jira UI — Technical Specifications

A self-hosted, performance-first UI for **Jira Server (on-prem)** that mirrors Jira into a local store and lets a team operate against the cached, event-driven model. Built for an AI-native codebase: clear contracts, types flow end-to-end from Elysia's TypeBox validators, schema lives as code, feature-sliced layout, prescriptive folder rules.

## Read order

1. [`00-overview.md`](./00-overview.md) — product goals, non-goals, high-level architecture, four flows
2. [`01-tech-stack.md`](./01-tech-stack.md) — stack decisions; Elysia/TypeBox is the contract (no Zod, no contracts package)
3. [`02-project-structure.md`](./02-project-structure.md) — monorepo layout, **single Docker image**, AI-native conventions
4. [`03-auth.md`](./03-auth.md) — Keycloak OIDC + **local accounts (Argon2id)** + Jira PAT + future Atlassian OAuth
5. [`04-data-model.md`](./04-data-model.md) — overview + pointers to actual schema files in `packages/db/src/schema/*.ts`
6. [`05-sync-engine.md`](./05-sync-engine.md) — backfill, webhooks, write-back, workflow execution (pg-boss default)
7. [`06-api.md`](./06-api.md) — Elysia routes, Eden Treaty, **all validation via `t.*`**
8. [`07-ui-kanban.md`](./07-ui-kanban.md) — Kanban page UX (views, filters, swimlanes, optimistic DnD)
9. [`08-ui-timeline.md`](./08-ui-timeline.md) — Gantt-style timeline with dependencies
10. [`09-ui-issue-editor.md`](./09-ui-issue-editor.md) — unified Epic / Task+Subtask editor + **workflow wizard**
11. [`10-realtime-and-status.md`](./10-realtime-and-status.md) — SSE channel, sync status, workflow events
12. [`11-observability.md`](./11-observability.md) — logging, tracing, metrics, error handling
13. [`12-implementation-roadmap.md`](./12-implementation-roadmap.md) — phased plan with milestones
14. [`13-jira-reality.md`](./13-jira-reality.md) — observed Jira (ALFAIAAS, Server 9.12.19): fields, statuses, workflows
15. [`14-workflow-engine.md`](./14-workflow-engine.md) — multi-step transition planner deep dive
16. [`15-performance.md`](./15-performance.md) — Jira API budget, field selection, batching, agile-vs-v2 rules, Postgres-only fan-out

## Hard constraints (cross-cutting)

- **Jira is the source of authority; our DB is the working copy.** Every UI read hits our DB.
- **All write paths are async**: `UI → server → DB → outbox → worker → Jira`. The UI never blocks on Jira.
- **Every mutable entity has a sync state** (`synced | pending | pushing | error | conflict`) surfaced in the UI.
- **Workers are the only code that talks to Jira REST.** PATs only exist in memory inside worker calls.
- **Workflow is plan-driven**: multi-step transitions go through the planner, never as ad-hoc sequences.
- **Type safety end-to-end**: Drizzle schema (code) → Elysia `t.*` route validators → Eden Treaty → React Query hooks.
- **No hand-written API client.** Eden Treaty is the only allowed transport surface.
- **No Zod, no `packages/contracts`.** The Elysia route + its `t.*` schema *is* the contract.
- **One Docker image** runs api/worker/web via `ROLE` env; **Postgres is the only external service** (pubsub via `LISTEN/NOTIFY`, SSE replay via UNLOGGED table — no Redis).

## Source code already in place

- [`packages/db/src/schema/`](../../packages/db/src/schema/) — every table as a Drizzle TS file (canonical).
- [`packages/db/drizzle.config.ts`](../../packages/db/drizzle.config.ts) — migration config.
- [`packages/db/src/client.ts`](../../packages/db/src/client.ts) — Drizzle on `bun-sql` driver.

## What this spec is for

These documents are the input contract for AI-driven code generation. They are prescriptive on purpose: exact package versions, exact folder names, exact contract shapes, and concrete examples grounded in the real target Jira (`13-jira-reality.md`). Where a choice is made, the rationale is recorded so a downstream agent can reason about edge cases instead of re-deriving the decision.
