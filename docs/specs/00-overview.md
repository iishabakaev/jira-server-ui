# 00 — Overview

## Product goal

A custom internal UI for **Jira Server (on-prem)** that:

- Replaces the daily-driver Jira surface for engineering and PM work (kanban, planning, issue editing).
- Implements the company's bespoke workflow on top of Jira's data without distorting Jira itself.
- Feels like Linear/Height (fast, keyboard-first, optimistic) while remaining a faithful Jira client.
- Is operable offline-to-Jira: the local DB is always responsive; Jira can be slow or temporarily down without freezing the UI.

## Non-goals

- Replacing Jira admin (workflows, schemes, permission editing).
- Replacing Jira Service Management / Service Desk surfaces.
- Replacing Jira's reporting suite — we expose enough events for external BI, but no built-in reports.
- Mobile-native app (the UI is responsive but desktop-first).

## High-level architecture

```
┌────────────┐  Keycloak OIDC + local login   ┌───────────────────────────────┐
│  Browser   │ ─────────────────────────────► │            Server             │
│ (React +   │ ◄────── SSE events ─────────── │  Elysia (Bun) + Drizzle/PG    │
│  TanStack) │                                │  pg-boss workers (same image) │
└─────┬──────┘                                │  LISTEN/NOTIFY fan-out + SSE  │
      │                                       └──────┬────────────────┬───────┘
      │ reads & writes (Eden Treaty, typed via Elysia t.*)             │
      │                                              │ Jira REST       │ Jira webhooks
      │                                              ▼                 ▲
      │                                      ┌──────────────────────────────┐
      │                                      │     Jira Server (on-prem)    │
      │                                      └──────────────────────────────┘
      │
      └─────────────► All UI reads come from the server's local DB,
                       never from Jira. Writes go DB-first, then
                       a worker pushes to Jira via the outbox.

One product Docker image runs three roles (api | worker | web) via the
ROLE env. PostgreSQL is the only external service — it absorbs Redis's
former jobs via LISTEN/NOTIFY (pubsub) and an UNLOGGED table (SSE replay).
```

### The four flows

1. **Initial / backfill sync**: configurable window (default: last 12 months). Paginated JQL crawl, written into the DB, throttled, resumable.
2. **Live ingest**: Jira webhook → server endpoint → normalize → write DB → publish SSE event to subscribed UI clients.
3. **Outbound write**: UI mutation → server validates → DB mutation (tx) → outbox row → worker drains outbox → Jira REST → reconcile response → mark `synced` or `conflict`.
4. **Workflow plan**: UI picks a target status that needs multiple transitions → planner builds the chain and gathers required fields up front → background worker executes one transition at a time through the outbox, with progress visible on the card.

### Why a local store at all

- Jira REST round-trips are slow (200–800 ms is normal on-prem) and rate-limited.
- Kanban / timeline rendering needs to read hundreds of issues at once; doing this via Jira REST is hostile to performance and to Jira.
- Webhooks give us a near-realtime stream of changes, so the local store stays warm.
- A local store gives us a foundation for features Jira can't do cheaply: optimistic edits, custom views, cross-board planning.

## Core entities (preview)

| Entity         | Source of truth | Notes                                                     |
| -------------- | --------------- | --------------------------------------------------------- |
| User           | Jira + Keycloak | Keycloak `sub` ↔ Jira `accountId`/`name` mapping per user |
| Project        | Jira            | Cached, refreshed on schema change webhook                |
| Issue          | Jira            | Includes Epic / Task / Subtask via `issueType`            |
| IssueLink      | Jira            | Dependency edges (blocks, is blocked by, relates)         |
| Sprint, Board  | Jira            | Cached for kanban / scope                                 |
| Worklog        | Jira            | Cached for timeline capacity view                         |
| OutboxEvent    | Local           | Drives write-back                                         |
| SyncCursor     | Local           | Tracks `updated >= X` per project for incremental sync    |
| UserSession    | Local           | Server-side session, references Keycloak token            |
| JiraCredential | Local           | Encrypted per-user PAT (future: OAuth tokens)             |

## Performance budget (targets)

- Kanban initial paint with 500 visible issues: **< 600 ms** from cold cache, **< 150 ms** warm.
- Card drag → DB commit → optimistic UI update: **< 50 ms**.
- DB commit → Jira reconciled (network OK): **< 3 s** typical.
- Webhook → SSE delivered to UI: **< 300 ms**.
- Backfill: 50k issues / hour with default rate limits, single worker.

## Deployment

Docker Compose for on-prem. **One image** built once, three roles wired by `ROLE` env. Single-host friendly. Horizontally scalable per-role later.

```
services:
  api         # ROLE=api      Elysia HTTP + SSE
  worker      # ROLE=worker   pg-boss tasks (sync, push-outbox, workflow-run)
  web         # ROLE=web      static SPA served by `bun --static`
  postgres    # 16+, the only external service
  keycloak    # OPTIONAL; if absent, local accounts cover auth (see 03-auth.md)
```

No Redis. Postgres provides pub/sub via `LISTEN/NOTIFY`, hot reads via its shared-buffer cache + indexes, and SSE replay via a small UNLOGGED table. See `15-performance.md`.

Local accounts (Argon2id) ship out-of-the-box so the system is usable without an SSO dependency on day one.
