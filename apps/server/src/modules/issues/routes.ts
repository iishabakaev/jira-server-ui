import { Elysia, t } from 'elysia'
import { auth } from '../../plugins/auth'
import { appError, ErrorEnvelope } from '../../plugins/error'
import {
  commentsMutations,
  issuesMutations,
  listAvailableTransitions,
  quickCreateMutations,
} from './mutations'
import {
  BatchRankBody,
  CommentCreateBody,
  CommentEditBody,
  IssueActivityResponse,
  IssueComment,
  IssueDetail,
  IssueFilter,
  IssueListResponse,
  IssuePatch,
  IssueSummary,
  QuickCreateBody,
  RankBody,
  TransitionBody,
  TransitionsResponse,
} from './schema'
import { issuesService } from './service'

// HTTP-фасад модуля issues. M4 — read-only; M5 добавил мутации:
//   GET   /api/issues                          — листинг
//   GET   /api/issues/:keyOrId                 — карточка
//   GET   /api/issues/:keyOrId/transitions     — кеш доступных транзишенов
//   PATCH /api/issues/:keyOrId                 — частичное обновление (через outbox)
//   POST  /api/issues/:keyOrId/transition      — одношаговая смена статуса
//   POST  /api/issues/:keyOrId/rank            — ranking одной карточки
//   POST  /api/issues/batch-rank               — атомарный rank нескольким + опц. transition
// Batch-rank монтируется ПЕРЕД :keyOrId/-роутами, иначе Elysia матчит его как
// параметр keyOrId='batch-rank' (см. docs/specs/06-api.md #issues).
export const issuesModule = new Elysia({ prefix: '/issues', name: 'issues-routes' })
  .use(auth)
  .get('/', async ({ query }) => issuesService.list(query), {
    requireAuth: true,
    query: IssueFilter,
    response: {
      200: IssueListResponse,
      401: ErrorEnvelope,
    },
  })
  .post(
    '/batch-rank',
    async ({ body, user }) => {
      const items = await issuesMutations.batchRank(user!.id, body)
      return { items }
    },
    {
      requireAuth: true,
      body: BatchRankBody,
      response: {
        200: t.Object({ items: t.Array(IssueSummary) }),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get(
    '/:keyOrId',
    async ({ params }) => {
      const issue = await issuesService.get(params.keyOrId)
      if (!issue) throw appError('not_found', 'Issue not found')
      return { issue }
    },
    {
      requireAuth: true,
      params: t.Object({ keyOrId: t.String({ minLength: 1, maxLength: 64 }) }),
      response: {
        200: t.Object({ issue: IssueSummary }),
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get(
    '/:keyOrId/detail',
    async ({ params }) => {
      const detail = await issuesService.getDetail(params.keyOrId)
      if (!detail) throw appError('not_found', 'Issue not found')
      return { detail }
    },
    {
      requireAuth: true,
      params: t.Object({ keyOrId: t.String({ minLength: 1, maxLength: 64 }) }),
      response: {
        200: t.Object({ detail: IssueDetail }),
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get(
    '/:keyOrId/transitions',
    async ({ params }) => {
      const issue = await issuesService.get(params.keyOrId)
      if (!issue) throw appError('not_found', 'Issue not found')
      const result = await listAvailableTransitions(issue.id)
      if (!result) throw appError('not_found', 'Issue not found')
      return result
    },
    {
      requireAuth: true,
      params: t.Object({ keyOrId: t.String({ minLength: 1, maxLength: 64 }) }),
      response: {
        200: TransitionsResponse,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get(
    '/:keyOrId/activity',
    async ({ params }) => {
      const issue = await issuesService.get(params.keyOrId)
      if (!issue) throw appError('not_found', 'Issue not found')
      const items = await issuesService.listActivity(issue.id)
      return { items }
    },
    {
      requireAuth: true,
      params: t.Object({ keyOrId: t.String({ minLength: 1, maxLength: 64 }) }),
      response: {
        200: IssueActivityResponse,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .patch(
    '/:keyOrId',
    async ({ params, body, user }) => {
      const issue = await issuesMutations.patch(user!.id, params.keyOrId, body)
      return { issue }
    },
    {
      requireAuth: true,
      params: t.Object({ keyOrId: t.String({ minLength: 1, maxLength: 64 }) }),
      body: IssuePatch,
      response: {
        200: t.Object({ issue: IssueSummary }),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .post(
    '/:keyOrId/transition',
    async ({ params, body, user }) => {
      const issue = await issuesMutations.transition(user!.id, params.keyOrId, body)
      return { issue }
    },
    {
      requireAuth: true,
      params: t.Object({ keyOrId: t.String({ minLength: 1, maxLength: 64 }) }),
      body: TransitionBody,
      response: {
        200: t.Object({ issue: IssueSummary }),
        401: ErrorEnvelope,
        404: ErrorEnvelope,
        422: ErrorEnvelope,
      },
    },
  )
  .post(
    '/:keyOrId/rank',
    async ({ params, body, user }) => {
      const items = await issuesMutations.batchRank(
        user!.id,
        { issueIds: [], beforeId: body.beforeId, afterId: body.afterId },
        params.keyOrId,
      )
      return { issue: items[0]! }
    },
    {
      requireAuth: true,
      params: t.Object({ keyOrId: t.String({ minLength: 1, maxLength: 64 }) }),
      body: RankBody,
      response: {
        200: t.Object({ issue: IssueSummary }),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  // ─── M6: comments ───
  .post(
    '/:keyOrId/comments',
    async ({ params, body, user }) => {
      const comment = await commentsMutations.add(
        user!.id,
        user!.jiraAccountId,
        params.keyOrId,
        body,
      )
      return { comment }
    },
    {
      requireAuth: true,
      params: t.Object({ keyOrId: t.String({ minLength: 1, maxLength: 64 }) }),
      body: CommentCreateBody,
      response: {
        200: t.Object({ comment: IssueComment }),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .patch(
    '/comments/:commentId',
    async ({ params, body, user }) => {
      const comment = await commentsMutations.edit(
        user!.id,
        user!.jiraAccountId,
        params.commentId,
        body,
      )
      return { comment }
    },
    {
      requireAuth: true,
      params: t.Object({ commentId: t.String({ format: 'uuid' }) }),
      body: CommentEditBody,
      response: {
        200: t.Object({ comment: IssueComment }),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        403: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .delete(
    '/comments/:commentId',
    async ({ params, user }) =>
      commentsMutations.remove(user!.id, user!.jiraAccountId, params.commentId),
    {
      requireAuth: true,
      params: t.Object({ commentId: t.String({ format: 'uuid' }) }),
      response: {
        200: t.Object({ ok: t.Literal(true) }),
        401: ErrorEnvelope,
        403: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  // ─── M6: quick-create ───
  // Намеренно POST /api/issues без префикса — Eden Treaty прокидывает type-safe
  // body. Route монтируется ПОСЛЕ /:keyOrId-роутов, но Elysia роутер сам
  // выбирает корневой path при отсутствии параметра.
  .post(
    '/',
    async ({ body, user }) => {
      const issue = await quickCreateMutations.create(user!.id, body)
      return { issue }
    },
    {
      requireAuth: true,
      body: QuickCreateBody,
      response: {
        200: t.Object({ issue: IssueSummary }),
        400: ErrorEnvelope,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
        422: ErrorEnvelope,
      },
    },
  )
