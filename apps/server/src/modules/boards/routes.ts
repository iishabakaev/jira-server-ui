import { Elysia, t } from 'elysia'
import { auth } from '../../plugins/auth'
import { appError, ErrorEnvelope } from '../../plugins/error'
import { BoardDetail, BoardKanbanQuery, BoardKanbanResponse, BoardListItem } from './schema'
import { boardsService } from './service'

// HTTP-фасад модуля boards. На M4 — read-only:
//   GET /api/boards
//   GET /api/boards/:id
//   GET /api/boards/:id/kanban
// PATCH /wip-limits и saved views — milestone 5/8.
export const boardsModule = new Elysia({ prefix: '/boards', name: 'boards-routes' })
  .use(auth)
  .get('/', async () => ({ items: await boardsService.list() }), {
    requireAuth: true,
    response: {
      200: t.Object({ items: t.Array(BoardListItem) }),
      401: ErrorEnvelope,
    },
  })
  .get(
    '/:id',
    async ({ params }) => {
      const board = await boardsService.detail(params.id)
      if (!board) throw appError('not_found', 'Board not found')
      return board
    },
    {
      requireAuth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: {
        200: BoardDetail,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get(
    '/:id/kanban',
    async ({ params, query }) => {
      const result = await boardsService.kanban(params.id, query)
      if (!result) throw appError('not_found', 'Board not found')
      return result
    },
    {
      requireAuth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      query: BoardKanbanQuery,
      response: {
        200: BoardKanbanResponse,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
