import { db, projects, syncCursor } from '@db'
import { eq } from 'drizzle-orm'
import { createJiraClient, formatJqlDate, JiraHttpError } from '@jira/client'
import { buildFieldsList } from '@jira/field-sets'
import type { Queue, TaskCtx } from '../lib/queue'
import { pickAnyBearer, markNeedsReattach } from '../lib/credentials'
import { acquireAndRun } from '../lib/rate-limit'
import { env } from '../env'
import { loadRefs, normalizeIssue, upsertIssue } from '../lib/normalize-issue'

// Поллинг-страховка поверх вебхуков. Запускается scheduled-задачей каждые
// 2 минуты. Контракт: { projectId }.
//
// JQL: project=KEY AND updated > <last_updated_at>; всё, что прошло сквозь
// webhook без проблем, уже лежит у нас в БД и нормализатор-апсёрт его
// пропустит по out-of-order-проверке. Здесь страхуемся именно от пропавших
// вебхуков.

const PAGE_SIZE = 100
const HARD_LIMIT = 500 // 200 + запас на одно срабатывание; больше — full-sync.

export interface IncrementalSyncPayload {
  projectId: string
}

function escapeJqlString(v: string): string {
  return v.replace(/[\\"]/g, (m) => `\\${m}`)
}

function buildJql(projectKey: string, since: Date): string {
  // updated >= <since>: spec явно требует ≥, а не строгое >.
  // Jira `updated` хранится с точностью до секунды; со строгим > мы могли бы
  // пропустить апдейт, выпавший в ту же секунду, что и сохранённый курсор.
  // JQL требует формат "yyyy-MM-dd HH:mm" (минутная точность); ISO-8601 даёт 400.
  return `project = "${escapeJqlString(projectKey)}" AND updated >= "${formatJqlDate(
    since,
  )}" ORDER BY updated ASC, key ASC`
}

export function registerIncrementalSync(queue: Queue) {
  queue.defineTask<IncrementalSyncPayload>(
    'incremental-sync',
    async (ctx: TaskCtx<IncrementalSyncPayload>) => {
      const { projectId } = ctx.data
      if (!env.JIRA_BASE_URL) return

      const projectRows = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1)
      const project = projectRows[0]
      if (!project) return

      const creds = await pickAnyBearer()
      if (!creds) {
        ctx.log('incremental-sync.no-credentials', { projectId })
        return
      }

      const cursorRows = await db
        .select()
        .from(syncCursor)
        .where(eq(syncCursor.projectId, projectId))
        .limit(1)
      // Если курсора нет вообще — incremental прыгает на окно по умолчанию
      // от now-1d (full-sync должен был его проинициализировать; срабатываем
      // на свежем проекте без полного бэкфилла).
      const since =
        cursorRows[0]?.lastUpdatedAt ??
        new Date(Date.now() - 24 * 60 * 60 * 1000)

      const jira = createJiraClient({
        baseUrl: env.JIRA_BASE_URL,
        bearer: creds.bearer,
        timeoutMs: 30_000,
      })
      const jql = buildJql(project.key, since)
      const fields = buildFieldsList(project, 'scan')
      const refs = await loadRefs()

      let startAt = 0
      let processed = 0
      let lastUpdatedAt: Date | null = since

      try {
        for (let page = 0; page < Math.ceil(HARD_LIMIT / PAGE_SIZE); page += 1) {
          const resp = await acquireAndRun(
            { userId: creds.userId, instance: env.JIRA_BASE_URL },
            () => jira.search(jql, { fields, startAt, maxResults: PAGE_SIZE }),
          )
          if (!resp.issues?.length) break
          for (const raw of resp.issues) {
            const n = normalizeIssue(raw, refs)
            if (!n) continue
            const ok = await upsertIssue(n)
            if (ok) processed += 1
            if (!lastUpdatedAt || n.jiraUpdatedAt > lastUpdatedAt) {
              lastUpdatedAt = n.jiraUpdatedAt
            }
          }
          startAt += resp.issues.length
          if (startAt >= resp.total) break
          if (startAt >= HARD_LIMIT) {
            // Если выгребли больше HARD_LIMIT — это аномалия (длинный простой
            // вебхуков). Дальше пусть full-sync разбирается.
            ctx.log('incremental-sync.hard-limit', { projectId, startAt })
            break
          }
        }

        // Курсор пишем безусловно: даже если за тик никто не обновился,
        // фиксируем «мы дошли до now» — иначе при тихих проектах JQL
        // будет каждый раз перепроверять одно и то же окно.
        const cursorWrite = lastUpdatedAt ?? since
        await db
          .insert(syncCursor)
          .values({ projectId, lastUpdatedAt: cursorWrite })
          .onConflictDoUpdate({
            target: syncCursor.projectId,
            set: { lastUpdatedAt: cursorWrite },
          })
        if (processed > 0) {
          ctx.log('incremental-sync.applied', { projectId, processed })
        }
      } catch (err) {
        if (err instanceof JiraHttpError && (err.status === 401 || err.status === 403)) {
          await markNeedsReattach(creds.userId)
        }
        throw err
      }
    },
  )
}
