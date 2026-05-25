// Локальные типы workflow-планера. Зеркалят серверный TypeBox-контракт
// (apps/server/src/modules/workflow/schema.ts), но не импортируют его —
// Eden Treaty остаётся источником правды только в api.ts. Дублируем здесь,
// чтобы IDE подсказывала без полного раскрытия Eden-вывода внутри компонентов.

export type TransitionFieldReq = {
  field: string
  name: string
  required: boolean
  schemaType: string
  allowedValues?: Array<{ id: string; value?: string; name?: string }>
}

export type PlanStepPreview = {
  seq: number
  fromStatusId: string
  toStatusId: string
  fromStatusName: string
  toStatusName: string
  jiraTransitionId: string
  transitionName: string
  requiredFields: TransitionFieldReq[]
}

export type PlanPreview = {
  planId: string
  totalSteps: number
  hasRequiredFields: boolean
  steps: PlanStepPreview[]
}

export type PlanState = 'draft' | 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type PlanStep = {
  id: string
  seq: number
  fromStatusId: string
  toStatusId: string
  jiraTransitionId: string
  state: StepState
  outboxKey: string | null
  error: string | null
  fieldValues: Record<string, unknown>
}

export type PlanDetail = {
  id: string
  issueId: string
  userId: string
  state: PlanState
  fromStatusId: string
  toStatusId: string
  // Имя целевого статуса, сохранённое на момент создания плана.
  targetStatusName: string | null
  error: string | null
  finalComment: string | null
  steps: PlanStep[]
}

export type ReachableStatus = {
  statusId: string
  statusName: string
  // 1 = one-hop (можно делать прямой transition), >=2 = wizard.
  minSteps: number
}

export type ReachableStatusesResponse = {
  fromStatusId: string
  statuses: ReachableStatus[]
}

export type ExecuteInput = {
  planId: string
  fieldValuesByStep: Record<string, Record<string, unknown>>
  finalComment?: string
}

// Терминальные состояния плана — UI прекращает polling по достижении.
export const TERMINAL_PLAN_STATES: readonly PlanState[] = ['done', 'failed', 'cancelled']

export function isTerminalPlanState(state: PlanState): boolean {
  return TERMINAL_PLAN_STATES.includes(state)
}
