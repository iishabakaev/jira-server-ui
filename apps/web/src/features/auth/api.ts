import { api } from '../../lib/eden'

// Тонкая обёртка над Eden Treaty: единое место, через которое всё auth-UI
// общается с сервером. Никаких прямых fetch в компонентах.

export type AuthProvider = 'local' | 'keycloak'

export type CurrentUser = {
  id: string
  displayName: string
  email: string
  provider: AuthProvider
  roles: Array<'user' | 'team_admin' | 'app_admin'>
  // jira accountId — нужен для фильтра «Mine» (сравниваем с assigneeId).
  // null, если PAT ещё не привязан.
  jiraAccountId: string | null
}

export type MeResponse = {
  user: CurrentUser
  jiraConnected: boolean
  jiraDisplayName: string | null
  jiraNeedsReattach: boolean
}

export type ProvidersResponse = {
  local: boolean
  keycloak: boolean
  allowSignup: boolean
}

export type PatStatus = {
  attached: boolean
  jiraDisplayName: string | null
  needsReattach: boolean
  lastUsedAt: string | null
}

function unwrap<T>(value: { data: T | null; error: unknown }): T {
  if (value.error) {
    const err = value.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new AuthError(inner?.code ?? 'unknown', inner?.message ?? 'Request failed')
  }
  if (value.data === null) throw new AuthError('unknown', 'Empty response')
  return value.data
}

export class AuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function fetchProviders(): Promise<ProvidersResponse> {
  return unwrap(await api.api.auth.providers.get())
}

export async function fetchMe(): Promise<MeResponse | null> {
  const res = await api.api.auth.me.get()
  if (res.error) {
    const status = (res.error as { status?: number }).status
    if (status === 401) return null
    throw new AuthError('unknown', 'Failed to load /auth/me')
  }
  return res.data as MeResponse
}

export async function loginLocal(username: string, password: string) {
  return unwrap(await api.api.auth.local.login.post({ username, password }))
}

export async function logout() {
  return unwrap(await api.api.auth.logout.post())
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return unwrap(
    await api.api.auth['local']['change-password'].post({ currentPassword, newPassword }),
  )
}

export async function attachJiraPat(token: string) {
  return unwrap(await api.api.auth['jira-pat'].post({ token }))
}

export async function removeJiraPat() {
  return unwrap(await api.api.auth['jira-pat'].delete())
}

export async function fetchJiraPat(): Promise<PatStatus> {
  return unwrap(await api.api.auth['jira-pat'].get())
}

export async function testJiraPat() {
  return unwrap(await api.api.auth['jira-pat'].test.post())
}
