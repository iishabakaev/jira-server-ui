import { db, webhookInbox, projects, type Project } from '@db'
import { eq, sql } from 'drizzle-orm'
import { createJiraClient } from '@jira/client'
import type { JiraIssueRaw } from '@jira/client'
import { buildFieldsList } from '@jira/field-sets'
import type { Queue, TaskCtx } from '../lib/queue'
import { pickAnyBearer } from '../lib/credentials'
import { acquireAndRun } from '../lib/rate-limit'
import { env } from '../env'
import { loadRefs, normalizeIssue, softDeleteIssueByJiraId, upsertIssue } from '../lib/normalize-issue'

// Применение Jira-вебхуков из webhook_inbox в наши таблицы.
//
// Стратегия:
//   1. Лизим до BATCH строк через FOR UPDATE SKIP LOCKED и сразу инкрементим
//      attempts — это и есть лизинг-маркер: на ошибке processed_at не ставим,
//      но повторных попыток ограниченное число, иначе строка не зациклит.
//   2. По каждой строке: распознаём вид события и применяем нормализатор.
//      Для событий типа issue_updated тело webhook'а уже содержит
//      сериализованную issue — обходимся без дополнительного GET к Jira.
//      Для событий, где payload неполный, делаем точечный GET по issue.key.
//   3. Помечаем processed_at; при ошибке оставляем processed_at NULL до
//      следующего тика; после MAX_ATTEMPTS — processed_at = now() (dead).

const BATCH = 50
const MAX_ATTEMPTS = 10

interface WebhookRow extends Record<string, unknown> {
  id: number
  kind: string
  payload: unknown
  attempts: number
}

interface JiraWebhookIssueEvent {
  webhookEvent?: string
  issue_event_type_name?: string
  issue?: JiraIssueRaw
  user?: { accountId?: string; name?: string }
}

function asIssue(payload: unknown): JiraIssueRaw | null {
  if (!payload || typeof payload !== 'object') return null
  const obj = payload as JiraWebhookIssueEvent
  if (obj.issue && obj.issue.id && obj.issue.key) return obj.issue
  return null
}

// Точная проверка delete-события. Раньше использовался regex /issue.*delete/i,
// который ложно срабатывал на `jira:issue_property_deleted` и подобных
// (security/architect-review). Проверяем только канонический event-id.
function isDeleteEvent(payload: unknown): boolean {
  const obj = payload as JiraWebhookIssueEvent
  return obj?.webhookEvent === 'jira:issue_deleted'
}

function projectKeyFromIssueKey(key: string): string | null {
  const m = key.match(/^([A-Z][A-Z0-9_]*)-\d+$/i)
  const head = m?.[1]
  return head ? head.toUpperCase() : null
}

async function fetchFullIssue(
  raw: JiraIssueRaw,
  jiraBase: string,
  projectByKey: Map<string, Project>,
): Promise<JiraIssueRaw | null> {
  // Webhook-payload в Jira Server бывает усечён. Если в кеше refs нормализатор
  // не справился, подгружаем issue точечным GET — но с явным fields=, а не
  // `*all` (см. .agents/DO_NOT.md и security-review).
  const projectKey = projectKeyFromIssueKey(raw.key)
  const project = projectKey ? projectByKey.get(projectKey) : undefined
  if (!project) return null
  const creds = await pickAnyBearer()
  if (!creds) return null
  const fields = buildFieldsList(project, 'scan')
  const jira = createJiraClient({ baseUrl: jiraBase, bearer: creds.bearer, timeoutMs: 20_000 })
  return acquireAndRun({ userId: creds.userId, instance: jiraBase }, () =>
    jira.getIssue(raw.key, { fields }),
  )
}

async function leaseBatch(): Promise<WebhookRow[]> {
  // Лизинг: захватываем до BATCH строк, инкрементим attempts, возвращаем тело.
  // Это даёт два эффекта: (1) на ошибке attempts продвигается без правки
  // processed_at, (2) бесконечной зацикленной обработки нет — после MAX_ATTEMPTS
  // worker помечает processed_at вручную и оставляет error.
  const result = await db.execute<WebhookRow>(sql`
    with candidates as (
      select id
      from webhook_inbox
      where processed_at is null
        and attempts < ${MAX_ATTEMPTS}
      order by id
      limit ${BATCH}
      for update skip locked
    )
    update webhook_inbox
       set attempts = attempts + 1
     where id in (select id from candidates)
    returning id, kind, payload, attempts
  `)
  return (result as unknown as { rows: WebhookRow[] }).rows ?? (result as unknown as WebhookRow[])
}

async function markProcessed(id: number) {
  await db
    .update(webhookInbox)
    .set({ processedAt: new Date(), error: null })
    .where(eq(webhookInbox.id, id))
}

async function markFailed(id: number, attempts: number, message: string) {
  if (attempts >= MAX_ATTEMPTS) {
    // Финал: помечаем processed_at, чтобы строка не зацикливалась; error
    // остаётся для аудита.
    await db
      .update(webhookInbox)
      .set({ processedAt: new Date(), error: message })
      .where(eq(webhookInbox.id, id))
  } else {
    await db
      .update(webhookInbox)
      .set({ error: message })
      .where(eq(webhookInbox.id, id))
  }
}

async function applyOne(
  row: WebhookRow,
  refs: Awaited<ReturnType<typeof loadRefs>>,
  ctx: TaskCtx<Record<string, never>>,
): Promise<void> {
  try {
    const payload = row.payload as JiraWebhookIssueEvent

    if (isDeleteEvent(row.payload)) {
      const target = payload.issue
      if (target?.id) {
        const n = await softDeleteIssueByJiraId(target.id)
        ctx.log('webhook.deleted', { id: row.id, jiraId: target.id, rows: n })
      }
      await markProcessed(row.id)
      return
    }

    const rawIssue = asIssue(row.payload)
    if (!rawIssue) {
      // Не-issue-событие (sprint_*, link_*) — отбрасываем; обработчики
      // специализированных типов добавятся позже.
      await markProcessed(row.id)
      return
    }

    let effective = rawIssue
    let n = normalizeIssue(effective, refs)
    if (!n && env.JIRA_BASE_URL) {
      const reloaded = await fetchFullIssue(rawIssue, env.JIRA_BASE_URL, refs.projectByKey)
      if (reloaded) {
        effective = reloaded
        n = normalizeIssue(effective, refs)
      }
    }
    if (!n) {
      throw new Error(`Cannot normalize webhook payload for ${rawIssue.key}`)
    }
    await upsertIssue(n)
    await markProcessed(row.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markFailed(row.id, row.attempts, message)
    ctx.log('webhook.error', { id: row.id, attempts: row.attempts, message })
  }
}

export function registerWebhookReconcile(queue: Queue) {
  queue.defineTask<Record<string, never>>(
    'webhook-reconcile',
    async (ctx: TaskCtx<Record<string, never>>) => {
      const rows = await leaseBatch()
      if (!rows.length) return
      // refs грузим один раз на тик — справочники меняются медленно,
      // а вебхук-партия идёт по одному снимку схемы.
      const refs = await loadRefs()
      for (const row of rows) {
        await applyOne(row, refs, ctx)
      }
      ctx.log('webhook-reconcile.applied', { count: rows.length })
    },
  )
}
