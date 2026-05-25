import { t } from 'elysia'

// Именованные t.* схемы запросов/ответов модуля auth.
// Они же — вход контракта Eden Treaty на стороне фронта.

export const LoginRequest = t.Object({
  username: t.String({ minLength: 1, maxLength: 80 }),
  password: t.String({ minLength: 1, maxLength: 256 }),
})

export const ChangePasswordRequest = t.Object({
  currentPassword: t.String({ minLength: 1, maxLength: 256 }),
  newPassword: t.String({ minLength: 12, maxLength: 256 }),
})

export const MeResponse = t.Object({
  user: t.Object({
    id: t.String(),
    displayName: t.String(),
    email: t.String(),
    provider: t.Union([t.Literal('local'), t.Literal('keycloak')]),
    roles: t.Array(t.Union([t.Literal('user'), t.Literal('team_admin'), t.Literal('app_admin')])),
    // jiraAccountId нужен фронту, чтобы фильтр «Mine» сравнивал issues
    // с assigneeId напрямую (assignee_id у issue == accountId).
    jiraAccountId: t.Union([t.String(), t.Null()]),
  }),
  jiraConnected: t.Boolean(),
  jiraDisplayName: t.Optional(t.Union([t.String(), t.Null()])),
  jiraNeedsReattach: t.Boolean(),
})

export const LoginResponse = t.Object({
  user: t.Object({
    id: t.String(),
    displayName: t.String(),
    email: t.String(),
    provider: t.Union([t.Literal('local'), t.Literal('keycloak')]),
    roles: t.Array(t.Union([t.Literal('user'), t.Literal('team_admin'), t.Literal('app_admin')])),
  }),
  mustChange: t.Boolean(),
})

export const AttachPatRequest = t.Object({
  token: t.String({ minLength: 8, maxLength: 1024 }),
})

export const PatStatusResponse = t.Object({
  attached: t.Boolean(),
  jiraDisplayName: t.Union([t.String(), t.Null()]),
  needsReattach: t.Boolean(),
  lastUsedAt: t.Union([t.String(), t.Null()]),
})

export const TestPatResponse = t.Object({
  ok: t.Boolean(),
  jiraDisplayName: t.Union([t.String(), t.Null()]),
})

export const ProvidersResponse = t.Object({
  local: t.Boolean(),
  keycloak: t.Boolean(),
  allowSignup: t.Boolean(),
})

export const OkResponse = t.Object({ ok: t.Literal(true) })
