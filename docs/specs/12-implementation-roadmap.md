# 12 — Implementation Roadmap

A phased plan an AI agent (or team) can execute. Each milestone is independently demoable. Tests and docs land with each phase, not after.

## Milestone 0 — Skeleton & tooling (~1–2 days of agent work)

- [ ] Bun workspace init: `apps/{server,web,jobs}`, `packages/{db,jira,ui,eden,config}` (no `contracts`).
- [ ] Biome config, tsconfig base, EditorConfig.
- [ ] Server skeleton: Elysia, `/api/health/*`, env validation via `t.*`, pino, error plugin.
- [ ] Web skeleton: Vite, React 19, TanStack Router with a `__root` and a placeholder `/login`.
- [ ] Tailwind v4 set up; first shadcn component (`Button`) committed under `packages/ui`.
- [ ] Drizzle schema files for `users`, `user_sessions`, `local_credentials` committed under `packages/db/src/schema/`.
- [ ] **Single Dockerfile** at `infra/docker/Dockerfile` + `entrypoint.sh` that role-switches.
- [ ] Compose with postgres + api + worker + web (all three app services from one image).
- [ ] `.agents/` README + DO_NOT.md initial entries.

**Definition of done**: `docker compose up` boots the full stack, login page loads, `curl /api/health/live` returns 200.

## Milestone 1 — Auth end-to-end (local first, Keycloak second)

- [ ] **Local accounts**: Argon2id, `local_credentials` table, `/api/auth/local/*` routes, CLI `bun run cli users create`.
- [ ] Cookie session via Postgres, shared by both providers.
- [ ] Keycloak OIDC plugin (`openid-client`), `/api/auth/keycloak/{login,callback}`.
- [ ] `/api/auth/me`, `/api/auth/logout`.
- [ ] User provisioning on first login from either provider.
- [ ] Web: `/login` with provider cards (enabled per env), AuthProvider, redirect logic.
- [ ] Jira PAT attach flow: `/api/auth/jira-pat`, AES-GCM envelope encryption, validation against `myself`.
- [ ] Web: `/settings/jira` page; gating that blocks the app until PAT attached.

**Demo**: `bun run cli users create admin`, log in locally without Keycloak, attach a PAT, see "you're connected as Jira user X". Then flip Keycloak on and verify the second path.

## Milestone 2 — Data model & full sync

- [ ] All Drizzle schemas from `04-data-model.md`.
- [ ] Drizzle migrations generated and committed.
- [ ] `packages/jira`: REST client (auth header injection, response typing for the endpoints we use).
- [ ] `apps/jobs`: queue abstraction, Trigger.dev v3 self-hosted integration (or pg-boss adapter).
- [ ] `refresh-metadata` task: pulls projects, statuses, issue types, link types, custom field map.
- [ ] `full-sync` task with checkpointing, throttling, resume.
- [ ] Admin route to trigger full sync.
- [ ] Simple `/api/sync/status` JSON endpoint.

**Demo**: trigger a full sync on a small project, watch issues land in DB, query the DB.

## Milestone 3 — Webhooks & incremental sync

- [ ] `/api/webhooks/jira` endpoint, shared-secret auth, `webhook_inbox` persistence.
- [ ] `webhook-reconcile` worker.
- [ ] `incremental-sync` scheduled task with `sync_cursor`.
- [ ] SSE channel (`/api/events`) with topics, Postgres `LISTEN/NOTIFY` fan-out, UNLOGGED `sse_events` replay buffer, heartbeat.

**Demo**: edit an issue in Jira, see the DB update within seconds (via logs).

## Milestone 4 — Kanban (read-only)

- [ ] `mv_kanban_card` view + refresh strategy.
- [ ] `GET /api/issues` with the structured filter (`06-api.md`).
- [ ] `GET /api/boards`, `GET /api/boards/:id`, `GET /api/boards/:id/kanban`.
- [ ] Eden Treaty wired up in web.
- [ ] `features/kanban`: page, virtualized columns, comfortable density, basic filters, URL state.
- [ ] SSE subscription patches cache for `issue.upserted`/`deleted`.

**Demo**: open kanban, scroll through 1k issues smoothly, filters work, edits in Jira show up live.

## Milestone 5 — Kanban DnD + write-back

- [ ] Outbox table + `push-outbox` worker.
- [ ] `POST /api/issues/batch-rank`, `POST /api/issues/:k/transition`, `PATCH /api/issues/:k`.
- [ ] LexoRank-style rank lib.
- [ ] @dnd-kit integration, optimistic cache updates, error rollback.
- [ ] Sync state pip on cards.

**Demo**: drag a card between columns, see optimistic move, watch sync state pip turn green; pull network and observe error state + retry.

## Milestone 5b — Workflow engine

- [x] `transitions` cache + `refresh-workflow` job (per-issue-type, populated by walking active statuses).
- [x] BFS planner in `apps/server/src/modules/workflow/planner.ts` (`findPath`, plus `bfsReachable` for the multi-hop status dropdown).
- [x] `POST /api/workflow/plan` returning the wizard preview with required fields.
- [x] `workflow_plans` + `workflow_steps` persistence; `POST /api/workflow/execute`.
- [x] `workflow-run` worker that drives the chain through the outbox.
- [ ] SSE events for plan/step lifecycle — *deferred; UI polls every 2 s until `done`/`failed`/`cancelled`/`paused`.*
- [x] Web `features/workflow-planner/` (wizard + status-field PlanProgressBadge). Integrated into `issue-editor`'s `PropertiesGrid`: one-hop transitions commit directly, multi-hop and required-field transitions open the wizard. `GET /api/workflow/reachable` powers the multi-hop dropdown.

**Demo**: on a Process task in "Sprint backlog", set status = "Closed"; wizard prompts for required fields on the final step; click Run; watch three transitions tick through; final state lands in Jira.

## Milestone 6 — Issue editor

- [x] `GET /api/issues/:key/detail` with subtasks, links, comments, worklogs.
- [x] `features/issue-editor`: side panel, full-screen variant, properties grid, subtask checklist. *(MVP — TipTap description editor still deferred; description renders as plain text from `description_text`.)*
- [x] Patch wiring with optimistic updates (`usePatchIssue` rolls back on error).
- [x] Comment add/edit/delete via outbox (`POST/PATCH/DELETE /api/issues/comments[/:id]`).
- [x] Quick-create endpoint (`POST /api/issues`) — writes a draft row with temporary key + `issue.create` outbox event.
- [x] Quick-create `c` hotkey + UI surface — `features/quick-create/` with `<dialog>`-based modal, `c` hotkey (skipped when typing), Cmd/Ctrl+Enter submit, board-driven `availableIssueTypes` selector, optimistic kanban-namespace invalidation. *("+ New" button in kanban TopBar provides the mouse equivalent.)*
- [ ] TipTap rich-text description editor with ADF round-trip — deferred.
- [x] Field config-driven rendering (custom fields). **MVP (read-only)**: `IssueDetail` теперь несёт `fieldSchema: { fields: FieldDef[] } | null`, заполняемое из `field_schemas` (см. `loadFieldSchema` в `apps/server/src/modules/issues/queries.ts`). Клиентский `CustomFieldsList` (`apps/web/src/features/issue-editor/components/`) рендерит `customfield_*`-поля с `surface ⊇ ['editor']` в порядке `def.order`, диспетчеризуя по `schema.type` (option/user/array/date/etc.) с JSON-fallback'ом. Редактирование — следующая итерация.
- [x] Activity tab — MVP reads outbox-derived local mutations chronologically with sync-state pip, attempt counter, and last-error line. Pure renderer covered by 13 server unit tests; ActivityTab.test.tsx (component) deferred to the Milestone 9 vitest+jsdom rollout. Webhook-derived inbound changes (status/assignee diffs from Jira) are a follow-up; not blocked.
- [ ] Workflow wizard integration in status field (multi-hop transitions).
- [x] Drag-reorder subtasks via dnd-kit. `SubtaskList` обёрнут в `@dnd-kit/sortable` `SortableContext`; drop переиздаёт rank через POST `/api/issues/batch-rank` (reuse существующего endpoint'а), `loadSubtasks` сортирует по `ordering_rank ASC NULLS LAST`. Подробности — `apps/web/src/features/issue-editor/hooks.ts#useReorderSubtasks`.

**Demo**: click a card → edit summary, assignee, status, add subtask, write a comment, see everything reflect in Jira after a moment.

## Milestone 7 — Timeline

- [x] `GET /api/timeline` (date-windowed bars). **MVP**: `apps/server/src/modules/timeline/` отдаёт плоский массив issues, пересекающихся с окном `[from, to]`; `mv_timeline_bar` view отложен — на текущих размерах проектов одиночного join'а хватает (см. follow-up ниже).
- [x] Date mutations reuse `PATCH /api/issues/:k` — `issuesMutations.patch` уже принимает `startDate`/`dueDate` и пишет outbox-строку в одной транзакции, отдельного `/timeline/issues/:id/dates` не нужно.
- [x] `features/timeline`: virtualized rows (`@tanstack/react-virtual`), drag/resize bars, zoom levels (W/2W/M/Q), today line. Поддержка группировки epic/assignee/sprint/none. URL-state через TanStack Router.
- [ ] Dependency arrows + capacity overlay — *deferred (M7-follow-up)*. См. `apps/web/src/features/timeline/README.md`.
- [ ] Bulk plan mode (`⌘+Shift+P`) — *deferred*.
- [ ] `mv_timeline_bar` материализованный view — *deferred, нужен когда размер проекта ≥10k issues*.

**Demo**: open timeline, drag a bar by 3 days, draw a blocking dep, watch updates push to Jira.

## Milestone 8 — Saved views, command palette, polish

- [ ] Saved views CRUD on kanban (per-user and shared).
- [ ] `⌘ K` command palette (`cmdk`), populated with navigation, filter, mutation commands.
- [x] Sync status admin page (`/admin/sync`). Read-only dashboard: new `GET /api/sync/admin` (requireRole: `app_admin`) отдаёт per-project sync_cursor + outbox-агрегат по состояниям + webhook_inbox health (`unprocessed`/`stuck≥10`/`withError`, last error/received/processed). UI — TanStack route `apps/web/src/routes/admin.sync.tsx`, поллит каждые 5 c, кнопка «Trigger full sync» переиспользует существующий `POST /api/sync/projects/:id/full-sync`.
- [ ] Conflict resolution UI.
- [x] PAT-needs-reattach banner. **MVP (poll-based)**: новый `PatReattachBanner` в `apps/web/src/features/auth/components/`, монтируется в `__root.tsx` над `<Outlet/>`. Появляется когда `usePatStatus()` отдаёт `attached && needsReattach`; ссылка ведёт на `/settings/jira`, есть session-only Dismiss. SSE-вариант (`auth.pat-needs-reattach`) — follow-up: ждём Milestone 3 (LISTEN/NOTIFY + `sse_events`), пока polling даёт latency ≤ 30 c (staleTime usePatStatus).

**Demo**: invoke palette to jump to a specific board, save a view, trigger a conflict by editing both sides, resolve it.

## Milestone 8b — i18n & bilingual fields

- [ ] Postgres `unaccent` extension enabled; FTS uses `und-x-icu` collation.
- [ ] All UI strings flow through a `t()` helper; default locale `en`, language-aware status names from Jira.
- [ ] Verify the kanban / timeline render Russian status names (e.g. `Поставка на контур нагрузочного тестирования [In Progress]`) without truncation issues.

**Demo**: connect to a Russian-language Jira project, kanban columns + cards + custom fields render correctly; search finds `"очередь"` regardless of case.

## Milestone 9 — Observability, hardening, docs

- [ ] OpenTelemetry SDK, Prometheus metrics endpoint.
- [ ] Rate-limit middleware.
- [ ] Sentry / Glitchtip SDK in web.
- [ ] Backup script, key rotation script.
- [ ] Playwright E2E covering: login, attach PAT, create issue, drag, comment, sync error rollback.
- [ ] `.agents/PATTERNS.md` filled out with the templates the agents have validated by now.

**Demo**: kill the Jira host mid-edit, observe queued outbox, restart Jira, watch the queue drain.

## Future (not in initial scope)

- Atlassian OAuth as PAT alternative.
- Mobile-friendly layouts.
- Reactions on comments.
- Per-team workflows visualized as a Mermaid graph on the issue editor.
- Multi-Jira-instance support.
- Plug-in points for company-specific automations (a small DSL on top of outbox events).

## Definition of "done"

For each milestone:

1. Server tests for new endpoints; coverage on critical paths.
2. Web tests for new hooks and 1–2 critical components.
3. E2E covering the milestone's demo scenario.
4. Docs in `docs/specs/` updated where the implementation diverged from spec.
5. `.agents/` notes updated with anything new agents need to know.
6. `bun run lint && bun run typecheck && bun test && bun run build` all green.
