import { api } from '../../lib/eden'
import type {
  ExecuteInput,
  PlanDetail,
  PlanPreview,
  PlanState,
  ReachableStatusesResponse,
} from './types'

// Тонкая Eden-обёртка для workflow-планера. Единственная точка, через
// которую фичевые компоненты говорят с сервером (см. .agents/PATTERNS.md).

export class WorkflowPlannerError extends Error {
  constructor(
    public code: string,
    message: string,
    public meta?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WorkflowPlannerError'
  }
}

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) {
    const err = res.error as {
      value?: { error?: { code?: string; message?: string; meta?: Record<string, unknown> } }
    }
    const inner = err.value?.error
    throw new WorkflowPlannerError(
      inner?.code ?? 'unknown',
      inner?.message ?? 'Request failed',
      inner?.meta,
    )
  }
  if (res.data === null) throw new WorkflowPlannerError('unknown', 'Empty response')
  return res.data
}

// POST /api/workflow/plan — строит draft-план без enqueue. Возвращает превью
// шагов и обязательных полей. На 409 (workflow_active) сервер кладёт в meta
// активный planId — UI открывает существующий вместо нового.
export async function planTransition(issueKey: string, toStatusId: string): Promise<PlanPreview> {
  const res = await api.api.workflow.plan.post({ issueKey, toStatusId })
  return unwrap(res) as PlanPreview
}

// POST /api/workflow/execute — переводит план draft|paused → queued и
// enqueue воркера. UI после этого подписывается на /plans/:id polling
// до достижения терминального состояния.
export async function executePlan(
  input: ExecuteInput,
): Promise<{ planId: string; state: PlanState }> {
  const res = await api.api.workflow.execute.post(input)
  return unwrap(res) as { planId: string; state: PlanState }
}

export async function getPlan(planId: string): Promise<PlanDetail> {
  const res = await api.api.workflow.plans({ id: planId }).get()
  return unwrap(res) as PlanDetail
}

// GET /api/workflow/active?issueKey= — 404, если активного плана нет.
// UI обрабатывает not_found как «активного плана нет» и не показывает badge.
export async function getActivePlan(issueKey: string): Promise<PlanDetail | null> {
  try {
    const res = await api.api.workflow.active.get({ query: { issueKey } })
    return unwrap(res) as PlanDetail
  } catch (err) {
    if (err instanceof WorkflowPlannerError && err.code === 'not_found') return null
    throw err
  }
}

export async function cancelPlan(planId: string): Promise<{ planId: string; state: PlanState }> {
  const res = await api.api.workflow.plans({ id: planId }).cancel.post()
  return unwrap(res) as { planId: string; state: PlanState }
}

export async function retryPlan(planId: string): Promise<{ planId: string; state: PlanState }> {
  const res = await api.api.workflow.plans({ id: planId }).retry.post()
  return unwrap(res) as { planId: string; state: PlanState }
}

// GET /api/workflow/reachable?issueKey= — все статусы, в которые можно
// прийти через цепочку транзишенов одного issue type. UI рисует one-hop
// (minSteps=1) как прямые опции, multi-hop (>=2) — открывают wizard.
export async function getReachableStatuses(issueKey: string): Promise<ReachableStatusesResponse> {
  const res = await api.api.workflow.reachable.get({ query: { issueKey } })
  return unwrap(res) as ReachableStatusesResponse
}
