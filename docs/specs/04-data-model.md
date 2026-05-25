# 04 — Data Model

**The schema lives in code.** Each table is a TypeScript file in `packages/db/src/schema/*.ts`. This document is an overview and a pointer; it does not duplicate column lists. When you need the exact shape, open the file.

## Why code instead of docs

- Single source of truth: the same definition is consumed by Drizzle, by migrations, and by typed queries everywhere in the app.
- AI agents extend the schema by editing one TS file; types and migrations propagate.
- Reviews happen on diffs of TS, not on drift between markdown and code.

## File map

| Concern                                  | File                                                            |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Enums (`sync_state`, `outbox_state`, …)  | [`packages/db/src/schema/enums.ts`](../../packages/db/src/schema/enums.ts) |
| Users                                    | [`users.ts`](../../packages/db/src/schema/users.ts)              |
| Sessions                                 | [`sessions.ts`](../../packages/db/src/schema/sessions.ts)        |
| Local accounts (Argon2id)                | [`local_credentials.ts`](../../packages/db/src/schema/local_credentials.ts) |
| Jira credentials (encrypted)             | [`jira_credentials.ts`](../../packages/db/src/schema/jira_credentials.ts) |
| Projects                                 | [`projects.ts`](../../packages/db/src/schema/projects.ts)        |
| Metadata: issueTypes/statuses/priorities/resolutions/linkTypes/fieldSchemas | [`metadata.ts`](../../packages/db/src/schema/metadata.ts) |
| Issues                                   | [`issues.ts`](../../packages/db/src/schema/issues.ts)            |
| Issue links                              | [`issue_links.ts`](../../packages/db/src/schema/issue_links.ts)  |
| Comments                                 | [`comments.ts`](../../packages/db/src/schema/comments.ts)        |
| Worklogs                                 | [`worklogs.ts`](../../packages/db/src/schema/worklogs.ts)        |
| Attachments                              | [`attachments.ts`](../../packages/db/src/schema/attachments.ts)  |
| Boards (kanban config)                   | [`boards.ts`](../../packages/db/src/schema/boards.ts)            |
| Sprints                                  | [`sprints.ts`](../../packages/db/src/schema/sprints.ts)          |
| Transactional outbox                     | [`outbox.ts`](../../packages/db/src/schema/outbox.ts)            |
| Sync cursors + webhook inbox             | [`sync.ts`](../../packages/db/src/schema/sync.ts)                |
| Workflow transitions cache + plans + steps | [`workflow.ts`](../../packages/db/src/schema/workflow.ts)      |
| Write-back conflicts                     | [`conflicts.ts`](../../packages/db/src/schema/conflicts.ts)      |
| Audit log                                | [`audit.ts`](../../packages/db/src/schema/audit.ts)              |
| Kanban saved views                       | [`saved_views.ts`](../../packages/db/src/schema/saved_views.ts)  |
| Drizzle relations graph                  | [`relations.ts`](../../packages/db/src/schema/relations.ts)      |

## Design rationale (the parts that are not obvious from reading the files)

### 1. Custom-fields strategy

Two buckets:

- **Promoted fields** get typed columns on `issues` (`story_points`, `sprint_id`, `epic_jira_id`, `start_date`, `due_date`, `time_estimate_s`, `time_spent_s`).
- **Everything else** lives in `issues.custom_fields` JSONB, keyed by Jira `customfield_<id>`.

The mapping from `customfield_<id>` to a promoted column is per-project: `projects.metadata.promoted` is hydrated at first sync by reading `/createmeta` and matching by name. Observed IDs from the real Jira (`docs/specs/13-jira-reality.md`) are the defaults the bootstrap uses; per-project overrides handle drift across projects.

### 2. JSONB + GIN

- `issues.custom_fields jsonb` with `GIN (jsonb_path_ops)` for fast `?` / `@>` lookups across the long tail of fields.
- `issues.labels`, `components`, `fix_versions` as `text[] GIN`.

### 3. Soft delete on issues

`issues.deleted_at` rather than hard delete. Webhooks can arrive out of order; we never want a delete-then-recreate to race and lose data. UI filters them out.

### 4. Sync state is per row

Every mutable row has `sync_state` and (where applicable) `sync_error`. This is the contract surfaced to the UI in `10-realtime-and-status.md`.

### 5. Outbox is the only egress

There is one and only one way to mutate Jira: insert a row in `outbox_events` inside the same transaction as the local mutation. Worker drains. Idempotency key dedupes. `requires[]` orders dependent operations (e.g. comment-on-issue must wait for the issue's create row). See [`outbox.ts`](../../packages/db/src/schema/outbox.ts).

### 6. Workflow tables: a feature, not infrastructure

`transitions`, `workflow_plans`, and `workflow_steps` exist because the customer's Jira (and many real ones) has step-by-step workflows that can't be skipped — moving an issue from "Sprint backlog" to "Closed" requires walking through "In Progress" → "REVIEW" → "Closed", and each step may require additional fields (e.g. the `Closed` transition needs `resolution` and two custom fields). See `14-workflow-engine.md` for the feature spec.

### 7. Materialized views (optional, optimization-only)

The API documents two read-optimized views (`mv_kanban_card`, `mv_timeline_bar`) in `06-api.md`. They are an optimization; the API contract is the same whether they exist as MVs or as plain views. They are created in a migration alongside the relevant tables.

### 8. Migrations

- `bun run --filter @app/db generate` — Drizzle diffs `schema/*.ts` → SQL migration under `packages/db/drizzle/`.
- `bun run --filter @app/db migrate` — applied automatically on boot of the `api` role.
- Migrations are forward-only. AI agents propose them; humans review the SQL diff.

### 9. Type inference

Every schema file exports inferred types: `type Issue = typeof issues.$inferSelect`, `type NewIssue = typeof issues.$inferInsert`. These are the canonical shapes used by services and tests. The Elysia route layer translates them to `t.*` schemas at the HTTP boundary.

## Reading order

If you're new to the codebase:

1. `enums.ts` — the small set of state machines used across tables.
2. `users.ts`, `sessions.ts`, `local_credentials.ts` — the auth surface.
3. `projects.ts`, `metadata.ts` — what an "issue" is anchored to.
4. `issues.ts` — the central entity.
5. `outbox.ts`, `sync.ts` — how state gets in and out.
6. `workflow.ts` — the multi-step transition feature, the most complex piece.
