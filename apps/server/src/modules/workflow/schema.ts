import { t } from 'elysia'

// Контракт workflow-модуля. Все TypeBox-схемы дублируются клиентом через
// Eden Treaty, в react-hook-form форме wizard'а ссылаются на TransitionFieldReq.

export const TransitionFieldReq = t.Object({
  field: t.String(),
  name: t.String(),
  required: t.Boolean(),
  schemaType: t.String(),
  allowedValues: t.Optional(
    t.Array(
      t.Object({
        id: t.String(),
        value: t.Optional(t.String()),
        name: t.Optional(t.String()),
      }),
    ),
  ),
})

export const PlanStepPreview = t.Object({
  seq: t.Integer(),
  fromStatusId: t.String({ format: 'uuid' }),
  toStatusId: t.String({ format: 'uuid' }),
  fromStatusName: t.String(),
  toStatusName: t.String(),
  jiraTransitionId: t.String(),
  transitionName: t.String(),
  requiredFields: t.Array(TransitionFieldReq),
})

export const PlanPreview = t.Object({
  planId: t.String({ format: 'uuid' }),
  totalSteps: t.Integer(),
  hasRequiredFields: t.Boolean(),
  steps: t.Array(PlanStepPreview),
})

export const PlanBody = t.Object({
  issueKey: t.String({ minLength: 1, maxLength: 64 }),
  toStatusId: t.String({ format: 'uuid' }),
})

export const ExecuteBody = t.Object({
  planId: t.String({ format: 'uuid' }),
  // Ключ — seq шага (строкой, т.к. JSON-ключи только строки).
  fieldValuesByStep: t.Record(t.String(), t.Record(t.String(), t.Unknown())),
  finalComment: t.Optional(t.String({ maxLength: 4096 })),
})

export const PlanState = t.Union([
  t.Literal('draft'),
  t.Literal('queued'),
  t.Literal('running'),
  t.Literal('paused'),
  t.Literal('done'),
  t.Literal('failed'),
  t.Literal('cancelled'),
])

export const StepState = t.Union([
  t.Literal('pending'),
  t.Literal('running'),
  t.Literal('done'),
  t.Literal('failed'),
  t.Literal('skipped'),
])

export const PlanStep = t.Object({
  id: t.String({ format: 'uuid' }),
  seq: t.Integer(),
  fromStatusId: t.String({ format: 'uuid' }),
  toStatusId: t.String({ format: 'uuid' }),
  jiraTransitionId: t.String(),
  state: StepState,
  outboxKey: t.Union([t.String(), t.Null()]),
  error: t.Union([t.String(), t.Null()]),
  fieldValues: t.Record(t.String(), t.Unknown()),
})

export const PlanDetail = t.Object({
  id: t.String({ format: 'uuid' }),
  issueId: t.String({ format: 'uuid' }),
  userId: t.String({ format: 'uuid' }),
  state: PlanState,
  fromStatusId: t.String({ format: 'uuid' }),
  toStatusId: t.String({ format: 'uuid' }),
  // Имя целевого статуса (берётся из plan.context на момент создания);
  // null, если контекст устарел и имя не сохранилось.
  targetStatusName: t.Union([t.String(), t.Null()]),
  error: t.Union([t.String(), t.Null()]),
  finalComment: t.Union([t.String(), t.Null()]),
  steps: t.Array(PlanStep),
})

export const ReachableStatus = t.Object({
  statusId: t.String({ format: 'uuid' }),
  statusName: t.String(),
  // BFS-расстояние от текущего статуса. 1 = one-hop, >=2 = multi-hop wizard.
  minSteps: t.Integer(),
})

export const ReachableStatusesResponse = t.Object({
  fromStatusId: t.String({ format: 'uuid' }),
  statuses: t.Array(ReachableStatus),
})

export type PlanPreview = typeof PlanPreview.static
export type PlanStepPreview = typeof PlanStepPreview.static
export type PlanBody = typeof PlanBody.static
export type ExecuteBody = typeof ExecuteBody.static
export type PlanDetail = typeof PlanDetail.static
export type PlanStep = typeof PlanStep.static
export type PlanState = typeof PlanState.static
export type ReachableStatus = typeof ReachableStatus.static
export type ReachableStatusesResponse = typeof ReachableStatusesResponse.static
