import { createRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Button } from '@ui/button'
import { type FormEvent, useState } from 'react'
import { AppShell } from '../components/AppShell'
import {
  AuthError,
  authKeys,
  fetchMe,
  useAttachPat,
  useLogout,
  useMe,
  usePatStatus,
  useRemovePat,
  useTestPat,
} from '../features/auth'
import { queryClient } from '../lib/query-client'
import { Route as RootRoute } from './__root'

// /settings/jira — gate-страница. Пока PAT не привязан, остальная часть
// приложения недоступна; маршрут / редиректит сюда.
function SettingsJiraPage() {
  const navigate = useNavigate()
  const me = useMe()
  const pat = usePatStatus()
  const attach = useAttachPat()
  const remove = useRemovePat()
  const test = useTestPat()
  const logout = useLogout()
  const [token, setToken] = useState('')

  async function onAttach(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    try {
      await attach.mutateAsync(token)
      setToken('')
      // После успешного attach перебрасываем на корень.
      await navigate({ to: '/' })
    } catch {
      // ошибка отрисуется через attach.error
    }
  }

  async function onLogout() {
    await logout.mutateAsync()
    await navigate({ to: '/login' })
  }

  return (
    <main className="flex-1 grid place-items-center overflow-auto p-6">
      <section className="w-full max-w-xl rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6 space-y-4">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Connect Jira</h1>
            <p className="text-sm text-muted-foreground">
              {me.data?.user ? `Signed in as ${me.data.user.displayName}.` : 'Loading user…'}
            </p>
          </div>
          <Button variant="ghost" onClick={onLogout} disabled={logout.isPending}>
            Sign out
          </Button>
        </header>

        {pat.data?.attached ? (
          <div className="rounded-lg border border-border p-4 space-y-3">
            <div className="text-sm">
              <div className="font-medium">
                Connected as {pat.data.jiraDisplayName ?? 'Jira user'}
              </div>
              {pat.data.lastUsedAt ? (
                <div className="text-muted-foreground">
                  Last used: {new Date(pat.data.lastUsedAt).toLocaleString()}
                </div>
              ) : null}
              {pat.data.needsReattach ? (
                <div className="text-destructive">PAT was rejected by Jira — please re-attach.</div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => test.mutate()} disabled={test.isPending} variant="secondary">
                {test.isPending ? 'Testing…' : 'Test connection'}
              </Button>
              <Button onClick={() => remove.mutate()} disabled={remove.isPending} variant="ghost">
                Remove
              </Button>
              <Button onClick={() => navigate({ to: '/' })} variant="ghost">
                Continue
              </Button>
            </div>
            {test.data ? (
              <p className="text-sm text-muted-foreground">
                {test.data.ok ? `OK — ${test.data.jiraDisplayName}` : 'Jira rejected the token.'}
              </p>
            ) : null}
          </div>
        ) : (
          <form className="space-y-3" onSubmit={onAttach} aria-label="attach-pat-form">
            <label className="flex flex-col gap-1 text-sm">
              <span>Personal Access Token (Jira)</span>
              <input
                type="password"
                required
                minLength={8}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="rounded border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-primary"
                placeholder="paste your Jira PAT"
              />
            </label>
            {attach.error ? (
              <p className="text-sm text-destructive" role="alert">
                {attach.error instanceof AuthError ? attach.error.message : 'Attach failed'}
              </p>
            ) : null}
            <Button type="submit" disabled={attach.isPending || token.length < 8}>
              {attach.isPending ? 'Validating…' : 'Attach PAT'}
            </Button>
            <p className="text-xs text-muted-foreground">
              We validate the token against <code>/rest/api/2/myself</code> and store it encrypted
              (AES-GCM, envelope-wrapped). The plaintext PAT never lands in logs.
            </p>
          </form>
        )}
      </section>
    </main>
  )
}

function SettingsJiraRoute() {
  return (
    <AppShell>
      <SettingsJiraPage />
    </AppShell>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/settings/jira',
  beforeLoad: async () => {
    const cached = queryClient.getQueryData(authKeys.me())
    const me =
      cached === undefined
        ? await queryClient.fetchQuery({
            queryKey: authKeys.me(),
            queryFn: fetchMe,
          })
        : (cached as Awaited<ReturnType<typeof fetchMe>> | null)
    if (!me?.user) {
      throw redirect({ to: '/login' })
    }
  },
  component: SettingsJiraRoute,
})
