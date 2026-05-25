import { Elysia, t } from 'elysia'
import { enqueueJob } from '../../lib/queue'
import { auth } from '../../plugins/auth'
import { appError, ErrorEnvelope } from '../../plugins/error'
import { ExecuteBody, PlanBody, PlanDetail, PlanPreview, ReachableStatusesResponse } from './schema'
import { type WorkflowEnqueuer, workflowService } from './service'

// HTTP-фасад workflow. План и шаги — это user-facing wizard в UI:
//  - POST /api/workflow/plan       строит PlanPreview без enqueue.
//  - POST /api/workflow/execute    стартует исполнение через pg-boss.
//  - GET  /api/workflow/plans/:id  читает план + шаги.
//  - GET  /api/workflow/active     возвращает активный план для issue или 404.
//  - POST /api/workflow/plans/:id/retry|cancel
//
// Подробности — docs/specs/14-workflow-engine.md и 06-api.md (#workflow).

const enqueuer: WorkflowEnqueuer = {
  async enqueueRun(planId: string) {
    // singletonKey предотвращает дубль-запуск того же плана конкурирующими
    // /execute вызовами; pg-boss схлопнет в одну активную задачу.
    await enqueueJob('workflow-run', { planId }, { singletonKey: `workflow-run:${planId}` })
  },
}

export const workflowModule = new Elysia({ prefix: '/workflow', name: 'workflow-routes' })
  .use(auth)
  .post('/plan', async ({ body, user }) => workflowService.plan({ user: { id: user!.id } }, body), {
    requireAuth: true,
    body: PlanBody,
    response: {
      200: PlanPreview,
      401: ErrorEnvelope,
      404: ErrorEnvelope,
      409: ErrorEnvelope,
      422: ErrorEnvelope,
    },
  })
  .post(
    '/execute',
    async ({ body, user }) => workflowService.execute({ user: { id: user!.id } }, enqueuer, body),
    {
      requireAuth: true,
      body: ExecuteBody,
      response: {
        200: t.Object({
          planId: t.String({ format: 'uuid' }),
          state: t.String(),
        }),
        401: ErrorEnvelope,
        404: ErrorEnvelope,
        409: ErrorEnvelope,
      },
    },
  )
  .get(
    '/plans/:id',
    async ({ params }) => {
      const plan = await workflowService.get(params.id)
      if (!plan) throw appError('not_found', 'Plan not found')
      return plan
    },
    {
      requireAuth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: {
        200: PlanDetail,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .post(
    '/plans/:id/retry',
    async ({ params, user }) =>
      workflowService.retry({ user: { id: user!.id } }, enqueuer, params.id),
    {
      requireAuth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: {
        200: t.Object({ planId: t.String({ format: 'uuid' }), state: t.String() }),
        401: ErrorEnvelope,
        403: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .post(
    '/plans/:id/cancel',
    async ({ params, user }) => workflowService.cancel({ user: { id: user!.id } }, params.id),
    {
      requireAuth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: {
        200: t.Object({ planId: t.String({ format: 'uuid' }), state: t.String() }),
        401: ErrorEnvelope,
        403: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get(
    '/active',
    async ({ query }) => {
      const plan = await workflowService.active(query.issueKey)
      if (!plan) throw appError('not_found', 'No active plan for issue')
      return plan
    },
    {
      requireAuth: true,
      query: t.Object({ issueKey: t.String({ minLength: 1, maxLength: 64 }) }),
      response: {
        200: PlanDetail,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get('/reachable', async ({ query }) => workflowService.reachable(query.issueKey), {
    requireAuth: true,
    query: t.Object({ issueKey: t.String({ minLength: 1, maxLength: 64 }) }),
    response: {
      200: ReachableStatusesResponse,
      401: ErrorEnvelope,
      404: ErrorEnvelope,
    },
  })
