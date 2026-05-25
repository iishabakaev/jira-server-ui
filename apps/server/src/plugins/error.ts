import { Elysia, t } from 'elysia'

// Конверт ошибки. Один и тот же контракт на все ответы 4xx/5xx.
export const ErrorEnvelope = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    details: t.Optional(t.Unknown()),
  }),
})

export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'sync_conflict'
  | 'optimistic_lock_failed'
  | 'workflow_active'
  | 'no_workflow_path'
  | 'jira_locked'
  | 'jira_unavailable'
  | 'internal'

// Бизнес-исключение с устойчивым кодом ошибки.
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

const codeToStatus: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  sync_conflict: 409,
  optimistic_lock_failed: 409,
  workflow_active: 409,
  no_workflow_path: 422,
  jira_locked: 423,
  jira_unavailable: 502,
  internal: 500,
}

export function appError(code: ErrorCode, message: string, details?: unknown): AppError {
  return new AppError(code, message, codeToStatus[code], details)
}

// Плагин: единая нормализация ошибок Elysia в конверт {error:{...}}.
// `as: 'global'` обязательно — без него хуки named-плагина остаются
// scope-local и подмонтированные модули (issues/users/...) отдают raw-
// ошибки drizzle/bun наружу, с просочившимся SQL в теле ответа.
export const errorPlugin = new Elysia({ name: 'error' })
  .error({ AppError })
  .onError({ as: 'global' }, ({ code, error, set }) => {
    if (error instanceof AppError) {
      set.status = error.status
      return {
        error: { code: error.code, message: error.message, details: error.details },
      }
    }
    switch (code) {
      case 'VALIDATION':
        set.status = 400
        return {
          error: {
            code: 'validation_failed' satisfies ErrorCode,
            message: 'Request did not pass validation.',
            details: 'all' in error ? error.all : undefined,
          },
        }
      case 'NOT_FOUND':
        set.status = 404
        return {
          error: { code: 'not_found' satisfies ErrorCode, message: 'Route not found.' },
        }
      case 'PARSE':
        set.status = 400
        return {
          error: { code: 'validation_failed' satisfies ErrorCode, message: 'Bad request body.' },
        }
      default:
        // Не возвращаем raw error.message наружу: drizzle/db-ошибки содержат
        // полный SQL c plaintext-параметрами. Логирует это loggerPlugin.
        set.status = 500
        return {
          error: {
            code: 'internal' satisfies ErrorCode,
            message: 'Internal error',
          },
        }
    }
  })
