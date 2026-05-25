import { db, issues, issueTypes, statuses, transitions, projects } from '@db'
import { and, eq, sql } from 'drizzle-orm'
import { createJiraClient } from '@jira/client'
import type { JiraTransition } from '@jira/client'
import type { Queue, TaskCtx } from '../lib/queue'
import { pickAnyBearer } from '../lib/credentials'
import { acquireAndRun } from '../lib/rate-limit'
import { env } from '../env'

// Прогрев кэша transitions: для каждой пары (issueType, fromStatus), реально
// встречающейся в проекте, дёргаем `/rest/api/2/issue/{key}/transitions?expand=transitions.fields`
// на одном репрезентативном issue и сохраняем разрешённые переходы в кэш.
// Используется планировщиком многошаговых переходов (см. 14-workflow-engine.md).

export interface RefreshWorkflowPayload {
  projectId: string
}

interface SampleRow {
  issueKey: string
  issueTypeId: string
  fromStatusId: string
}

// Возвращает по одному issue-key на каждую (issueType, status) пару, реально
// встречающуюся в проекте. Это даёт минимальное покрытие кэша без обхода
// всего хранилища.
async function collectSamples(projectUuid: string): Promise<SampleRow[]> {
  const result = await db.execute<{ key: string; issue_type_id: string; status_id: string }>(sql`
    select distinct on (i.issue_type_id, i.status_id)
           i.key as key,
           i.issue_type_id::text as issue_type_id,
           i.status_id::text   as status_id
      from issues i
     where i.project_id = ${projectUuid}::uuid
       and i.deleted_at is null
     order by i.issue_type_id, i.status_id, i.jira_updated_at desc
     limit 500
  `)
  const rows =
    (result as unknown as { rows: Array<{ key: string; issue_type_id: string; status_id: string }> })
      .rows ?? (result as unknown as Array<{ key: string; issue_type_id: string; status_id: string }>)
  return rows.map((r) => ({
    issueKey: r.key,
    issueTypeId: r.issue_type_id,
    fromStatusId: r.status_id,
  }))
}

async function statusUuidByJiraId(jiraId: string): Promise<string | null> {
  const r = (
    await db.select({ id: statuses.id }).from(statuses).where(eq(statuses.jiraId, jiraId)).limit(1)
  )[0]
  return r?.id ?? null
}

async function upsertTransition(
  issueTypeId: string,
  fromStatusId: string,
  toStatusId: string,
  t: JiraTransition,
) {
  const requiredFields = t.fields
    ? Object.entries(t.fields).map(([key, f]) => ({
        field: key,
        name: f.name,
        required: f.required,
        schemaType: f.schema?.type ?? 'any',
        allowedValues: f.allowedValues,
      }))
    : []
  await db
    .insert(transitions)
    .values({
      issueTypeId,
      fromStatusId,
      toStatusId,
      jiraTransitionId: t.id,
      name: t.name,
      requiredFields,
      syncedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [transitions.issueTypeId, transitions.fromStatusId, transitions.toStatusId],
      set: {
        jiraTransitionId: t.id,
        name: t.name,
        requiredFields,
        syncedAt: new Date(),
      },
    })
}

export function registerRefreshWorkflow(queue: Queue) {
  queue.defineTask<RefreshWorkflowPayload>(
    'refresh-workflow',
    async (ctx: TaskCtx<RefreshWorkflowPayload>) => {
      const { projectId } = ctx.data
      if (!env.JIRA_BASE_URL) return
      const project = (
        await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
      )[0]
      if (!project) return
      const creds = await pickAnyBearer()
      if (!creds) {
        ctx.log('refresh-workflow.no-credentials', { projectId })
        return
      }

      const jira = createJiraClient({
        baseUrl: env.JIRA_BASE_URL,
        bearer: creds.bearer,
        timeoutMs: 30_000,
      })

      const samples = await collectSamples(projectId)
      if (!samples.length) {
        ctx.log('refresh-workflow.no-samples', { projectId })
        return
      }

      let upserts = 0
      let calls = 0
      for (const s of samples) {
        try {
          const resp = await acquireAndRun(
            { userId: creds.userId, instance: env.JIRA_BASE_URL },
            () => jira.getTransitions(s.issueKey),
          )
          calls += 1
          for (const t of resp.transitions ?? []) {
            const toUuid = await statusUuidByJiraId(t.to.id)
            if (!toUuid) continue
            await upsertTransition(s.issueTypeId, s.fromStatusId, toUuid, t)
            upserts += 1
          }
        } catch (err) {
          ctx.log('refresh-workflow.sample-error', {
            key: s.issueKey,
            message: err instanceof Error ? err.message : String(err),
          })
        }
      }

      ctx.log('refresh-workflow.done', {
        projectId,
        samples: samples.length,
        calls,
        upserts,
      })
    },
  )
}
