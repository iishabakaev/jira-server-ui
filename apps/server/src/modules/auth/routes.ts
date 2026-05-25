import { db, jiraCredentials } from '@db'
import { and, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { env } from '../../env'
import { isCsrfSafe, trustedClientIp } from '../../lib/request'
import { auth } from '../../plugins/auth'
import { appError } from '../../plugins/error'
import { attachPat, getPatStatus, removePat, testPat } from './jira-pat'
import {
  AttachPatRequest,
  ChangePasswordRequest,
  LoginRequest,
  LoginResponse,
  MeResponse,
  OkResponse,
  PatStatusResponse,
  ProvidersResponse,
  TestPatResponse,
} from './schema'
import { changeLocalPassword, loginLocal } from './service'
import { createSession, IDLE_TTL_MS, revokeSession } from './sessions'

// Cookie сессии. SameSite=Strict — самый строгий вариант: cookie не уезжает
// при cross-site навигации, чем закрываем top-level CSRF на POST через формы
// со сторонних сайтов. Secure включаем в production автоматически.
function sessionCookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    path: '/',
    secure: env.NODE_ENV === 'production',
    maxAge: Math.floor(IDLE_TTL_MS / 1000),
  }
}

const allowedOrigin = new URL(env.APP_BASE_URL).origin

export const authModule = new Elysia({ prefix: '/auth', name: 'auth-routes' })
  .use(auth)
  // Дополнительная страховка от CSRF: на любой не-safe метод проверяем Origin
  // (или Referer) против APP_BASE_URL. Защищает даже когда у клиента отключён
  // SameSite или используется устаревший браузер.
  .onBeforeHandle(({ request, set }) => {
    if (!isCsrfSafe(request, allowedOrigin)) {
      set.status = 403
      return { error: { code: 'forbidden' as const, message: 'Cross-origin request rejected.' } }
    }
  })
  .get(
    '/providers',
    () => ({
      local: env.AUTH_LOCAL_ENABLED,
      keycloak: env.AUTH_KEYCLOAK_ENABLED,
      allowSignup: env.AUTH_LOCAL_ALLOW_SIGNUP,
    }),
    {
      response: { 200: ProvidersResponse },
    },
  )
  .get(
    '/me',
    async ({ user, set }) => {
      if (!user) {
        set.status = 401
        return { error: { code: 'unauthenticated' as const, message: 'Not signed in.' } }
      }
      // PAT-статус читаем одним запросом.
      const patRows = await db
        .select({
          jiraDisplayName: jiraCredentials.jiraDisplayName,
          needsReattach: jiraCredentials.needsReattach,
        })
        .from(jiraCredentials)
        .where(and(eq(jiraCredentials.userId, user.id), eq(jiraCredentials.kind, 'pat')))
        .limit(1)
      const pat = patRows[0]
      return {
        user: {
          id: user.id,
          displayName: user.displayName,
          email: user.email,
          provider: user.provider,
          roles: user.roles,
          jiraAccountId: user.jiraAccountId ?? null,
        },
        jiraConnected: Boolean(pat),
        jiraDisplayName: pat?.jiraDisplayName ?? null,
        jiraNeedsReattach: pat?.needsReattach === 'true',
      }
    },
    {
      response: {
        200: MeResponse,
        401: t.Object({
          error: t.Object({ code: t.Literal('unauthenticated'), message: t.String() }),
        }),
      },
    },
  )
  .post(
    '/local/login',
    async ({ body, cookie, request, set }) => {
      if (!env.AUTH_LOCAL_ENABLED) throw appError('not_found', 'Local auth disabled')
      // Ротация: если в куки уже лежит идентификатор предыдущей сессии,
      // отзываем её до выдачи новой — защита от session fixation.
      const prevSid = cookie[env.SESSION_COOKIE_NAME]?.value
      if (prevSid && typeof prevSid === 'string') {
        await revokeSession(prevSid)
      }
      const result = await loginLocal(body.username, body.password)
      const userAgent = request.headers.get('user-agent')?.slice(0, 256) ?? null
      const ip = trustedClientIp(request.headers)
      const session = await createSession({ userId: result.userId, ip, userAgent })
      cookie[env.SESSION_COOKIE_NAME]?.set({
        value: session.id,
        ...sessionCookieOpts(),
      })
      set.status = 200
      return { user: result.user, mustChange: result.mustChange }
    },
    {
      body: LoginRequest,
      response: { 200: LoginResponse },
    },
  )
  .post(
    '/logout',
    async ({ cookie, set }) => {
      const c = cookie[env.SESSION_COOKIE_NAME]
      const sid = c?.value
      if (sid && typeof sid === 'string') {
        await revokeSession(sid)
      }
      c?.remove()
      set.status = 200
      return { ok: true as const }
    },
    {
      response: { 200: OkResponse },
    },
  )
  .post(
    '/local/change-password',
    async ({ body, user }) => {
      if (!user) throw appError('unauthenticated', 'Sign in required')
      if (user.provider !== 'local') throw appError('forbidden', 'Not a local account')
      await changeLocalPassword(user.id, body.currentPassword, body.newPassword)
      return { ok: true as const }
    },
    {
      body: ChangePasswordRequest,
      requireAuth: true,
      response: { 200: OkResponse },
    },
  )
  // ─── Jira PAT ───
  .post(
    '/jira-pat',
    async ({ body, user }) => {
      if (!user) throw appError('unauthenticated', 'Sign in required')
      await attachPat(user.id, body.token)
      // Возвращаем актуальный статус, прочитав строку из БД, чтобы UI не
      // расходился по времени с серверным состоянием.
      return getPatStatus(user.id)
    },
    {
      body: AttachPatRequest,
      requireAuth: true,
      response: { 200: PatStatusResponse },
    },
  )
  .delete(
    '/jira-pat',
    async ({ user }) => {
      if (!user) throw appError('unauthenticated', 'Sign in required')
      await removePat(user.id)
      return { ok: true as const }
    },
    {
      requireAuth: true,
      response: { 200: OkResponse },
    },
  )
  .get(
    '/jira-pat',
    async ({ user }) => {
      if (!user) throw appError('unauthenticated', 'Sign in required')
      return getPatStatus(user.id)
    },
    {
      requireAuth: true,
      response: { 200: PatStatusResponse },
    },
  )
  // POST, потому что обновляет lastUsedAt/needsReattach при каждом вызове —
  // GET для мутирующего эндпоинта противоречит REST-семантике.
  .post(
    '/jira-pat/test',
    async ({ user }) => {
      if (!user) throw appError('unauthenticated', 'Sign in required')
      return testPat(user.id)
    },
    {
      requireAuth: true,
      response: { 200: TestPatResponse },
    },
  )
