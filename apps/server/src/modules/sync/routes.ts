import { conflicts, db, issues, outboxEvents, projects, syncCursor, webhookInbox } from '@db'
import { eq, inArray, sql } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { env } from '../../env'
import { enqueueJob } from '../../lib/queue'
import { auth } from '../../plugins/auth'
import { logger } from '../../plugins/logger'

// Sync-модуль: приём webhook'ов от Jira, статус синхронизации, админ-эндпоинты
// для запуска полного бэкфилла. Контракты — см. docs/specs/05-sync-engine.md и
// docs/specs/06-api.md.

// Constant-time сравнение строк. crypto.timingSafeEqual требует одинаковой
// длины буферов; на разную сразу возвращаем false без раннего выхода.
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

function pickKind(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    const ev = (payload as { webhookEvent?: string }).webhookEvent
    if (typeof ev === 'string' && ev.length) return ev
  }
  return 'jira:unknown'
}

export const syncModule = new Elysia()
  .use(auth)
  // ─── Webhook-приёмник ─────────────────────────────────────────────────────
  // Jira POST'ит сюда события issue/comment/sprint/worklog. Контракт: всегда
  // 200 (даже на «битый» payload), чтобы Jira не зацикливалась на ретраях.
  // Тело пишется как есть в webhook_inbox; обработка — отдельным воркером.
  .post(
    '/webhooks/jira',
    async ({ headers, body, set }) => {
      const expected = env.JIRA_WEBHOOK_SECRET
      const got = headers['x-webhook-token'] ?? ''
      if (expected) {
        if (!timingSafeEqualStr(got, expected)) {
          logger.warn({ msg: 'webhook.bad_token' }, 'jira.webhook')
          set.status = 200
          return { received: false }
        }
      } else {
        // Fail-closed в production: без сконфигурированного секрета любой
        // сетевой клиент мог бы заполнить webhook_inbox произвольным payload'ом
        // (security review HIGH). В dev оставляем мягкое предупреждение —
        // удобно для локальной отладки без полной обвязки Jira.
        if (env.NODE_ENV === 'production') {
          logger.error({ msg: 'webhook.secret_not_configured' }, 'jira.webhook')
          set.status = 503
          return { received: false }
        }
        logger.warn({ msg: 'webhook.secret_not_configured' }, 'jira.webhook')
      }
      try {
        const kind = pickKind(body)
        await db.insert(webhookInbox).values({ kind, payload: body ?? {} })
        // Запинаем worker, чтобы он не ждал следующего тика scheduler'а.
        await enqueueJob('webhook-reconcile', {})
      } catch (err) {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'webhook.persist_failed',
        )
      }
      set.status = 200
      return { received: true }
    },
    {
      // Произвольный JSON — Jira шлёт разный shape по типу события.
      body: t.Unknown(),
      headers: t.Object({
        'x-webhook-token': t.Optional(t.String({ maxLength: 256 })),
      }),
    },
  )
  // ─── Статус ───────────────────────────────────────────────────────────────
  .get(
    '/sync/status',
    async ({ user }) => {
      if (!user) return { error: { code: 'unauthenticated' } }
      // Значения 'pending'|'in_flight'|'done'|'dead' соответствуют outbox_state
      // enum (см. packages/db/src/schema/enums.ts) — раньше тут учитывался
      // несуществующий 'error', что давало вечный ноль (architect review).
      const [outboxAgg] = await db
        .select({
          pending: sql<number>`count(*) filter (where state='pending')::int`,
          inFlight: sql<number>`count(*) filter (where state='in_flight')::int`,
          done: sql<number>`count(*) filter (where state='done')::int`,
          dead: sql<number>`count(*) filter (where state='dead')::int`,
        })
        .from(outboxEvents)
      const [lastWebhook] = await db
        .select({ at: sql<Date | null>`max(received_at)` })
        .from(webhookInbox)
      return {
        outbox: outboxAgg ?? { pending: 0, inFlight: 0, done: 0, dead: 0 },
        lastWebhookAt: lastWebhook?.at ?? null,
      }
    },
    { requireAuth: true },
  )
  // ─── Админ: расширенный статус для /admin/sync ───────────────────────────
  // Один запрос отдаёт всё, что нужно админ-странице: per-project sync_cursor,
  // outbox-агрегат по состояниям, webhook_inbox health. Сорт по project.key.
  .get(
    '/sync/admin',
    async () => {
      // Per-project: left join sync_cursor — у новых проектов курсора нет.
      // metadata.syncEnabled !== false означает «синхронизация включена»; так
      // существующие проекты без явного флага считаются включёнными по умолчанию.
      const perProject = await db
        .select({
          id: projects.id,
          key: projects.key,
          name: projects.name,
          metadata: projects.metadata,
          lastUpdatedAt: syncCursor.lastUpdatedAt,
          lastFullSyncAt: syncCursor.lastFullSyncAt,
          lastRunId: syncCursor.lastRunId,
        })
        .from(projects)
        .leftJoin(syncCursor, eq(syncCursor.projectId, projects.id))
        .orderBy(projects.key)

      // Все пять значений `outbox_state` (см. packages/db/src/schema/enums.ts
      // + drizzle/0000_init.sql) учитываем явно. `error` — транзитное (retry
      // loop), `dead` — финальное после MAX_ATTEMPTS. Это диагностически
      // полезно: ненулевой `error` означает, что у воркера есть текущий блок
      // с Jira, который ещё не превратился в окончательный `dead`.
      // (NB: соседний /sync/status исторически опускает `error`; здесь
      // сознательно вернули — админ-странице нужна полная картина.)
      const [outboxAgg] = await db
        .select({
          pending: sql<number>`count(*) filter (where state='pending')::int`,
          inFlight: sql<number>`count(*) filter (where state='in_flight')::int`,
          done: sql<number>`count(*) filter (where state='done')::int`,
          error: sql<number>`count(*) filter (where state='error')::int`,
          dead: sql<number>`count(*) filter (where state='dead')::int`,
        })
        .from(outboxEvents)

      // Webhook health: unprocessed = processed_at IS NULL AND attempts < MAX.
      // Здесь воспроизводить MAX_ATTEMPTS не хочется (он живёт в воркере),
      // поэтому отдаём отдельно "unprocessed" и "stuck" — фронт сам разберётся.
      const [webhookAgg] = await db
        .select({
          unprocessed: sql<number>`count(*) filter (where processed_at is null)::int`,
          stuck: sql<number>`count(*) filter (where processed_at is null and attempts >= 10)::int`,
          withError: sql<number>`count(*) filter (where error is not null)::int`,
          lastReceivedAt: sql<Date | null>`max(received_at)`,
          lastProcessedAt: sql<Date | null>`max(processed_at)`,
        })
        .from(webhookInbox)

      // Последняя строка с непустым error (для строки "last error message").
      const [lastErrorRow] = await db
        .select({ error: webhookInbox.error, receivedAt: webhookInbox.receivedAt })
        .from(webhookInbox)
        .where(sql`${webhookInbox.error} is not null`)
        .orderBy(sql`${webhookInbox.receivedAt} desc`)
        .limit(1)

      // Write-конфликты с Jira (см. packages/db/src/schema/conflicts.ts).
      // Unresolved = resolved_at IS NULL — это и есть число "ждёт решения
      // руками через будущий /admin/conflicts UI".
      const [conflictAgg] = await db
        .select({
          unresolved: sql<number>`count(*) filter (where resolved_at is null)::int`,
          lastCreatedAt: sql<Date | null>`max(created_at) filter (where resolved_at is null)`,
        })
        .from(conflicts)

      // lastError приходит из worker'а и может содержать многокилобайтные
      // jira-error-blob'ы, stack traces или (если воркер случайно залогирует)
      // токены. Срезаем control-chars и каппим длину — UI всё равно показывает
      // его одной строкой, а 5s-поллинг иначе тянул бы по килобайту в каждый
      // запрос (security-review MEDIUM). Заменяем C0-control-чары (codepoint
      // < 32) и DEL (127) на пробел. Посимвольным проходом, потому что regex
      // с literal-control-chars подсвечивает biome's noControlCharactersInRegex.
      const sanitizeError = (raw: string | null): string | null => {
        if (!raw) return null
        let out = ''
        const limit = Math.min(raw.length, 500)
        for (let i = 0; i < limit; i += 1) {
          const code = raw.charCodeAt(i)
          out += code < 32 || code === 127 ? ' ' : raw[i]
        }
        return out
      }

      return {
        projects: perProject.map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          // Sync выключен по умолчанию: новый refresh-metadata-проход не
          // должен молча включать sync для всех 2k+ проектов. Админ явно
          // отмечает галочками те, что нужно держать в актуальном состоянии.
          syncEnabled: p.metadata?.syncEnabled === true,
          lastUpdatedAt: p.lastUpdatedAt ? p.lastUpdatedAt.toISOString() : null,
          lastFullSyncAt: p.lastFullSyncAt ? p.lastFullSyncAt.toISOString() : null,
          lastRunId: p.lastRunId,
        })),
        outbox: outboxAgg ?? { pending: 0, inFlight: 0, done: 0, error: 0, dead: 0 },
        webhookInbox: {
          unprocessed: webhookAgg?.unprocessed ?? 0,
          stuck: webhookAgg?.stuck ?? 0,
          withError: webhookAgg?.withError ?? 0,
          lastReceivedAt: webhookAgg?.lastReceivedAt
            ? webhookAgg.lastReceivedAt.toISOString()
            : null,
          lastProcessedAt: webhookAgg?.lastProcessedAt
            ? webhookAgg.lastProcessedAt.toISOString()
            : null,
          lastError: sanitizeError(lastErrorRow?.error ?? null),
          lastErrorAt: lastErrorRow?.receivedAt ? lastErrorRow.receivedAt.toISOString() : null,
        },
        conflicts: {
          unresolved: conflictAgg?.unresolved ?? 0,
          lastCreatedAt: conflictAgg?.lastCreatedAt
            ? conflictAgg.lastCreatedAt.toISOString()
            : null,
        },
      }
    },
    {
      requireRole: 'app_admin',
      response: {
        200: t.Object({
          projects: t.Array(
            t.Object({
              id: t.String({ format: 'uuid' }),
              key: t.String(),
              name: t.String(),
              syncEnabled: t.Boolean(),
              lastUpdatedAt: t.Union([t.String(), t.Null()]),
              lastFullSyncAt: t.Union([t.String(), t.Null()]),
              lastRunId: t.Union([t.String(), t.Null()]),
            }),
          ),
          outbox: t.Object({
            pending: t.Integer(),
            inFlight: t.Integer(),
            done: t.Integer(),
            error: t.Integer(),
            dead: t.Integer(),
          }),
          webhookInbox: t.Object({
            unprocessed: t.Integer(),
            stuck: t.Integer(),
            withError: t.Integer(),
            lastReceivedAt: t.Union([t.String(), t.Null()]),
            lastProcessedAt: t.Union([t.String(), t.Null()]),
            lastError: t.Union([t.String(), t.Null()]),
            lastErrorAt: t.Union([t.String(), t.Null()]),
          }),
          conflicts: t.Object({
            unresolved: t.Integer(),
            lastCreatedAt: t.Union([t.String(), t.Null()]),
          }),
        }),
      },
    },
  )
  // ─── Список синхронизированных проектов (для timeline picker и т.п.) ─────
  // Доступно любому авторизованному юзеру: возвращает проекты, для которых
  // прошёл хотя бы один full-sync ИЛИ incremental-sync (т.е. в БД есть issue).
  // Это не админский endpoint — он нужен фронту, чтобы заполнить
  // project-picker (TimelinePage/KanbanPage), пока нет boards/Agile API.
  .get(
    '/sync/projects',
    async () => {
      // Только проекты с реальными issues — sync_cursor может появиться от
      // incremental-sync даже на «пустых» проектах (фильтр updated >= since
      // ничего не нашёл, но курсор обновлён). Picker'у нужны те, где есть что
      // показывать.
      const rows = await db
        .select({
          id: projects.id,
          key: projects.key,
          name: projects.name,
          lastUpdatedAt: syncCursor.lastUpdatedAt,
          lastFullSyncAt: syncCursor.lastFullSyncAt,
        })
        .from(projects)
        .leftJoin(syncCursor, eq(syncCursor.projectId, projects.id))
        .where(sql`exists (select 1 from ${issues} where ${issues.projectId} = ${projects.id})`)
        .orderBy(projects.key)
      return {
        items: rows.map((r) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          lastUpdatedAt: r.lastUpdatedAt ? r.lastUpdatedAt.toISOString() : null,
          lastFullSyncAt: r.lastFullSyncAt ? r.lastFullSyncAt.toISOString() : null,
        })),
      }
    },
    {
      requireAuth: true,
      response: {
        200: t.Object({
          items: t.Array(
            t.Object({
              id: t.String({ format: 'uuid' }),
              key: t.String(),
              name: t.String(),
              lastUpdatedAt: t.Union([t.String(), t.Null()]),
              lastFullSyncAt: t.Union([t.String(), t.Null()]),
            }),
          ),
        }),
      },
    },
  )
  // ─── Админ: ручной запуск refresh-metadata ────────────────────────────────
  // refresh-metadata — это задача, которая населяет таблицу `projects`
  // (плюс statuses/priorities/...) из Jira REST. По умолчанию она на
  // hourly-cron'е; для случая «только что подняли инстанс, проектов в
  // списке нет» админу нужен явный триггер, иначе придётся ждать до
  // ближайшего top-of-hour. Идемпотентный enqueue: singletonKey не даёт
  // нагнать очередь дублями.
  .post(
    '/sync/refresh-metadata',
    async () => {
      const jobId = await enqueueJob(
        'refresh-metadata',
        {},
        { singletonKey: 'refresh-metadata:global' },
      )
      return { ok: true, jobId }
    },
    {
      requireRole: 'app_admin',
      response: {
        200: t.Object({ ok: t.Boolean(), jobId: t.Union([t.String(), t.Null()]) }),
      },
    },
  )
  // ─── Админ: per-project toggle синхронизации ──────────────────────────────
  // PATCH /sync/projects/:id — обновляет metadata.syncEnabled. Отключённые
  // проекты пропускаются sync-fanout'ом (см. apps/jobs/src/index.ts) и
  // больше не получают incremental-sync, пока их не включат обратно.
  .patch(
    '/sync/projects/:id',
    async ({ params, body, set }) => {
      const prj = (await db.select().from(projects).where(eq(projects.id, params.id)).limit(1))[0]
      if (!prj) {
        set.status = 404
        return { error: { code: 'not_found', message: 'Project not found' } }
      }
      const nextMetadata = {
        ...(prj.metadata ?? { customfieldMap: {}, promoted: {} }),
        syncEnabled: body.syncEnabled,
      }
      await db
        .update(projects)
        .set({ metadata: nextMetadata, updatedAt: new Date() })
        .where(eq(projects.id, prj.id))
      return { ok: true, syncEnabled: body.syncEnabled }
    },
    {
      requireRole: 'app_admin',
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      body: t.Object({ syncEnabled: t.Boolean() }),
      response: {
        200: t.Object({ ok: t.Boolean(), syncEnabled: t.Boolean() }),
        404: t.Object({
          error: t.Object({ code: t.String(), message: t.String() }),
        }),
      },
    },
  )
  // ─── Админ: bulk toggle (включить/выключить sync для всех) ────────────────
  // PATCH /sync/projects-bulk — за один проход обновляет metadata.syncEnabled
  // у всех (или у указанного списка) проектов. Используется кнопками
  // «Enable all» / «Disable all» на /admin/sync. Если `projectIds` пуст или
  // не задан — применяется ко всем строкам в таблице projects.
  .patch(
    '/sync/projects-bulk',
    async ({ body }) => {
      // jsonb_set обновляет только ключ syncEnabled, не затирая остальные
      // поля metadata (customfieldMap, promoted, и т.п.). Coalesce защищает
      // строки, у которых metadata оказалась NULL — это не должно случиться
      // (default constraint в schema), но дешевле перестраховаться, чем
      // потом расследовать NULL-метаданные после массового апдейта.
      // Загружаем нужные строки, мерджим metadata в JS — драйвер
      // bun-sql иногда теряет точное число затронутых строк при сыром
      // execute, плюс jsonb_set требовал бы dialect-специфичных
      // костылей. Итеративный апдейт нескольких тысяч проектов остаётся
      // дешёвым (одна транзакция, без сетевого latency на каждую строку).
      const targets = body.projectIds && body.projectIds.length > 0
        ? await db
            .select({ id: projects.id, metadata: projects.metadata })
            .from(projects)
            .where(inArray(projects.id, body.projectIds))
        : await db.select({ id: projects.id, metadata: projects.metadata }).from(projects)

      let affected = 0
      await db.transaction(async (tx) => {
        for (const t of targets) {
          const nextMetadata = {
            ...(t.metadata ?? { customfieldMap: {}, promoted: {} }),
            syncEnabled: body.syncEnabled,
          }
          await tx
            .update(projects)
            .set({ metadata: nextMetadata, updatedAt: new Date() })
            .where(eq(projects.id, t.id))
          affected += 1
        }
      })

      return { ok: true, affected, syncEnabled: body.syncEnabled }
    },
    {
      requireRole: 'app_admin',
      body: t.Object({
        syncEnabled: t.Boolean(),
        projectIds: t.Optional(t.Array(t.String({ format: 'uuid' }))),
      }),
      response: {
        200: t.Object({
          ok: t.Boolean(),
          affected: t.Integer(),
          syncEnabled: t.Boolean(),
        }),
      },
    },
  )
  // ─── Админ: запуск full-sync проекта ──────────────────────────────────────
  .post(
    '/sync/projects/:id/full-sync',
    async ({ params, user, set }) => {
      const prj = (await db.select().from(projects).where(eq(projects.id, params.id)).limit(1))[0]
      if (!prj) {
        set.status = 404
        return { error: { code: 'not_found', message: 'Project not found' } }
      }
      if (prj.metadata?.syncEnabled !== true) {
        set.status = 404
        return {
          error: {
            code: 'sync_disabled',
            message: 'Sync is disabled for this project; enable it first',
          },
        }
      }
      // Сбрасываем full-resume-cursor, чтобы прогон начался с нуля.
      await db
        .insert(syncCursor)
        .values({ projectId: prj.id, lastRunId: null })
        .onConflictDoUpdate({
          target: syncCursor.projectId,
          set: { lastRunId: null },
        })
      // Параллельно дёргаем refresh-metadata для проекта: без этого boards/
      // sprints не подтягиваются и kanban остаётся пустой ("No boards mirrored
      // yet"), даже когда issues уже залились через full-sync.
      await enqueueJob(
        'refresh-metadata',
        { projectId: prj.id },
        { singletonKey: `refresh-metadata:${prj.id}` },
      )
      const jobId = await enqueueJob(
        'full-sync',
        { projectId: prj.id, requestedBy: user!.id },
        { singletonKey: `full-sync:${prj.id}` },
      )
      return { ok: true, jobId, projectKey: prj.key }
    },
    {
      requireRole: 'app_admin',
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({
          ok: t.Boolean(),
          jobId: t.Union([t.String(), t.Null()]),
          projectKey: t.String(),
        }),
        404: t.Object({
          error: t.Object({ code: t.String(), message: t.String() }),
        }),
      },
    },
  )
