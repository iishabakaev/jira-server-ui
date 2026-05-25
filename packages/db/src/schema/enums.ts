import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Жизненный цикл синхронизации для любой локально редактируемой
 * зеркальной копии сущности Jira. Состояние выводится в UI бейджем
 * (см. docs/specs/10-realtime-and-status.md).
 */
export const syncStateEnum = pgEnum('sync_state', [
  'synced',
  'pending',
  'pushing',
  'error',
  'conflict',
])

// Состояния строки outbox. `dead` — финальная неудача, без авто-ретраев.
export const outboxStateEnum = pgEnum('outbox_state', [
  'pending',
  'in_flight',
  'done',
  'error',
  'dead',
])

// Роль применяется аддитивно; у каждого пользователя всегда есть 'user'.
export const userRoleEnum = pgEnum('user_role', [
  'user',
  'team_admin',
  'app_admin',
])

// Провайдер аутентификации. Local нужен для bootstrap и QA, когда Keycloak недоступен.
export const authProviderEnum = pgEnum('auth_provider', [
  'keycloak',
  'local',
])

export const jiraCredentialKindEnum = pgEnum('jira_credential_kind', [
  'pat',
  'oauth',
])

/** Состояние многошагового плана смены статуса (workflow planner). */
export const workflowPlanStateEnum = pgEnum('workflow_plan_state', [
  'draft',          // пользователь заполняет обязательные поля
  'queued',         // готов к выполнению, ждёт воркера
  'running',        // воркер исполняет шаги
  'paused',         // остановлен на ошибке, ожидает действия пользователя
  'done',
  'failed',
  'cancelled',
])

export const workflowStepStateEnum = pgEnum('workflow_step_state', [
  'pending',
  'running',
  'done',
  'failed',
  'skipped',
])
