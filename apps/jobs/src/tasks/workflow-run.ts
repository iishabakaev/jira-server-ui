import {
  db,
  issues,
  outboxEvents,
  workflowPlans,
  workflowSteps,
} from '@db'
import { and, eq } from 'drizzle-orm'
import type { Queue, TaskCtx } from '../lib/queue'

// Прогон workflow_plan: на каждом шаге enqueue в outbox с детерминированным
// idempotency-ключом 'workflow:<planId>:<seq>' и ожидание terminal-состояния
// этой строки. push-outbox делает фактический звонок в Jira.
//
// Лог жизненного цикла:
//   plan.state: queued → running → done | paused | failed
//   step.state: pending → running → done | failed
//
// При паузе плана выбрасывать exception не нужно — pg-boss не должен
// ретраить такую задачу; план остаётся в paused, retry-эндпойнт его
// перепланирует.

export interface WorkflowRunPayload {
  planId: string
}

const POLL_INTERVAL_MS = 500
const STEP_TIMEOUT_MS = 5 * 60_000

async function loadPlan(planId: string) {
  const rows = await db
    .select()
    .from(workflowPlans)
    .where(eq(workflowPlans.id, planId))
    .limit(1)
  return rows[0] ?? null
}

async function loadSteps(planId: string) {
  return db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.planId, planId))
    .orderBy(workflowSteps.seq)
}

async function enqueueStepOutbox(args: {
  plan: { id: string; userId: string; issueId: string }
  step: { id: string; seq: number; jiraTransitionId: string; fieldValues: unknown }
  issueKey: string
}) {
  await db.transaction(async (tx) => {
    await tx
      .update(issues)
      .set({ syncState: 'pushing', updatedAt: new Date() })
      .where(eq(issues.id, args.plan.issueId))
    const idem = `workflow:${args.plan.id}:${args.step.seq}`
    await tx
      .insert(outboxEvents)
      .values({
        idempotencyKey: idem,
        userId: args.plan.userId,
        kind: 'issue.transition',
        targetKind: 'issue',
        targetId: args.plan.issueId,
        payload: {
          keyOrId: args.issueKey,
          jiraTransitionId: args.step.jiraTransitionId,
          fields: (args.step.fieldValues ?? {}) as Record<string, unknown>,
        },
      })
      .onConflictDoNothing({ target: outboxEvents.idempotencyKey })
    await tx
      .update(workflowSteps)
      .set({
        state: 'running',
        outboxKey: idem,
        startedAt: new Date(),
      })
      .where(eq(workflowSteps.id, args.step.id))
  })
}

async function waitForOutbox(idempotencyKey: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = await db
      .select({ state: outboxEvents.state, lastError: outboxEvents.lastError })
      .from(outboxEvents)
      .where(eq(outboxEvents.idempotencyKey, idempotencyKey))
      .limit(1)
    const row = rows[0]
    if (row) {
      if (row.state === 'done') return { ok: true as const }
      if (row.state === 'dead' || row.state === 'error') {
        return { ok: false as const, error: row.lastError ?? 'unknown error' }
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
  return { ok: false as const, error: 'timeout waiting for outbox' }
}

export function registerWorkflowRun(queue: Queue) {
  queue.defineTask<WorkflowRunPayload>('workflow-run', async (ctx: TaskCtx<WorkflowRunPayload>) => {
    const planId = ctx.data.planId
    const plan = await loadPlan(planId)
    if (!plan) {
      ctx.log('workflow-run.no-plan', { planId })
      return
    }
    if (plan.state === 'cancelled' || plan.state === 'done') {
      ctx.log('workflow-run.terminal', { planId, state: plan.state })
      return
    }

    await db
      .update(workflowPlans)
      .set({ state: 'running', startedAt: plan.startedAt ?? new Date(), error: null })
      .where(eq(workflowPlans.id, planId))

    const issueRows = await db
      .select({ key: issues.key })
      .from(issues)
      .where(eq(issues.id, plan.issueId))
      .limit(1)
    const issueKey = issueRows[0]?.key ?? plan.issueId

    const steps = await loadSteps(planId)
    for (const step of steps) {
      // На retry уже законченные шаги пропускаем.
      if (step.state === 'done' || step.state === 'skipped') continue

      // Re-fetch плана: если внешний cancel пришёл между шагами — выходим
      // без enqueue новых outbox.
      const fresh = await loadPlan(planId)
      if (!fresh || fresh.state === 'cancelled') {
        ctx.log('workflow-run.cancelled', { planId })
        return
      }

      await enqueueStepOutbox({
        plan: { id: plan.id, userId: plan.userId, issueId: plan.issueId },
        step: {
          id: step.id,
          seq: step.seq,
          jiraTransitionId: step.jiraTransitionId,
          fieldValues: step.fieldValues,
        },
        issueKey,
      })

      const outcome = await waitForOutbox(
        `workflow:${plan.id}:${step.seq}`,
        STEP_TIMEOUT_MS,
      )

      if (outcome.ok) {
        await db
          .update(workflowSteps)
          .set({ state: 'done', finishedAt: new Date() })
          .where(eq(workflowSteps.id, step.id))
        ctx.log('workflow-run.step.done', { planId, seq: step.seq })
      } else {
        await db.transaction(async (tx) => {
          await tx
            .update(workflowSteps)
            .set({ state: 'failed', error: outcome.error, finishedAt: new Date() })
            .where(eq(workflowSteps.id, step.id))
          await tx
            .update(workflowPlans)
            .set({ state: 'paused', error: outcome.error })
            .where(eq(workflowPlans.id, plan.id))
          await tx
            .update(issues)
            .set({ syncState: 'error', syncError: outcome.error, updatedAt: new Date() })
            .where(eq(issues.id, plan.issueId))
        })
        ctx.log('workflow-run.step.failed', { planId, seq: step.seq, error: outcome.error })
        return
      }
    }

    // Все шаги завершены успешно — переводим plan в done и issue в synced.
    await db.transaction(async (tx) => {
      await tx
        .update(workflowPlans)
        .set({ state: 'done', finishedAt: new Date() })
        .where(eq(workflowPlans.id, plan.id))
      await tx
        .update(issues)
        .set({ syncState: 'synced', syncError: null, syncedAt: new Date() })
        .where(and(eq(issues.id, plan.issueId), eq(issues.syncState, 'pushing')))
    })
    ctx.log('workflow-run.done', { planId })
  })
}
