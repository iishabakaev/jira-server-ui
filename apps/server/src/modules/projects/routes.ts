import { Elysia, t } from 'elysia'
import { auth } from '../../plugins/auth'
import { appError, ErrorEnvelope } from '../../plugins/error'
import {
  ProjectDetail,
  ProjectKanbanQuery,
  ProjectKanbanResponse,
  ProjectListResponse,
  ProjectSprintsResponse,
} from './schema'
import { projectsService } from './service'

// HTTP-фасад projects-модуля. Этот endpoint вытесняет boards в путях
// kanban/timeline UI: UI сам строит колонки поверх statuses, никаких
// Jira Agile API.
//   GET /api/projects?text=        — список проектов (фуззи-фильтр сервером)
//   GET /api/projects/:id          — деталь проекта + issue-types для quick-create
//   GET /api/projects/:id/kanban   — kanban-данные, сгруппированные нами
export const projectsModule = new Elysia({ prefix: '/projects', name: 'projects-routes' })
  .use(auth)
  .get('/', async ({ query }) => ({ items: await projectsService.list(query.text ?? null) }), {
    requireAuth: true,
    query: t.Object({
      // Пустую строку клиент шлёт когда поле очищено — мягко конвертим
      // в "нет фильтра", чтобы сервер не делал бессмысленный ilike(%%).
      text: t.Optional(t.String({ maxLength: 200 })),
    }),
    response: {
      200: ProjectListResponse,
      401: ErrorEnvelope,
    },
  })
  .get(
    '/:id',
    async ({ params }) => {
      const detail = await projectsService.detail(params.id)
      if (!detail) throw appError('not_found', 'Project not found')
      return detail
    },
    {
      requireAuth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: {
        200: ProjectDetail,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get(
    '/:id/sprints',
    async ({ params }) => {
      const items = await projectsService.sprints(params.id)
      if (!items) throw appError('not_found', 'Project not found')
      return { items }
    },
    {
      requireAuth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      response: {
        200: ProjectSprintsResponse,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
  .get(
    '/:id/kanban',
    async ({ params, query }) => {
      const result = await projectsService.kanban(params.id, query)
      if (!result) throw appError('not_found', 'Project not found')
      return result
    },
    {
      requireAuth: true,
      params: t.Object({ id: t.String({ format: 'uuid' }) }),
      query: ProjectKanbanQuery,
      response: {
        200: ProjectKanbanResponse,
        401: ErrorEnvelope,
        404: ErrorEnvelope,
      },
    },
  )
