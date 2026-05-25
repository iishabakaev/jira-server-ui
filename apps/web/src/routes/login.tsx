import { createRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Button } from '@ui/button'
import { type FormEvent, useEffect, useState } from 'react'
import { AuthError, authKeys, fetchMe, useLogin, useMe, useProviders } from '../features/auth'
import { queryClient } from '../lib/query-client'
import { Route as RootRoute } from './__root'

// Страница /login. Карточки провайдеров: local-форма (логин/пароль) и
// заглушка Keycloak (полная реализация — milestone 1, oid client). Если
// пользователь уже залогинен — beforeLoad перебрасывает в корень.
function LoginPage() {
  const navigate = useNavigate()
  const providers = useProviders()
  const me = useMe()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await login.mutateAsync({ username, password })
      await navigate({ to: '/' })
    } catch {
      // ошибка отображается через login.error ниже
    }
  }

  const localEnabled = providers.data?.local ?? true
  const keycloakEnabled = providers.data?.keycloak ?? false

  // Если пользователь уже залогинен (например, открыл /login во второй вкладке),
  // немедленно уезжаем на корень. beforeLoad решает только начальную загрузку,
  // a useMe может прислать обновление позже.
  useEffect(() => {
    if (me.data?.user) {
      void navigate({ to: '/' })
    }
  }, [me.data?.user, navigate])

  if (me.data?.user) {
    return (
      <main className="flex-1 grid place-items-center p-6">
        <p className="text-sm text-muted-foreground">Already signed in — redirecting…</p>
      </main>
    )
  }

  return (
    <main className="flex-1 grid place-items-center p-6">
      <section className="w-full max-w-md rounded-xl border border-border bg-muted p-6 shadcn">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose how to authenticate.</p>

        {keycloakEnabled ? (
          <div className="mt-4">
            <a href="/api/auth/keycloak/login" className="block">
              <Button className="w-full">Continue with Keycloak</Button>
            </a>
          </div>
        ) : null}

        {localEnabled ? (
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={onSubmit}
            aria-label="local-login-form"
          >
            <label className="flex flex-col gap-1 text-sm">
              <span>Username</span>
              <input
                type="text"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="rounded border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span>Password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            {login.error ? (
              <p className="text-sm text-destructive" role="alert">
                {login.error instanceof AuthError ? login.error.message : 'Login failed'}
              </p>
            ) : null}
            <Button type="submit" disabled={login.isPending} variant="secondary">
              {login.isPending ? 'Signing in…' : 'Continue with local account'}
            </Button>
          </form>
        ) : null}

        {!localEnabled && !keycloakEnabled ? (
          <p className="mt-4 text-sm text-destructive">
            No auth providers are enabled. Check server config.
          </p>
        ) : null}
      </section>
    </main>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/login',
  beforeLoad: async () => {
    // Если уже залогинены — отправляем на /. Используем кэш React Query как
    // источник истины, иначе делаем сетевой запрос (он быстрый и редкий).
    const cached = queryClient.getQueryData(authKeys.me())
    const me =
      cached === undefined
        ? await queryClient.fetchQuery({
            queryKey: authKeys.me(),
            queryFn: fetchMe,
          })
        : (cached as Awaited<ReturnType<typeof fetchMe>> | null)
    if (me?.user) {
      throw redirect({ to: '/' })
    }
  },
  component: LoginPage,
})
