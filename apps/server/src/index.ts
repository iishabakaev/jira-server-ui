import { cors } from '@elysiajs/cors'
import { swagger } from '@elysiajs/swagger'
import { Elysia } from 'elysia'
import { env } from './env'
import { authModule } from './modules/auth/routes'
import { boardsModule } from './modules/boards/routes'
import { healthModule } from './modules/health/routes'
import { issuesModule } from './modules/issues/routes'
import { projectsModule } from './modules/projects/routes'
import { syncModule } from './modules/sync/routes'
import { timelineModule } from './modules/timeline/routes'
import { usersModule } from './modules/users/routes'
import { workflowModule } from './modules/workflow/routes'
import { auth } from './plugins/auth'
import { errorPlugin } from './plugins/error'
import { logger, loggerPlugin } from './plugins/logger'
import { rateLimitPlugin } from './plugins/rateLimit'
import { ssePlugin } from './plugins/sse'

// Корневой сервер. Префикс /api жёстко зафиксирован — Eden Treaty
// и фронтенд об этом знают (см. docs/specs/06-api.md).
//
// CORS: явный allowlist из APP_BASE_URL. `origin: true` + `credentials: true`
// — это reflect-origin, что эквивалентно открытому CSRF: любой сайт сможет
// дернуть /api с cookie-сессией.
const allowedOrigin = new URL(env.APP_BASE_URL).origin

const baseApp = new Elysia({ prefix: '/api' })
  .use(errorPlugin)
  .use(loggerPlugin)
  .use(
    cors({
      credentials: true,
      origin: [allowedOrigin],
      allowedHeaders: ['content-type', 'x-request-id', 'x-webhook-token'],
    }),
  )
  .use(auth)
  .use(ssePlugin)
  .use(rateLimitPlugin)
  .use(healthModule)
  .use(authModule)
  .use(usersModule)
  .use(issuesModule)
  .use(boardsModule)
  .use(projectsModule)
  .use(timelineModule)
  .use(workflowModule)
  .use(syncModule)

// Swagger-плагин монтируется внутри group prefix /api, поэтому exclude-path
// указывается без префикса (относительно дерева Elysia, а не публичного URL).
export const app = env.EXPOSE_OPENAPI
  ? baseApp.use(swagger({ path: '/docs', exclude: ['/webhooks/jira'] }))
  : baseApp

if (import.meta.main) {
  app.listen(env.PORT, ({ hostname, port }) => {
    logger.info({ hostname, port }, 'api.listening')
  })
}

export type App = typeof app
