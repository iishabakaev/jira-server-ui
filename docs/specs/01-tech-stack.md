# 01 — Tech Stack

## Decisions (pinned)

| Concern               | Choice                              | Version  | Why                                                                                                                |
| --------------------- | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| Runtime               | **Bun**                             | `≥ 1.2`  | Fastest TS runtime, native bundler/test/installer, native Postgres (`Bun.sql`), single binary for prod              |
| HTTP framework        | **Elysia**                          | `latest` | Best-in-class end-to-end TS; **all validation via Elysia `t.*` (TypeBox)**; Eden Treaty client; built-in plugins   |
| DB                    | **PostgreSQL**                      | `16+`    | The only persistent datastore; JSONB for ADF / custom fields; `LISTEN/NOTIFY` for pubsub                            |
| ORM / schema          | **Drizzle ORM**                     | `latest` | Schema lives as TS code in `packages/db/src/schema/*.ts`; uses `drizzle-orm/bun-sql` for Bun's native pg driver     |
| Cache / SSE replay    | **PostgreSQL `LISTEN/NOTIFY` + UNLOGGED table** | — | Pub/sub + SSE last-event-id replay live in Postgres. No Redis dependency. See `15-performance.md`.            |
| Background jobs       | **bun-native worker + pg-boss**     | latest   | One Bun process polls Postgres for jobs (pg-boss). No external job service. Trigger.dev kept as optional upgrade.   |
| Frontend framework    | **React**                           | `19+`    | React Compiler removes manual memoization; SPA target, no SSR                                                       |
| Bundler / dev server  | **Vite**                            | `6+`     | Fast DX; first-class TS; Tailwind v4 plugin                                                                          |
| Styling               | **Tailwind CSS**                    | `v4`     | CSS-first config, no PostCSS chain, single design-token surface                                                      |
| Component library     | **shadcn/ui**                       | `latest` | Owned source files, easy for AI agents to extend                                                                     |
| Server state          | **TanStack Query**                  | `v5`     | Cache + optimistic updates + Suspense + infinite                                                                     |
| Client state          | **Zustand**                         | `v5`     | UI-only state (filters, panel open/close, drag preview)                                                              |
| Routing               | **TanStack Router**                 | `v1`     | Type-safe routes + search-param schemas via TypeBox (so frontend & backend share the same validator runtime)        |
| Forms                 | **react-hook-form + @sinclair/typebox** | `latest` | Headless, reuses the same TypeBox schemas Elysia/Eden expose — no schema duplication                              |
| Drag and drop         | **@dnd-kit/core**                   | `latest` | Accessible, virtual-list compatible                                                                                  |
| Virtualization        | **@tanstack/react-virtual**         | `v3`     | Kanban columns and timeline rows                                                                                     |
| Rich text / ADF       | **TipTap v2**                       | `v2`     | Issue description / comments; serialize to Atlassian Document Format                                                 |
| Date/time             | **date-fns** + **@js-temporal/polyfill** | `latest` | Tree-shakable; Temporal for tz-sensitive scheduling                                                              |
| Realtime to UI        | **Elysia SSE plugin**               | builtin  | One-way push, no WebSocket infra; pub/sub via `pg_notify`, replay via UNLOGGED Postgres table                         |
| OIDC                  | **openid-client**                   | `v5`     | Keycloak integration                                                                                                 |
| Local auth            | **`@node-rs/argon2`**               | `latest` | Argon2id password hashing; rust-native, Bun-compatible                                                                |
| Crypto (PAT at rest)  | **`Bun.subtle` AES-GCM**            | builtin  | Envelope encryption, no extra dep                                                                                    |
| Testing (server/jobs) | **Bun test**                        | builtin  | Jest-compatible, zero config                                                                                          |
| Testing (frontend)    | **Vitest** + **Testing Library**    | `latest` | Vite-native, parallel                                                                                                |
| E2E                   | **Playwright**                      | `latest` | Cross-browser                                                                                                        |
| Lint / format         | **Biome**                           | `v2`     | One binary; fast; AI-friendly                                                                                        |
| Package manager       | **Bun workspaces**                  | builtin  | Monorepo native                                                                                                       |
| Containerization      | **Single multi-stage Dockerfile**   | n/a      | One image runs server + web (static) + worker via `ROLE` env. Postgres is the only stock image required.             |

## What changed from the first draft (and why)

- **Zod removed.** Elysia ships TypeBox (`t.Object`, `t.String`, `t.Union`, …) and Eden Treaty *derives* types from those validators. Using two validator libraries adds a layer with no benefit. **All request/response/SSE validation uses Elysia `t.*`.** The same validators flow to the frontend through Eden — no separate `packages/contracts`.
- **`packages/contracts` deleted.** The contract is the Elysia route + `t.*` schema. Frontend hooks consume the typed `App` via Eden Treaty.
- **TanStack Form replaced with react-hook-form + TypeBox.** RHF can validate against TypeBox via a tiny resolver. We reuse the *exact* schemas the backend declares — no duplication.
- **Trigger.dev demoted to optional.** Default queue is **pg-boss** (Postgres-only). One fewer service; the architecture stays the same because workers consume from a queue abstraction (`apps/jobs/src/lib/queue.ts`). Trigger.dev is a drop-in if the operator wants its UI / DAG features later.
- **Single Docker image.** A multi-stage Dockerfile produces one image that, depending on the `ROLE` env, boots as `api` (Elysia), `worker` (pg-boss consumer), or `web` (static via `bun --static`). Compose still wires the three roles, but `docker pull` is one image.
- **Local accounts added.** A `local_credentials` table (Argon2id) supports admin/QA accounts when Keycloak isn't present. See `03-auth.md`.

## Why these are AI-native

1. **Schema-first everywhere.** Drizzle table files + Elysia `t.*` schemas are the source of truth. Both read like data; both are TS.
2. **No magic frameworks.** Elysia handlers are plain functions; shadcn components are plain files; Vite is opinionless.
3. **One language top-to-bottom.** TS only — no Python/Go workers.
4. **Eden Treaty kills the API client.** Frontend `api.issues.get({...})` is typed end-to-end from `t.Object({...})` declarations on the server.
5. **Folder conventions are mechanical** (see `02-project-structure.md`). An agent given a feature name knows the files to create.
6. **Code is the model.** All table definitions are in `packages/db/src/schema/*.ts`; the spec doc points at the file, never duplicates the DDL.

## Runtime dependency footprint (operational)

| Service     | Purpose                                  | Image                   |
| ----------- | ---------------------------------------- | ----------------------- |
| `app`       | api + worker + static web (role-switched)| our single product image|
| `postgres`  | sole datastore + pub/sub + SSE buffer    | `postgres:16-alpine`    |

That's it. **One product image, one stock service.** No Redis, no external job runner, no separate web server.

## Versions are intentionally loose where stable

We pin **major** versions (React 19, Tailwind v4, Postgres 16, Bun 1.2+) because they imply specific APIs. Other tools track `latest` here, and `package.json` + `bun.lock` pin actual minors at implementation time.
