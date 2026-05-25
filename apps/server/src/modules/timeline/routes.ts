import { Elysia } from 'elysia'
import { auth } from '../../plugins/auth'
import { ErrorEnvelope } from '../../plugins/error'
import { TimelineQuery, TimelineResponse } from './schema'
import { timelineService } from './service'

// HTTP-фасад timeline-модуля. На M7-MVP — только read-only окно баров:
//   GET /api/timeline?projectId&from&to&group=epic|assignee|sprint|none
// Мутации дат идут через существующий PATCH /api/issues/:k (issuesMutations.patch
// уже поддерживает startDate/dueDate), drag-resize/move в UI вызывает его.
// Dependency-arrows, capacity overlay и bulk-plan — следующие итерации.
export const timelineModule = new Elysia({ prefix: '/timeline', name: 'timeline-routes' })
  .use(auth)
  .get('/', async ({ query }) => timelineService.window(query), {
    requireAuth: true,
    query: TimelineQuery,
    response: {
      200: TimelineResponse,
      400: ErrorEnvelope,
      401: ErrorEnvelope,
    },
  })
