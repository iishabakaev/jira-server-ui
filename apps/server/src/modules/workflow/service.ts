import {
  db,
  issues,
  statuses,
  transitions,
  type WorkflowPlanContext,
  workflowPlans,
  workflowSteps,
} from '@db'
import { and, eq, inArray } from 'drizzle-orm'
import { appError } from '../../plugins/error'
import { allReachableStatuses, planPathForIssueType, type ResolvedStep } from './planner'
import type {
  ExecuteBody,
  PlanBody,
  PlanDetail,
  PlanPreview,
  ReachableStatusesResponse,
} from './schema'

// Сервис workflow-плана.
//   plan(...)    — построение PlanPreview без записи (draft в БД создаётся
//                  на execute или явный submit; здесь возвращаем uuid+preview).
//   execute(...) — сохраняет workflow_plans+steps, переводит plan→queued,
//                  enqueue 'workflow-run' через возвращаемый callback
//                  (Elysia-роут добавляет фактический queue.enqueue).
//   get/cancel/retry — управление состоянием активного плана.

// Колбэк, который пробрасывает Elysia-роут — нам нужен Queue из apps/jobs,
// но воркеры и API изолированы. Сервер ставит задачу через pg-boss SDK сам.
export interface WorkflowEnqueuer {
  enqueueRun(planId: string): Promise<void>
}

interface PlanContext {
  user: { id: string }
}

function hasAnyRequiredField(path: ResolvedStep[]): boolean {
  for (const s of path) for (const f of s.requiredFields) if (f.required) return true
  return false
}

async function findIssueByKey(key: string) {
  const rows = await db
    .select({
      id: issues.id,
      issueTypeId: issues.issueTypeId,
      statusId: issues.statusId,
      key: issues.key,
    })
    .from(issues)
    .where(eq(issues.key, key))
    .limit(1)
  return rows[0] ?? null
}

async function loadPlanFull(planId: string) {
  const planRows = await db
    .select()
    .from(workflowPlans)
    .where(eq(workflowPlans.id, planId))
    .limit(1)
  const plan = planRows[0]
  if (!plan) return null
  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.planId, planId))
    .orderBy(workflowSteps.seq)
  return { plan, steps }
}

function toPlanDetail(
  plan: {
    id: string
    issueId: string
    userId: string
    state: PlanDetail['state']
    fromStatusId: string
    toStatusId: string
    error: string | null
    context: WorkflowPlanContext
  },
  steps: Array<{
    id: string
    seq: number
    fromStatusId: string
    toStatusId: string
    jiraTransitionId: string
    state: PlanDetail['steps'][number]['state']
    outboxKey: string | null
    error: string | null
    fieldValues: unknown
  }>,
): PlanDetail {
  return {
    id: plan.id,
    issueId: plan.issueId,
    userId: plan.userId,
    state: plan.state,
    fromStatusId: plan.fromStatusId,
    toStatusId: plan.toStatusId,
    targetStatusName: plan.context.targetStatusName ?? null,
    error: plan.error,
    finalComment: plan.context.finalComment ?? null,
    steps: steps.map((s) => ({
      id: s.id,
      seq: s.seq,
      fromStatusId: s.fromStatusId,
      toStatusId: s.toStatusId,
      jiraTransitionId: s.jiraTransitionId,
      state: s.state,
      outboxKey: s.outboxKey,
      error: s.error,
      fieldValues: (s.fieldValues ?? {}) as Record<string, unknown>,
    })),
  }
}

const ACTIVE_STATES = ['draft', 'queued', 'running', 'paused'] as const
type ActiveState = (typeof ACTIVE_STATES)[number]

export const workflowService = {
  async plan(ctx: PlanContext, body: PlanBody): Promise<PlanPreview> {
    const issue = await findIssueByKey(body.issueKey)
    if (!issue) throw appError('not_found', 'Issue not found')

    // Не строим второй план поверх уже активного — UI должен открыть существующий.
    const active = await db
      .select({ id: workflowPlans.id })
      .from(workflowPlans)
      .where(
        and(
          eq(workflowPlans.issueId, issue.id),
          inArray(workflowPlans.state, ACTIVE_STATES as readonly ActiveState[]),
        ),
      )
      .limit(1)
    if (active.length > 0) {
      throw appError('workflow_active', 'Another plan is active for this issue', {
        planId: active[0]!.id,
      })
    }

    const path = await planPathForIssueType(issue.issueTypeId, issue.statusId, body.toStatusId)
    if (path === null) {
      throw appError('no_workflow_path', 'No transition path found', {
        from: issue.statusId,
        to: body.toStatusId,
      })
    }
    if (path.length === 0) {
      // Issue уже в нужном статусе — пустой план не создаём.
      throw appError('validation_failed', 'Issue is already in the target status')
    }

    // Записываем DRAFT-план; UI потом дозаполняет requiredFields и шлёт execute.
    const planId = await db.transaction(async (tx) => {
      const created = await tx
        .insert(workflowPlans)
        .values({
          issueId: issue.id,
          userId: ctx.user.id,
          fromStatusId: issue.statusId,
          toStatusId: body.toStatusId,
          state: 'draft',
          context: {
            fieldValuesByStep: {},
            targetStatusName: path[path.length - 1]!.toStatusName,
          },
        })
        .returning({ id: workflowPlans.id })
      const id = created[0]!.id
      await tx.insert(workflowSteps).values(
        path.map((s, i) => ({
          planId: id,
          seq: i,
          fromStatusId: s.fromStatusId,
          toStatusId: s.toStatusId,
          jiraTransitionId: s.jiraTransitionId,
          fieldValues: {},
          state: 'pending' as const,
          outboxKey: `workflow:${id}:${i}`,
        })),
      )
      return id
    })

    return {
      planId,
      totalSteps: path.length,
      hasRequiredFields: hasAnyRequiredField(path),
      steps: path.map((s, i) => ({
        seq: i,
        fromStatusId: s.fromStatusId,
        toStatusId: s.toStatusId,
        fromStatusName: s.fromStatusName,
        toStatusName: s.toStatusName,
        jiraTransitionId: s.jiraTransitionId,
        transitionName: s.transitionName,
        requiredFields: s.requiredFields.map((f) => ({
          field: f.field,
          name: f.name,
          required: f.required,
          schemaType: f.schemaType,
          ...(f.allowedValues ? { allowedValues: f.allowedValues } : {}),
        })),
      })),
    }
  },

  async execute(
    ctx: PlanContext,
    enqueuer: WorkflowEnqueuer,
    body: ExecuteBody,
  ): Promise<{ planId: string; state: PlanDetail['state'] }> {
    const full = await loadPlanFull(body.planId)
    if (!full) throw appError('not_found', 'Plan not found')
    if (full.plan.userId !== ctx.user.id) {
      throw appError('forbidden', 'Plan belongs to a different user')
    }
    if (full.plan.state !== 'draft' && full.plan.state !== 'paused') {
      throw appError('workflow_active', `Plan is in state ${full.plan.state}`)
    }

    // Сохраняем field-values каждого шага: и в контексте плана, и в самих
    // step-строках — нужно воркеру для построения payload outbox-row.
    await db.transaction(async (tx) => {
      const fieldValuesByStep: Record<number, Record<string, unknown>> = {}
      for (const [seqStr, values] of Object.entries(body.fieldValuesByStep)) {
        const seq = Number.parseInt(seqStr, 10)
        if (!Number.isFinite(seq)) continue
        fieldValuesByStep[seq] = values
        await tx
          .update(workflowSteps)
          .set({ fieldValues: values })
          .where(and(eq(workflowSteps.planId, body.planId), eq(workflowSteps.seq, seq)))
      }
      await tx
        .update(workflowPlans)
        .set({
          state: 'queued',
          error: null,
          startedAt: new Date(),
          context: {
            fieldValuesByStep,
            finalComment: body.finalComment,
            targetStatusName: full.plan.context.targetStatusName,
          },
        })
        .where(eq(workflowPlans.id, body.planId))
    })

    await enqueuer.enqueueRun(body.planId)
    return { planId: body.planId, state: 'queued' }
  },

  async get(planId: string): Promise<PlanDetail | null> {
    const full = await loadPlanFull(planId)
    if (!full) return null
    return toPlanDetail(full.plan, full.steps)
  },

  async active(issueKey: string): Promise<PlanDetail | null> {
    const issue = await findIssueByKey(issueKey)
    if (!issue) throw appError('not_found', 'Issue not found')
    const rows = await db
      .select({ id: workflowPlans.id })
      .from(workflowPlans)
      .where(
        and(
          eq(workflowPlans.issueId, issue.id),
          inArray(workflowPlans.state, ACTIVE_STATES as readonly ActiveState[]),
        ),
      )
      .orderBy(workflowPlans.createdAt)
      .limit(1)
    const row = rows[0]
    return row ? this.get(row.id) : null
  },

  async cancel(ctx: PlanContext, planId: string) {
    const full = await loadPlanFull(planId)
    if (!full) throw appError('not_found', 'Plan not found')
    if (full.plan.userId !== ctx.user.id)
      throw appError('forbidden', 'Plan belongs to a different user')
    if (full.plan.state === 'done' || full.plan.state === 'cancelled') {
      throw appError('validation_failed', `Plan already in terminal state ${full.plan.state}`)
    }
    await db
      .update(workflowPlans)
      .set({ state: 'cancelled', finishedAt: new Date() })
      .where(eq(workflowPlans.id, planId))
    return { planId, state: 'cancelled' as const }
  },

  async retry(ctx: PlanContext, enqueuer: WorkflowEnqueuer, planId: string) {
    const full = await loadPlanFull(planId)
    if (!full) throw appError('not_found', 'Plan not found')
    if (full.plan.userId !== ctx.user.id)
      throw appError('forbidden', 'Plan belongs to a different user')
    if (full.plan.state !== 'paused' && full.plan.state !== 'failed') {
      throw appError('validation_failed', `Cannot retry plan in state ${full.plan.state}`)
    }
    await db
      .update(workflowPlans)
      .set({ state: 'queued', error: null })
      .where(eq(workflowPlans.id, planId))
    await enqueuer.enqueueRun(planId)
    return { planId, state: 'queued' as const }
  },

  // Все достижимые из текущего статуса issue — UI рисует их в status-dropdown:
  // one-hop коммитятся напрямую, multi-hop открывают wizard. Чтение из БД,
  // без сетевых вызовов в Jira.
  async reachable(issueKey: string): Promise<ReachableStatusesResponse> {
    const issue = await findIssueByKey(issueKey)
    if (!issue) throw appError('not_found', 'Issue not found')
    const statuses = await allReachableStatuses(issue.issueTypeId, issue.statusId)
    return { fromStatusId: issue.statusId, statuses }
  },
}

// Поддерживаем второй expose для роутов, желающих читать reachable statuses
// без полного BFS: возвращаем uuid статусов, доступных из текущего одним hop.
export async function reachableStatusesOneHop(issueTypeId: string, fromStatusId: string) {
  const rows = await db
    .select({
      toStatusId: transitions.toStatusId,
      jiraTransitionId: transitions.jiraTransitionId,
      name: transitions.name,
      toStatusName: statuses.name,
    })
    .from(transitions)
    .innerJoin(statuses, eq(statuses.id, transitions.toStatusId))
    .where(
      and(eq(transitions.issueTypeId, issueTypeId), eq(transitions.fromStatusId, fromStatusId)),
    )
  return rows
}
