import { Elysia } from 'elysia'
import pino from 'pino'
import { env } from '../env'

// Корневой логгер. Один экземпляр на процесс. NDJSON в stdout.
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'api' },
  redact: {
    paths: [
      'req.headers["authorization"]',
      'req.headers["cookie"]',
      'req.headers["x-webhook-token"]',
      'headers["authorization"]',
      'headers["cookie"]',
      'headers["x-webhook-token"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.refreshToken',
      '*.pat',
      '*.kek',
      'body.password',
      'body.passwordHash',
      'body.pat',
      'body.token',
      '*.*.password',
      '*.*.token',
      '*.*.pat',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})

// Плагин: пробрасывает request-scoped логгер и логирует доступ.
// `as: 'global'` обязательно — без него хуки named-плагина остаются
// scoped к самому плагину и не срабатывают на маршрутах parent-app'а,
// из-за чего пропадают все access-логи.
export const loggerPlugin = new Elysia({ name: 'logger' })
  .decorate('log', logger)
  .derive({ as: 'global' }, ({ request }) => {
    const requestId = request.headers.get('x-request-id') ?? crypto.randomUUID()
    return {
      requestId,
      log: logger.child({ requestId }),
      startedAt: performance.now(),
    }
  })
  .onAfterHandle({ as: 'global' }, ({ request, set, startedAt, log }) => {
    const duration = Math.round(performance.now() - startedAt)
    const url = new URL(request.url)
    log.info(
      {
        method: request.method,
        path: url.pathname,
        status: set.status ?? 200,
        durationMs: duration,
      },
      'http.request',
    )
  })
  .onError({ as: 'global' }, ({ error, request, log }) => {
    const url = new URL(request.url)
    log.error(
      {
        method: request.method,
        path: url.pathname,
        err: error instanceof Error ? { name: error.name, message: error.message } : error,
      },
      'http.error',
    )
  })
