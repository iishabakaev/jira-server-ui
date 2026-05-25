# PATTERNS — copy-pasteable templates for jira-ui

## Russian-comment style (the only acceptable comment style)

Single-line:
```ts
// Загружает текущий outbox-курсор для воркера. Возвращает null, если
// нет необработанных событий.
```

JSDoc:
```ts
/**
 * Применяет частичный патч к issue. Пишет локальную мутацию и outbox-событие
 * в одной транзакции, чтобы исключить рассинхрон с Jira.
 *
 * @param userId  владелец PAT, от имени которого выполняется push в Jira
 * @param key     ключ issue, например ALFAIAAS-4642
 * @param patch   набор изменяемых полей (см. issuesService.patch)
 */
```

Section banners (only when a file groups several logical parts):
```ts
// ─── Транзакционные мутации ───
```

Identifiers remain English even where comments are Russian:
```ts
// Idempotency-ключ детерминированный: один и тот же патч в пределах 5-секундного
// окна не создаст дубль outbox-строки.
const idempotencyKey = `issue.update:${id}:${hash(patch)}:${bucket(now(), 5_000)}`
```

## Add a new module (server)

```
apps/server/src/modules/<feature>/
├── routes.ts          // HTTP-обработчики, t.* схемы
├── service.ts         // бизнес-логика, без Jira
├── mutations.ts       // запись в БД + outbox в одной транзакции
├── queries.ts         // read-only запросы (предпочтительно к материализованным view)
└── schema.ts          // именованные t.* схемы запросов/ответов
```

Route file skeleton:
```ts
import { Elysia, t } from 'elysia'
import { auth } from '@server/plugins/auth'
import { feature as svc } from './service'

export const featureModule = new Elysia({ prefix: '/feature', name: 'feature' })
  .use(auth)
  .get('/', async ({ user, query }) => svc.list(user!.id, query), {
    requireAuth: true,
    query: t.Object({ /* ... */ }),
    response: { 200: t.Object({ items: t.Array(t.Any()) }) },
  })
```

Then mount in `apps/server/src/index.ts`:
```ts
import { featureModule } from './modules/<feature>/routes'
app.use(featureModule)
```

## Add a state-changing route (DB + outbox in one transaction)

Server-side mutations never touch Jira directly; they call a `mutations.ts`
helper that opens a transaction and writes both the local row and the
outbox row atomically. Pattern (from `apps/server/src/modules/issues/mutations.ts`):

```ts
export const issuesMutations = {
  async patch(userId: string, keyOrId: string, patch: IssuePatch) {
    return db.transaction(async (tx) => {
      const current = await findIssue(tx as unknown as typeof db, keyOrId)
      if (!current) throw appError('not_found', 'Issue not found')

      await tx
        .update(issues)
        .set({ ...buildPatchUpdate(patch), syncState: 'pending', updatedAt: new Date() })
        .where(eq(issues.id, current.id))

      const idem = `issue.update:${current.id}:${hash(patch)}:${bucket(Date.now())}`
      await tx.insert(outboxEvents).values({
        idempotencyKey: idem,
        userId,
        kind: 'issue.update',
        targetKind: 'issue',
        targetId: current.id,
        payload: { keyOrId: current.key, patch },
      }).onConflictDoNothing({ target: outboxEvents.idempotencyKey })

      return current.id
    })
  },
}
```

Rules:
- Idempotency key is deterministic: `<kind>:<targetId>:<hash(payload)>:<bucket(now)>` — same patch within a 5-second window collapses into one outbox row.
- `sync_state='pending'` on the row is mandatory so the UI's status pip turns yellow immediately.
- The HTTP route imports `mutations.ts`, never `db`.

## Add an outbox kind

1. Add the literal to the `kind` switch in `apps/jobs/src/tasks/push-outbox.ts`.
2. Implement the Jira REST call. **Use `acquireAndRun` from `lib/rate-limit.ts`** — there is no escape hatch.
3. Reconcile Jira's response into the local row in the same handler.

Skeleton:
```ts
case 'comment.create': {
  // Создаём комментарий в Jira; ответ содержит id и время создания, синхронизируем строку.
  const created = await acquireAndRun({ userId: row.userId, instance: jiraHost }, () =>
    jira.post(`/rest/api/2/issue/${issueKey}/comment`, { body: row.payload.body }, { bearer })
  )
  await db.update(comments).set({
    jiraId: created.id,
    syncState: 'synced',
    syncedAt: new Date(),
  }).where(eq(comments.id, row.targetId))
  return 'done'
}
```

## Add a schema table

1. New file `packages/db/src/schema/<table>.ts` with the Drizzle definition.
2. Re-export it from `packages/db/src/schema/index.ts`.
3. Add any relations to `packages/db/src/schema/relations.ts`.
4. `bun run --filter @app/db generate` to produce a migration.
5. Verify the migration SQL in `packages/db/drizzle/` (human reviews this).

All schema files use Russian comments. Identifiers stay English.

## Add a webhook handler

1. Subscribed events are listed in `docs/specs/15-performance.md`. Adding a new subscription requires updating that list AND the Jira webhook config — coordinate with the operator.
2. The handler in `apps/server/src/modules/sync/routes.ts` ONLY persists into `webhook_inbox` and 200s.
3. Reconciliation happens in `apps/jobs/src/tasks/webhook-reconcile.ts`.

## Add an SSE event type

1. Add the literal to the `type` discriminator in `apps/server/src/plugins/sse.ts`.
2. Publish via `sse.publish(topic, { type, data })`. The plugin handles `INSERT INTO sse_events` + `pg_notify`.
3. Document the new event in `docs/specs/10-realtime-and-status.md`.
4. Client subscribes in the appropriate feature hook (`features/<name>/hooks/use<Name>Events.ts`).

## Surface an outbox-derived activity feed

Use this pattern when a feature needs to render "what did this app do to entity X"
chronologically (issue editor's Activity tab is the reference implementation).

1. Split the rendering into a pure module: `apps/server/src/modules/<feature>/activity.ts`
   exports `renderActivity(row, lookupMaps)` that returns a TypeBox-typed entry. No
   DB imports — the file must be unit-testable without spinning up Postgres.
2. Load the rows in `queries.ts` with a fixed page-size cap (50 is the default),
   sorted `desc(createdAt)`, filtered by `targetKind` and `targetId`. Collect
   foreign-key refs (e.g. status ids) from the payloads, batch-fetch their labels
   in a single `IN` query, then pass a `Map<id, name>` into the renderer.
3. Wire the route as `GET /api/<feature>/:keyOrId/activity` returning
   `{ items: T[] }`. Always `requireAuth: true`.
4. On the web side: keep the query lazy (`enabled` gates the network call to the
   moment the tab is mounted). Invalidate the activity query from the mutations
   that enqueue outbox rows so the feed reflects fresh writes.
5. If the renderer needs information that isn't already in the outbox payload
   (e.g. target status name), augment the mutation's outbox payload at write
   time rather than joining `transitions`/`statuses` at read time — keeps the
   activity query a single-table scan.

## Add a frontend feature

```
apps/web/src/features/<name>/
├── components/
├── hooks/
├── store.ts          // zustand для UI-only состояния
├── api.ts            // обёртка над Eden Treaty
├── index.ts          // публичные экспорты
└── README.md         // контракт фичи, читаемый агентами
```

Rules: do not `fetch` directly — use `lib/eden.ts`. Server state in TanStack Query. Cross-feature access only through `index.ts`.
