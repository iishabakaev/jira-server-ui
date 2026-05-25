import { db, projects, syncCursor } from '@db'
import { eq, sql } from 'drizzle-orm'
import { createJiraClient, formatJqlDate, JiraHttpError } from '@jira/client'
import { buildFieldsList } from '@jira/field-sets'
import type { Queue, TaskCtx } from '../lib/queue'
import { getBearerForUser, pickAnyBearer, markNeedsReattach } from '../lib/credentials'
import { acquireAndRun } from '../lib/rate-limit'
import { env } from '../env'
import { loadRefs, normalizeIssue, upsertIssue } from '../lib/normalize-issue'

// Полный бэкфилл проекта. Контракт: { projectId, sinceISO?, untilISO?, requestedBy }.
// Идемпотентен (resume по startAt из sync_cursor.last_run_id).
//
// На каждой странице:
//   1. Получаем 100 issues через /rest/api/2/search с явным fields=
//   2. Прогоняем нормализатор (см. lib/normalize-issue.ts)
//   3. Upsert по jira_id; out-of-order строки игнорируются (см. логика
//      сравнения jira_updated_at внутри upsertIssue).
//
// После завершения цикла обновляем sync_cursor.last_full_sync_at + last_updated_at,
// чтобы incremental-sync с этого момента подбирал только дельты.

const PAGE_SIZE = 100
const MAX_PAGES = 1_000 // safety-нор — 100k issues на один прогон.

export interface FullSyncPayload {
  projectId: string
  sinceISO?: string
  untilISO?: string
  requestedBy?: string
}

function escapeJqlString(v: string): string {
  // В Jira-JQL спец-символы экранируются обратной косой.
  return v.replace(/[\\"]/g, (m) => `\\${m}`)
}

function buildJql(projectKey: string, since?: Date, until?: Date): string {
  const parts: string[] = [`project = "${escapeJqlString(projectKey)}"`]
  if (since) parts.push(`updated >= "${formatJqlDate(since)}"`)
  if (until) parts.push(`updated <= "${formatJqlDate(until)}"`)
  return `${parts.join(' AND ')} ORDER BY updated ASC, key ASC`
}

function defaultSince(): Date {
  const days = env.SYNC_DEFAULT_WINDOW_DAYS
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export function registerFullSync(queue: Queue) {
  queue.defineTask<FullSyncPayload>('full-sync', async (ctx: TaskCtx<FullSyncPayload>) => {
    const { projectId } = ctx.data
    if (!env.JIRA_BASE_URL) {
      ctx.log('full-sync.no-jira-base-url')
      return
    }
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1)
    const project = projectRows[0]
    if (!project) {
      ctx.log('full-sync.project-not-found', { projectId })
      return
    }

    const bearerInfo = ctx.data.requestedBy
      ? { userId: ctx.data.requestedBy, bearer: await getBearerForUser(ctx.data.requestedBy) }
      : await pickAnyBearer()
    const bearer = bearerInfo?.bearer ?? null
    if (!bearerInfo || !bearer) {
      ctx.log('full-sync.no-credentials', { projectId })
      return
    }

    const jira = createJiraClient({
      baseUrl: env.JIRA_BASE_URL,
      bearer,
      timeoutMs: 60_000,
    })

    const since = ctx.data.sinceISO ? new Date(ctx.data.sinceISO) : defaultSince()
    const until = ctx.data.untilISO ? new Date(ctx.data.untilISO) : undefined
    const jql = buildJql(project.key, since, until)
    const fields = buildFieldsList(project, 'scan')

    // Курсор резюма: храним числовой startAt в last_run_id (форматом
    // "full:<n>", чтобы отличить от incremental-марки).
    const existingCursor = await db
      .select()
      .from(syncCursor)
      .where(eq(syncCursor.projectId, projectId))
      .limit(1)
    const resumeMatch = existingCursor[0]?.lastRunId?.match(/^full:(\d+)$/)
    const resumeRaw = resumeMatch?.[1]
    let startAt = resumeRaw ? Number.parseInt(resumeRaw, 10) : 0
    if (!Number.isFinite(startAt) || startAt < 0) startAt = 0

    let total = 0
    let processed = 0
    let lastUpdatedAt: Date | null = existingCursor[0]?.lastUpdatedAt ?? null

    const refs = await loadRefs()

    for (let page = 0; page < MAX_PAGES; page += 1) {
      try {
        const resp = await acquireAndRun(
          { userId: bearerInfo.userId, instance: env.JIRA_BASE_URL },
          () =>
            jira.search(jql, {
              fields,
              startAt,
              maxResults: PAGE_SIZE,
            }),
        )
        total = resp.total
        if (!resp.issues || resp.issues.length === 0) break
        for (const raw of resp.issues) {
          const n = normalizeIssue(raw, refs)
          if (!n) {
            ctx.log('full-sync.skip-unresolved-refs', { key: raw.key })
            continue
          }
          await upsertIssue(n)
          processed += 1
          if (!lastUpdatedAt || n.jiraUpdatedAt > lastUpdatedAt) {
            lastUpdatedAt = n.jiraUpdatedAt
          }
        }
        startAt += resp.issues.length

        // Чекпойнт после каждой страницы.
        await db
          .insert(syncCursor)
          .values({
            projectId,
            lastUpdatedAt,
            lastRunId: `full:${startAt}`,
          })
          .onConflictDoUpdate({
            target: syncCursor.projectId,
            set: {
              lastUpdatedAt,
              lastRunId: `full:${startAt}`,
            },
          })

        if (startAt >= resp.total) break
      } catch (err) {
        if (err instanceof JiraHttpError && (err.status === 401 || err.status === 403)) {
          await markNeedsReattach(bearerInfo.userId)
        }
        ctx.log('full-sync.error', {
          message: err instanceof Error ? err.message : String(err),
          startAt,
        })
        throw err
      }
    }

    // Финальный апдейт курсора: завершаем full-run и фиксируем last_full_sync_at.
    await db
      .update(syncCursor)
      .set({
        lastFullSyncAt: new Date(),
        lastRunId: sql`null`,
      })
      .where(eq(syncCursor.projectId, projectId))

    ctx.log('full-sync.done', { projectId, total, processed })
  })
}
