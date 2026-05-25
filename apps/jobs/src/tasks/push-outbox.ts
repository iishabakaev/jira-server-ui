import { comments, db, issues, type OutboxEvent, outboxEvents } from '@db'
import { createJiraClient, JiraHttpError } from '@jira/index'
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { env } from '../env'
import { getBearerForUser, markNeedsReattach } from '../lib/credentials'
import type { Queue, TaskCtx } from '../lib/queue'
import { acquireAndRun } from '../lib/rate-limit'

// Дренаж outbox → Jira REST. Жизненный цикл строки:
//   pending → in_flight → done | error(retry) | dead
//
// Стратегия:
//  - Worker запускается каждые N секунд (scheduled), забирает до BATCH строк
//    через SELECT ... FOR UPDATE SKIP LOCKED — это безопасно при N экземплярах.
//  - На каждой строке держим in-flight локвилл; в случае краша после
//    locked_until истекает, и строку подберёт другой воркер.
//  - Реализация per-target serialization: при выборке исключаем строки,
//    у которых для этого же (targetKind, targetId) есть другая in_flight-строка.
//  - На retryable-ошибках растим attempts и переводим в pending с backoff.
//  - На non-retryable (401/403 — PAT нужно переподключить, 400 — bad payload):
//    помечаем dead и issue.sync_state='error'.

const BATCH_SIZE = 25
const MAX_ATTEMPTS = 10
const LOCK_TTL_MS = 30_000

export interface PushOutboxPayload {
  // Опциональный singleton-trigger; без него worker сам периодически
  // снимает партии. Поле нужно, чтобы /api/sync/outbox/:id/retry мог
  // указать конкретный outbox-id (на M5 пока не реализовано в схеме).
  outboxId?: number
}

interface IssueUpdatePayload {
  keyOrId: string
  patch: Record<string, unknown>
}
interface IssueTransitionPayload {
  keyOrId: string
  jiraTransitionId: string
  fields?: Record<string, unknown>
}
interface IssueRankPayload {
  orderingRank: string | null
  toStatusId: string | null
}
interface CommentCreatePayload {
  issueKey: string
  issueId: string
  body: unknown
}
interface CommentUpdatePayload {
  issueKey: string
  issueId: string
  jiraCommentId: string | null
  body: unknown
}
interface CommentDeletePayload {
  issueKey: string
  issueId: string
  jiraCommentId: string | null
}
interface IssueCreatePayload {
  draftKey: string
  projectKey: string
  issueTypeId: string
  issueTypeName: string
  summary: string
  parentKey: string | null
  epicKey: string | null
  assigneeId: string | null
  priorityId: string | null
  labels: string[]
}

// Конвертация ADF → plain text для Jira Server REST v2: API ожидает строку
// в `body`, а не структурированный документ. Сейчас ADF, который пишет
// сервер, простой (только paragraph→text), поэтому отдаём текстовое
// представление; полный ADF round-trip приедет с TipTap+v3 эндпойнтом.
function adfToCommentText(body: unknown): string {
  if (typeof body === 'string') return body
  if (!body || typeof body !== 'object') return ''
  const doc = body as { content?: unknown }
  if (!Array.isArray(doc.content)) return ''
  const lines: string[] = []
  for (const block of doc.content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { content?: unknown }
    if (!Array.isArray(b.content)) {
      lines.push('')
      continue
    }
    const parts: string[] = []
    for (const inline of b.content) {
      if (inline && typeof inline === 'object' && 'text' in inline) {
        const t = (inline as { text?: unknown }).text
        if (typeof t === 'string') parts.push(t)
      }
    }
    lines.push(parts.join(''))
  }
  return lines.join('\n\n').trim()
}

function backoffMs(attempts: number): number {
  // expo backoff с jitter: 2s, 4s, 8s, 16s, ..., capped 5 минут.
  const base = Math.min(2_000 * 2 ** attempts, 300_000)
  return base + Math.floor(Math.random() * 1_000)
}

function isNonRetryable(err: unknown): boolean {
  if (err instanceof JiraHttpError) {
    if (err.status === 400) return true
    if (err.status === 401 || err.status === 403) return true
    if (err.status === 404) return true
  }
  return false
}

async function leaseBatch(workerId: string): Promise<OutboxEvent[]> {
  // Один UPDATE с RETURNING — атомарно берём lease на N строк, исключая
  // те, у которых уже есть in_flight для того же таргета.
  const result = await db.execute<OutboxEvent>(sql`
    with candidates as (
      select e.id
      from outbox_events e
      where e.state = 'pending'
        and (e.locked_until is null or e.locked_until < now())
        and not exists (
          select 1 from outbox_events o
          where o.target_kind = e.target_kind
            and o.target_id   = e.target_id
            and o.state       = 'in_flight'
            and o.id          <> e.id
        )
      order by e.id
      limit ${BATCH_SIZE}
      for update skip locked
    )
    update outbox_events
       set state = 'in_flight',
           locked_by = ${workerId},
           locked_until = now() + interval '30 seconds',
           updated_at = now()
     where id in (select id from candidates)
    returning *
  `)
  return (result as unknown as { rows: OutboxEvent[] }).rows ?? (result as unknown as OutboxEvent[])
}

async function finishOk(row: OutboxEvent) {
  await db
    .update(outboxEvents)
    .set({ state: 'done', lockedBy: null, lockedUntil: null, updatedAt: new Date() })
    .where(eq(outboxEvents.id, row.id))
}

async function finishDead(row: OutboxEvent, message: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(outboxEvents)
      .set({
        state: 'dead',
        lastError: message,
        lockedBy: null,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(outboxEvents.id, row.id))
    if (row.targetKind === 'issue') {
      await tx
        .update(issues)
        .set({ syncState: 'error', syncError: message, updatedAt: new Date() })
        .where(eq(issues.id, row.targetId))
    } else if (row.targetKind === 'comment') {
      // Поднимаем sync_state на самой строке комментария (если она ещё жива).
      // Для удалённых комментариев — no-op; конфликты-таблицу заведём в M9.
      await tx
        .update(comments)
        .set({ syncState: 'error', updatedAt: new Date() })
        .where(eq(comments.id, row.targetId))
    }
  })
}

async function finishRetry(row: OutboxEvent, message: string) {
  const nextAttempts = row.attempts + 1
  if (nextAttempts >= MAX_ATTEMPTS) {
    await finishDead(row, message)
    return
  }
  const delay = backoffMs(nextAttempts)
  await db
    .update(outboxEvents)
    .set({
      state: 'pending',
      attempts: nextAttempts,
      lastError: message,
      lockedBy: null,
      lockedUntil: new Date(Date.now() + delay),
      updatedAt: new Date(),
    })
    .where(eq(outboxEvents.id, row.id))
}

async function reconcileIssueSync(targetId: string) {
  // На M5 после успеха пушим issue в 'synced'. Полное reconcile-вычитывание
  // (Jira updated → upsert) делает webhook/incremental-sync — этот worker
  // не блокируется на дополнительном GET.
  await db
    .update(issues)
    .set({ syncState: 'synced', syncError: null, syncedAt: new Date(), updatedAt: new Date() })
    .where(eq(issues.id, targetId))
}

async function reconcileCommentSync(commentId: string, jiraCommentId?: string) {
  // После успешного push'а комментария проставляем jira_id (если был выдан
  // Jira при создании) и переводим строку в 'synced'.
  const update: { syncState: 'synced'; updatedAt: Date; jiraId?: string } = {
    syncState: 'synced',
    updatedAt: new Date(),
  }
  if (jiraCommentId) update.jiraId = jiraCommentId
  await db.update(comments).set(update).where(eq(comments.id, commentId))
}

async function reconcileIssueCreate(targetId: string, real: { id: string; key: string }) {
  // Подменяем DRAFT-ключ + local:<uuid> на реальные значения из ответа Jira.
  // jira_updated_at трогаем здесь же — webhook/incremental подтянет
  // настоящие тайминги при ближайшем проходе.
  await db
    .update(issues)
    .set({
      jiraId: real.id,
      key: real.key,
      syncState: 'synced',
      syncError: null,
      syncedAt: new Date(),
      updatedAt: new Date(),
      jiraUpdatedAt: new Date(),
    })
    .where(eq(issues.id, targetId))
}

async function dispatchOne(row: OutboxEvent): Promise<void> {
  if (!env.JIRA_BASE_URL) {
    await finishRetry(row, 'JIRA_BASE_URL not configured')
    return
  }
  const bearer = await getBearerForUser(row.userId)
  if (!bearer) {
    await finishDead(row, 'No usable PAT for user')
    return
  }
  const jira = createJiraClient({
    baseUrl: env.JIRA_BASE_URL,
    bearer,
    timeoutMs: 30_000,
  })

  try {
    await acquireAndRun({ userId: row.userId, instance: env.JIRA_BASE_URL }, async () => {
      switch (row.kind) {
        case 'issue.update': {
          const p = row.payload as unknown as IssueUpdatePayload
          await jira.updateIssue(p.keyOrId, p.patch as Record<string, unknown>)
          break
        }
        case 'issue.transition': {
          const p = row.payload as unknown as IssueTransitionPayload
          await jira.transitionIssue(p.keyOrId, {
            transitionId: p.jiraTransitionId,
            fields: p.fields,
          })
          break
        }
        case 'issue.rank':
        case 'issue.rank-and-transition': {
          const p = row.payload as unknown as IssueRankPayload
          // На M5 пишем rank как обновление custom-поля: в Jira любой
          // строковый rank переедет в нужный bucket после первого
          // refresh-sync. Это безопаснее, чем дергать /rest/agile/1.0/rank
          // без knowledge о bucket-id (см. docs/specs/13-jira-reality.md).
          const rankRows = await db
            .select({ key: issues.key, projectId: issues.projectId })
            .from(issues)
            .where(eq(issues.id, row.targetId))
            .limit(1)
          const target = rankRows[0]
          if (!target) throw new Error('Target issue vanished')
          const fields: Record<string, unknown> = {}
          if (p.orderingRank != null) {
            // customfield идентификатор резолвится в board.config —
            // см. boards-схему. Здесь pragmatic-фолбэк: пишем в
            // virtually-promoted 'Rank' alias; backfill-sync поправит.
            fields.customfield_11582 = p.orderingRank
          }
          if (Object.keys(fields).length) {
            await jira.updateIssue(target.key, fields)
          }
          // Если в той же DnD-операции был переход — кладём отдельный
          // outbox-row через workflow planner; здесь только ranking.
          break
        }
        case 'issue.create': {
          const p = row.payload as unknown as IssueCreatePayload
          // POST /issue: имена полей соответствуют Jira REST v2.
          // parent / customfield_<epic_link> / labels / assignee.name —
          // нормализация custom-полей делает refresh-metadata; на MVP
          // используем стандартные имена и пропускаем то, что null.
          const fields: Record<string, unknown> = {
            project: { key: p.projectKey },
            issuetype: { id: p.issueTypeId },
            summary: p.summary,
          }
          if (p.parentKey) fields.parent = { key: p.parentKey }
          if (p.epicKey) {
            // Стандартный Epic Link customfield в Jira Server; реальный
            // id уточняется через refresh-metadata. На MVP — заглушка.
            fields.customfield_10376 = p.epicKey
          }
          if (p.assigneeId) fields.assignee = { name: p.assigneeId }
          if (p.priorityId) fields.priority = { id: p.priorityId }
          if (p.labels.length) fields.labels = p.labels
          const created = await jira.createIssue({ fields })
          await reconcileIssueCreate(row.targetId, { id: created.id, key: created.key })
          break
        }
        case 'comment.create': {
          const p = row.payload as unknown as CommentCreatePayload
          // Берём актуальный key из БД: если выше по очереди issue.create уже
          // отработала, ключ может быть real, а не DRAFT. Иначе откладываем
          // на retry — issue.create ещё не доехала до Jira.
          const issueRows = await db
            .select({ key: issues.key, jiraId: issues.jiraId })
            .from(issues)
            .where(eq(issues.id, p.issueId))
            .limit(1)
          const issue = issueRows[0]
          if (!issue) throw new Error('Target issue vanished')
          if (issue.jiraId.startsWith('local:')) {
            throw new Error('comment.create awaiting issue.create')
          }
          const text = adfToCommentText(p.body)
          const created = await jira.addComment(issue.key, { body: text })
          await reconcileCommentSync(row.targetId, created.id)
          break
        }
        case 'comment.update': {
          const p = row.payload as unknown as CommentUpdatePayload
          // jiraCommentId, который писал сервер, мог быть null — комментарий
          // создавался локально и его create ещё не доехала. Перечитываем
          // строку из БД на момент dispatch'а: если jira_id уже проставлен —
          // используем его; иначе retry.
          const fresh = await db
            .select({ jiraId: comments.jiraId })
            .from(comments)
            .where(eq(comments.id, row.targetId))
            .limit(1)
          const jiraCommentId = fresh[0]?.jiraId ?? p.jiraCommentId
          if (!jiraCommentId) {
            throw new Error('comment.update awaiting jiraCommentId')
          }
          const text = adfToCommentText(p.body)
          await jira.updateComment(p.issueKey, jiraCommentId, { body: text })
          await reconcileCommentSync(row.targetId)
          break
        }
        case 'comment.delete': {
          const p = row.payload as unknown as CommentDeletePayload
          // Строка comments уже удалена сервером; jiraCommentId берём только
          // из payload — fresh-чтение бессмысленно.
          if (!p.jiraCommentId) {
            // Удаление локального ещё не синхронизированного комментария —
            // в Jira его и нет, удалять нечего, считаем done.
            break
          }
          await jira.deleteComment(p.issueKey, p.jiraCommentId)
          break
        }
        default: {
          throw new Error(`Unknown outbox kind: ${row.kind}`)
        }
      }
    })
    await finishOk(row)
    if (row.targetKind === 'issue') await reconcileIssueSync(row.targetId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof JiraHttpError && (err.status === 401 || err.status === 403)) {
      await markNeedsReattach(row.userId)
    }
    if (isNonRetryable(err)) {
      await finishDead(row, message)
    } else {
      await finishRetry(row, message)
    }
  }
}

async function processBatch(workerId: string): Promise<number> {
  const rows = await leaseBatch(workerId)
  if (!rows.length) return 0
  // Не используем Promise.all: rate-limit и так держит верхнюю границу,
  // зато последовательная обработка проще для трассировки.
  for (const row of rows) {
    await dispatchOne(row)
  }
  return rows.length
}

export function registerPushOutbox(queue: Queue) {
  // Внешний триггер: pg-boss scheduled job каждые 2 секунды дёргает batch.
  // Внутри обработчика — основной цикл, который перевыдаёт rows из таблицы.
  queue.defineTask<PushOutboxPayload>('push-outbox', async (ctx: TaskCtx<PushOutboxPayload>) => {
    const workerId = `push-outbox:${process.pid}:${ctx.id}`
    const n = await processBatch(workerId)
    if (n > 0) ctx.log('push-outbox.batch', { processed: n })
  })
}

// reschedule helper — оставляем доступным для admin-эндпойнтов.
export async function pendingCount(): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outboxEvents)
    .where(
      or(
        eq(outboxEvents.state, 'pending'),
        and(eq(outboxEvents.state, 'in_flight'), isNull(outboxEvents.lockedUntil)),
        and(eq(outboxEvents.state, 'in_flight'), lte(outboxEvents.lockedUntil, new Date())),
      )!,
    )
  return rows[0]?.n ?? 0
}
