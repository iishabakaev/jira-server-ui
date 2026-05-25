# 02 — Project Structure

A Bun-workspace monorepo, feature-sliced, schema-first.

## Top-level

```
jira-ui/
├── apps/
│   ├── server/          # Elysia HTTP + SSE
│   ├── web/             # React SPA (Vite)
│   └── jobs/            # pg-boss workers (sync, push, workflow planner)
├── packages/
│   ├── db/              # Drizzle schema + migrations + client (canonical model)
│   ├── jira/            # Jira REST client + webhook payload types
│   ├── ui/              # shadcn-ui owned components + design tokens
│   ├── eden/            # Eden Treaty type re-export
│   └── config/          # tsconfig, biome, tailwind presets
├── infra/
│   ├── docker/
│   │   └── Dockerfile   # single multi-stage image (api | worker | web roles)
│   └── compose/
│       ├── compose.yaml
│       └── .env.example
├── docs/specs/          # the specs you are reading
├── .agents/             # AI conventions (CODEBASE_MAP, PATTERNS, DO_NOT)
├── biome.json
├── tsconfig.base.json
├── bun.lock
└── package.json         # workspaces: ["apps/*", "packages/*"]
```

There is **no** `packages/contracts/`. The Elysia routes + `t.*` schemas are the contract; the frontend imports the App type via Eden Treaty.

## Single Docker image

`infra/docker/Dockerfile` is multi-stage:

```dockerfile
# ---- build stage ----
FROM oven/bun:1.2 AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --filter @app/web build       # produces apps/web/dist
RUN bun build apps/server/src/index.ts --outdir dist/server --target bun
RUN bun build apps/jobs/src/index.ts   --outdir dist/jobs   --target bun

# ---- runtime stage ----
FROM oven/bun:1.2-distroless
WORKDIR /app
COPY --from=build /repo/dist /app
COPY --from=build /repo/apps/web/dist /app/web
COPY --from=build /repo/packages/db/drizzle /app/db/drizzle
ENV NODE_ENV=production
# ROLE = api | worker | web
COPY infra/docker/entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

`entrypoint.sh` selects the runtime based on `ROLE`:

```sh
#!/bin/sh
case "${ROLE:-api}" in
  api)    exec bun /app/server/index.js ;;
  worker) exec bun /app/jobs/index.js ;;
  web)    exec bun --static /app/web --port "${PORT:-8080}" ;;
  *)      echo "unknown ROLE: $ROLE"; exit 2 ;;
esac
```

Compose still wires three replicas of the same image:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: jira_ui }
    command: ["postgres", "-c", "max_connections=200", "-c", "shared_buffers=512MB"]
    volumes: [pg:/var/lib/postgresql/data]
  api:
    image: jira-ui:latest
    environment: { ROLE: api, DATABASE_URL: postgres://app:app@postgres:5432/jira_ui }
    depends_on: [postgres]
    ports: ["3000:3000"]
  worker:
    image: jira-ui:latest
    environment: { ROLE: worker, DATABASE_URL: postgres://app:app@postgres:5432/jira_ui }
    depends_on: [postgres]
  web:
    image: jira-ui:latest
    environment: { ROLE: web, PORT: 8080 }
    ports: ["8080:8080"]
volumes:
  pg:
```

No Redis service. The three app roles share the single product image (`jira-ui:latest`) and require only Postgres.

## `apps/server` (Elysia)

```
apps/server/
├── src/
│   ├── index.ts                 # Elysia bootstrap; mounts modules
│   ├── env.ts                   # TypeBox-validated env via Elysia's `t.*`
│   ├── plugins/
│   │   ├── auth.ts              # OIDC + local + session
│   │   ├── error.ts             # uniform error envelope
│   │   ├── logger.ts            # pino bindings
│   │   ├── rateLimit.ts
│   │   └── sse.ts               # SSE topic registry
│   ├── modules/                 # one folder per bounded context
│   │   ├── auth/                # /api/auth/*
│   │   ├── users/
│   │   ├── issues/              # routes.ts service.ts mutations.ts queries.ts
│   │   ├── boards/
│   │   ├── sprints/
│   │   ├── timeline/
│   │   ├── workflow/            # plan + execute multi-step transitions
│   │   ├── sync/                # webhook receiver, admin sync triggers
│   │   └── admin/
│   ├── lib/
│   │   ├── crypto.ts            # AES-GCM helpers for PAT envelope encryption
│   │   ├── outbox.ts            # transactional outbox helpers
│   │   ├── rank.ts              # LexoRank-style ordering keys
│   │   ├── adf.ts               # ADF (de)normalization
│   │   └── time.ts
│   └── types/
│       └── app.ts               # export type App = typeof app  (for Eden)
└── package.json
```

### Rules for `apps/server`

- A route file only does HTTP (parse, validate via `t.*`, call service, format response).
- A service file is business logic; it **never** imports the Jira client. It pushes to the outbox.
- `mutations.ts` always wraps DB write + outbox insert in **one transaction**.
- `queries.ts` is read-only and prefers materialized views.
- Validation lives inline on each route as `body: t.Object({...})`, `query: t.Object({...})`. Eden infers the types from those.
- The Elysia app's type is exported as `App` and re-exported from `packages/eden`.

## `apps/web` (React SPA)

```
apps/web/
├── src/
│   ├── main.tsx
│   ├── app.tsx                  # Router + providers
│   ├── routes/                  # TanStack Router file-based
│   │   ├── __root.tsx
│   │   ├── _auth/
│   │   │   ├── kanban.tsx
│   │   │   ├── timeline.tsx
│   │   │   ├── issues.$key.tsx
│   │   │   └── settings/
│   │   │       ├── jira.tsx
│   │   │       ├── projects.tsx
│   │   │       └── account.tsx
│   │   └── login.tsx
│   ├── features/
│   │   ├── kanban/
│   │   ├── timeline/
│   │   ├── issue-editor/
│   │   ├── workflow-planner/    # the multi-step transition wizard
│   │   ├── auth/
│   │   ├── filters/
│   │   ├── sync-status/
│   │   └── admin/
│   ├── components/
│   │   ├── ui/                  # re-exports from packages/ui
│   │   ├── layout/
│   │   └── kbd/
│   ├── lib/
│   │   ├── eden.ts              # Eden Treaty instance
│   │   ├── query-client.ts
│   │   ├── sse.ts               # singleton EventSource manager
│   │   ├── shortcuts.ts
│   │   └── typebox-resolver.ts  # react-hook-form resolver for TypeBox
│   ├── styles/
│   │   └── globals.css          # Tailwind v4 + design tokens
│   └── env.ts
└── package.json
```

### Rules for `apps/web`

- A feature owns its components, hooks, store, and api wrapper. Features import from `components/`, `lib/`, `packages/*`, never from another feature's internals.
- **No `axios` / `fetch` in components.** All transport through `lib/eden.ts`.
- Server state in TanStack Query; client-only state in feature `store.ts` (zustand).
- URL state via TanStack Router search-param schemas (TypeBox).

## `apps/jobs`

```
apps/jobs/
├── src/
│   ├── index.ts                 # entrypoint registered by entrypoint.sh
│   ├── boss.ts                  # pg-boss client wrapper
│   ├── tasks/
│   │   ├── push-outbox.ts       # drains outbox → Jira REST
│   │   ├── full-sync.ts         # paginated JQL backfill (resumable)
│   │   ├── incremental-sync.ts  # since-cursor pulls (scheduled)
│   │   ├── webhook-reconcile.ts # applies incoming webhook payloads
│   │   ├── refresh-metadata.ts  # projects, fields, statuses, link types
│   │   ├── refresh-workflow.ts  # populates packages/db transitions cache
│   │   └── workflow-run.ts      # advances workflow_plans / workflow_steps
│   ├── lib/
│   │   ├── jira.ts              # auth header injection, retries
│   │   ├── rate-limit.ts        # token bucket per Jira instance
│   │   └── queue.ts             # pluggable contract (pg-boss default)
│   └── env.ts
└── package.json
```

## `packages/db`

The **canonical model**. Schemas live as TS files; the markdown spec only references them.

```
packages/db/
├── src/
│   ├── client.ts                # drizzle on bun-sql singleton
│   ├── migrate.ts               # runs migrations on boot
│   ├── seed.ts                  # local seed (admin local account, sample project)
│   └── schema/
│       ├── enums.ts
│       ├── users.ts
│       ├── sessions.ts
│       ├── local_credentials.ts
│       ├── jira_credentials.ts
│       ├── projects.ts
│       ├── metadata.ts          # issue_types, statuses, priorities, resolutions, link_types, field_schemas
│       ├── issues.ts
│       ├── issue_links.ts
│       ├── comments.ts
│       ├── worklogs.ts
│       ├── attachments.ts
│       ├── boards.ts
│       ├── sprints.ts
│       ├── outbox.ts
│       ├── sync.ts              # sync_cursor, webhook_inbox
│       ├── workflow.ts          # transitions cache + workflow_plans + workflow_steps
│       ├── conflicts.ts
│       ├── audit.ts
│       ├── saved_views.ts
│       ├── relations.ts
│       └── index.ts
├── drizzle/                     # generated migrations (committed)
├── drizzle.config.ts
└── package.json
```

## `packages/eden`

```
packages/eden/
├── src/
│   └── index.ts        # export type App from '../../apps/server/src/types/app'
└── package.json
```

## `.agents/` (AI-native)

- `CODEBASE_MAP.md` — one paragraph per top-level folder; updated by hand.
- `PATTERNS.md` — copy-pasteable templates: "add a route", "add an outbox kind", "add a schema table", "add a feature".
- `DO_NOT.md` — anti-patterns specific to this repo (e.g. *never import Jira client in a service file*; *never declare a Zod schema*).
- A `README.md` inside each `features/<name>/` is the prompt input for future agent work.

## Path aliases (`tsconfig.base.json`)

```jsonc
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@db":         ["packages/db/src/index.ts"],
      "@db/*":       ["packages/db/src/*"],
      "@jira/*":     ["packages/jira/src/*"],
      "@ui/*":       ["packages/ui/src/*"],
      "@eden":       ["packages/eden/src/index.ts"],
      "@/*":         ["apps/web/src/*"],
      "@server/*":   ["apps/server/src/*"]
    }
  }
}
```

`@/*` only resolves inside `apps/web`; `@server/*` only inside `apps/server`. Cross-app reaches are not allowed.

## Adding a new feature (template)

1. `apps/server/src/modules/<feature>/` — `routes.ts` (with `t.*` validators), `service.ts`, `mutations.ts`, `queries.ts`.
2. Mount the route in `apps/server/src/index.ts`.
3. If state changes, add an outbox `kind` and handle it in `apps/jobs/src/tasks/push-outbox.ts`.
4. `apps/web/src/features/<feature>/` — `components/`, `hooks/`, `store.ts`, `api.ts` (Eden wrappers), `index.ts`, `README.md`.
5. Add the route in `apps/web/src/routes/_auth/<feature>.tsx`.
6. Add schema changes in `packages/db/src/schema/`; generate migration with `bun run --filter @app/db generate`.
7. Tests co-located (`*.test.ts`).
