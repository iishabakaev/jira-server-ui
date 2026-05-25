import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createRoute, redirect } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { AppShell } from '../components/AppShell'
import { authKeys, fetchMe } from '../features/auth'
import { api } from '../lib/eden'
import { queryClient } from '../lib/query-client'
import { Route as RootRoute } from './__root'

// /admin/sync — read-only админ-страница со сводом здоровья синхронизации
// плюс per-project toggle «syncEnabled». Источник правды — единый endpoint
// /api/sync/admin (см. modules/sync/routes.ts); триггер full-sync вызывает
// существующий POST /api/sync/projects/:id/full-sync, а toggle —
// PATCH /api/sync/projects/:id.

type SyncAdminProject = {
  id: string
  key: string
  name: string
  lastUpdatedAt: string | null
  lastFullSyncAt: string | null
  lastRunId: string | null
  syncEnabled: boolean
}

type SyncAdminResponse = {
  projects: SyncAdminProject[]
  outbox: {
    pending: number
    inFlight: number
    done: number
    error: number
    dead: number
  }
  webhookInbox: {
    unprocessed: number
    stuck: number
    withError: number
    lastReceivedAt: string | null
    lastProcessedAt: string | null
    lastError: string | null
    lastErrorAt: string | null
  }
  conflicts: {
    unresolved: number
    lastCreatedAt: string | null
  }
}

const adminSyncKeys = {
  status: ['admin-sync', 'status'] as const,
}

async function fetchAdminSyncStatus(): Promise<SyncAdminResponse> {
  const res = await api.api.sync.admin.get()
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new Error(inner?.message ?? 'Failed to load admin sync status')
  }
  if (res.data === null) throw new Error('Empty admin sync response')
  return res.data as SyncAdminResponse
}

async function triggerFullSync(projectId: string): Promise<void> {
  const res = await api.api.sync.projects({ id: projectId })['full-sync'].post()
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new Error(inner?.message ?? 'Failed to trigger full sync')
  }
}

async function setSyncEnabled(projectId: string, enabled: boolean): Promise<void> {
  const res = await api.api.sync.projects({ id: projectId }).patch({ syncEnabled: enabled })
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new Error(inner?.message ?? 'Failed to update sync setting')
  }
}

async function refreshMetadata(): Promise<void> {
  const res = await api.api.sync['refresh-metadata'].post()
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new Error(inner?.message ?? 'Failed to enqueue refresh-metadata')
  }
}

async function bulkSetSyncEnabled(enabled: boolean, projectIds?: string[]): Promise<number> {
  const body: { syncEnabled: boolean; projectIds?: string[] } = { syncEnabled: enabled }
  if (projectIds && projectIds.length > 0) body.projectIds = projectIds
  const res = await api.api.sync['projects-bulk'].patch(body)
  if (res.error) {
    const err = res.error as { value?: { error?: { code?: string; message?: string } } }
    const inner = err.value?.error
    throw new Error(inner?.message ?? 'Failed to update sync setting')
  }
  return (res.data?.affected as number | undefined) ?? 0
}

// Зафиксированный locale — иначе админ-страница рендерит даты по-разному
// в браузерах с разными настройками, что мешает копировать строки в
// тикеты / общаться между админами одного инстанса.
const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
})

function formatDate(value: string | null): string {
  if (!value) return '—'
  return DATE_FORMATTER.format(new Date(value))
}

function AdminSyncPage() {
  const qc = useQueryClient()
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: adminSyncKeys.status,
    queryFn: fetchAdminSyncStatus,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  })
  const [queuedAt, setQueuedAt] = useState<Record<string, number>>({})
  // Локальный поиск по проектам. Сравниваем case-insensitive по key и name —
  // дополнительной debounce-обвязки не нужно, фильтрация идёт по уже
  // загруженному массиву (нет сетевых запросов).
  const [search, setSearch] = useState('')
  const trigger = useMutation({
    mutationFn: (projectId: string) => triggerFullSync(projectId),
    onSuccess: (_data, projectId) => {
      setQueuedAt((prev) => ({ ...prev, [projectId]: Date.now() }))
      void qc.invalidateQueries({ queryKey: adminSyncKeys.status })
    },
  })

  // Ручной запуск refresh-metadata — единственный способ заселить таблицу
  // projects из Jira без ожидания hourly-cron'а. После успеха инвалидируем
  // sync-admin, чтобы новые проекты появились в списке без F5.
  const refreshMeta = useMutation({
    mutationFn: refreshMetadata,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminSyncKeys.status })
    },
  })

  // Bulk-toggle: применяет включение/выключение sync ко всем (или к
  // отфильтрованному search'ем подмножеству) проектов одним запросом.
  // Сразу отображаем серверный affected-счётчик ниже шапки.
  const bulkToggle = useMutation({
    mutationFn: ({ enabled, projectIds }: { enabled: boolean; projectIds?: string[] }) =>
      bulkSetSyncEnabled(enabled, projectIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminSyncKeys.status })
    },
  })

  // Тоггл per-project sync. Оптимистично применяем UI-состояние, чтобы
  // чекбокс не «прыгал» во время round-trip'а в БД.
  const toggleSync = useMutation({
    mutationFn: ({ projectId, enabled }: { projectId: string; enabled: boolean }) =>
      setSyncEnabled(projectId, enabled),
    onMutate: async ({ projectId, enabled }) => {
      await qc.cancelQueries({ queryKey: adminSyncKeys.status })
      const previous = qc.getQueryData<SyncAdminResponse>(adminSyncKeys.status)
      if (previous) {
        qc.setQueryData<SyncAdminResponse>(adminSyncKeys.status, {
          ...previous,
          projects: previous.projects.map((p) =>
            p.id === projectId ? { ...p, syncEnabled: enabled } : p,
          ),
        })
      }
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(adminSyncKeys.status, ctx.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminSyncKeys.status })
    },
  })

  useEffect(() => {
    const earliest = Object.values(queuedAt).reduce(
      (m, v) => (v < m ? v : m),
      Number.POSITIVE_INFINITY,
    )
    if (!Number.isFinite(earliest)) return
    const wait = Math.max(0, 2_000 - (Date.now() - earliest))
    const id = setTimeout(() => {
      setQueuedAt((prev) => {
        const next: Record<string, number> = {}
        const cutoff = Date.now() - 2_000
        for (const [k, v] of Object.entries(prev)) {
          if (v > cutoff) next[k] = v
        }
        return next
      })
    }, wait + 50)
    return () => clearTimeout(id)
  }, [queuedAt])

  const enabledCount = data?.projects.filter((p) => p.syncEnabled).length ?? 0
  const totalCount = data?.projects.length ?? 0
  // Поиск делаем дешёвый — substring match по key/name. Если строка пустая,
  // возвращаем весь список без аллокации нового массива.
  const filteredProjects = (() => {
    if (!data?.projects) return []
    const needle = search.trim().toLowerCase()
    if (!needle) return data.projects
    return data.projects.filter(
      (p) => p.key.toLowerCase().includes(needle) || p.name.toLowerCase().includes(needle),
    )
  })()

  return (
    <main className="flex-1 overflow-auto p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sync status</h1>
          <p className="text-sm text-[color:var(--text-tertiary)]">
            Outbox, webhook health, и per-project курсоры синхронизации.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refreshMeta.mutate()}
            disabled={refreshMeta.isPending}
            title="Re-discover projects, issue types, statuses and other reference data from Jira"
            className="rounded border border-[color:var(--accent)] bg-[color:var(--accent-tint)] px-3 py-1 text-sm text-[color:var(--accent)] hover:bg-[color:var(--accent-tint-strong)] disabled:opacity-50"
          >
            {refreshMeta.isPending ? 'Pulling from Jira…' : 'Refresh projects from Jira'}
          </button>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded border border-[color:var(--border)] px-3 py-1 text-sm hover:bg-[color:var(--surface)] disabled:opacity-50"
          >
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {refreshMeta.error ? (
        <p role="alert" className="mb-4 text-sm text-[color:var(--state-error)]">
          {(refreshMeta.error as Error).message}
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-[color:var(--text-tertiary)]">Loading…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-[color:var(--state-error)]">
          {(error as Error).message}
        </p>
      ) : data ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section
            aria-label="Outbox queue"
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
          >
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
              Outbox queue
            </h2>
            <dl className="grid grid-cols-5 gap-2 text-center text-sm">
              <OutboxStat label="Pending" value={data.outbox.pending} />
              <OutboxStat label="In flight" value={data.outbox.inFlight} />
              <OutboxStat label="Done" value={data.outbox.done} tone="success" />
              <OutboxStat label="Error" value={data.outbox.error} tone="error" />
              <OutboxStat label="Dead" value={data.outbox.dead} tone="error" />
            </dl>
          </section>

          <section
            aria-label="Webhook health"
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4"
          >
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
              Webhook inbox
            </h2>
            <dl className="grid grid-cols-3 gap-2 text-center text-sm">
              <OutboxStat label="Unprocessed" value={data.webhookInbox.unprocessed} />
              <OutboxStat
                label="Stuck (≥10 tries)"
                value={data.webhookInbox.stuck}
                tone={data.webhookInbox.stuck > 0 ? 'error' : 'default'}
              />
              <OutboxStat
                label="With error"
                value={data.webhookInbox.withError}
                tone={data.webhookInbox.withError > 0 ? 'error' : 'default'}
              />
            </dl>
            <dl className="mt-3 grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="text-[color:var(--text-tertiary)]">Last received</dt>
              <dd>{formatDate(data.webhookInbox.lastReceivedAt)}</dd>
              <dt className="text-[color:var(--text-tertiary)]">Last processed</dt>
              <dd>{formatDate(data.webhookInbox.lastProcessedAt)}</dd>
              {data.webhookInbox.lastError ? (
                <>
                  <dt className="text-[color:var(--text-tertiary)]">Last error</dt>
                  <dd className="break-words text-[color:var(--state-error)]">
                    {data.webhookInbox.lastError}{' '}
                    <span className="text-[color:var(--text-tertiary)]">
                      ({formatDate(data.webhookInbox.lastErrorAt)})
                    </span>
                  </dd>
                </>
              ) : null}
            </dl>
          </section>

          <section
            aria-label="Write conflicts"
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 lg:col-span-2"
          >
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
              Write conflicts
            </h2>
            <dl className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-xs uppercase tracking-wide text-[color:var(--text-tertiary)]">
                Unresolved
              </dt>
              <dd
                className={
                  data.conflicts.unresolved > 0
                    ? 'font-semibold text-[color:var(--state-error)]'
                    : 'text-foreground'
                }
              >
                {data.conflicts.unresolved}
              </dd>
              <dt className="text-xs uppercase tracking-wide text-[color:var(--text-tertiary)]">
                Last conflict at
              </dt>
              <dd>{formatDate(data.conflicts.lastCreatedAt)}</dd>
            </dl>
            {data.conflicts.unresolved > 0 ? (
              <p className="mt-2 text-xs text-[color:var(--text-tertiary)]">
                Resolve via the (forthcoming) /admin/conflicts page or by re-syncing the affected
                issue.
              </p>
            ) : null}
          </section>

          <section
            aria-label="Projects"
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4 lg:col-span-2"
          >
            <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium uppercase tracking-wide text-[color:var(--text-tertiary)]">
                  Projects
                </h2>
                <span className="text-xs text-[color:var(--text-tertiary)]">
                  Sync enabled: {enabledCount}/{totalCount}
                  {search ? ` · matching “${search}”: ${filteredProjects.length}` : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by key or name…"
                  className="h-7 w-56 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-2.5 text-xs outline-none focus:border-[color:var(--accent)]"
                  aria-label="Search projects"
                />
                <button
                  type="button"
                  onClick={() =>
                    bulkToggle.mutate({
                      enabled: true,
                      projectIds: search ? filteredProjects.map((p) => p.id) : undefined,
                    })
                  }
                  disabled={bulkToggle.isPending || filteredProjects.length === 0}
                  title={
                    search
                      ? `Enable sync for ${filteredProjects.length} filtered project(s)`
                      : 'Enable sync for all projects'
                  }
                  className="rounded border border-[color:var(--accent)] bg-[color:var(--accent-tint)] px-2.5 py-1 text-xs font-medium text-[color:var(--accent)] hover:bg-[color:var(--accent-tint-strong)] disabled:opacity-50"
                >
                  {bulkToggle.isPending && bulkToggle.variables?.enabled
                    ? 'Enabling…'
                    : search
                      ? `Enable shown (${filteredProjects.length})`
                      : 'Enable sync for all'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    bulkToggle.mutate({
                      enabled: false,
                      projectIds: search ? filteredProjects.map((p) => p.id) : undefined,
                    })
                  }
                  disabled={bulkToggle.isPending || filteredProjects.length === 0}
                  title={
                    search
                      ? `Disable sync for ${filteredProjects.length} filtered project(s)`
                      : 'Disable sync for all projects'
                  }
                  className="rounded border border-[color:var(--border)] px-2.5 py-1 text-xs font-medium text-[color:var(--text-secondary)] hover:border-[color:var(--state-error)] hover:text-[color:var(--state-error)] disabled:opacity-50"
                >
                  {bulkToggle.isPending && bulkToggle.variables?.enabled === false
                    ? 'Disabling…'
                    : search
                      ? `Disable shown (${filteredProjects.length})`
                      : 'Stop sync for all'}
                </button>
              </div>
            </header>
            <p className="mb-3 text-xs text-[color:var(--text-tertiary)]">
              Sync is off by default — toggle the Sync column to pick which Jira projects this
              instance keeps in sync. Disabled projects are skipped by the incremental fan-out;
              existing rows stay.
            </p>
            {bulkToggle.data !== undefined && !bulkToggle.isPending ? (
              <p className="mb-3 text-xs text-[color:var(--text-tertiary)]">
                Last bulk action affected {bulkToggle.data} project(s).
              </p>
            ) : null}
            {bulkToggle.error ? (
              <p role="alert" className="mb-3 text-xs text-[color:var(--state-error)]">
                {(bulkToggle.error as Error).message}
              </p>
            ) : null}
            {data.projects.length === 0 ? (
              <div className="rounded-md border border-dashed border-[color:var(--border)] p-4 text-sm text-[color:var(--text-tertiary)]">
                <p className="mb-1 font-medium text-[color:var(--text-secondary)]">
                  No projects discovered yet.
                </p>
                <p>
                  Projects are populated by the <code>refresh-metadata</code> job (runs hourly). Hit
                  <span className="font-medium text-[color:var(--text-primary)]">
                    {' '}
                    “Refresh projects from Jira”
                  </span>{' '}
                  above to pull them now — afterwards toggle the Sync checkbox to pick which
                  projects should keep syncing.
                </p>
              </div>
            ) : filteredProjects.length === 0 ? (
              <p className="rounded-md border border-dashed border-[color:var(--border)] p-3 text-sm text-[color:var(--text-tertiary)]">
                No projects match “{search}”.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--border)] text-left text-xs uppercase tracking-wide text-[color:var(--text-tertiary)]">
                    <th className="py-2 pr-3">Sync</th>
                    <th className="py-2 pr-3">Key</th>
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Last incremental</th>
                    <th className="py-2 pr-3">Last full sync</th>
                    <th className="py-2 pr-3">Last run id</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {filteredProjects.map((p) => (
                    <tr key={p.id} className="border-b border-[color:var(--border)]/40">
                      <td className="py-2 pr-3">
                        <label className="inline-flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={p.syncEnabled}
                            disabled={toggleSync.isPending}
                            onChange={(e) =>
                              toggleSync.mutate({
                                projectId: p.id,
                                enabled: e.target.checked,
                              })
                            }
                            className="size-3.5 rounded border-[color:var(--border)] accent-[color:var(--accent)]"
                            aria-label={`Sync ${p.key}`}
                          />
                          <span
                            className={
                              p.syncEnabled
                                ? 'text-[10.5px] uppercase tracking-wide text-[color:var(--accent)]'
                                : 'text-[10.5px] uppercase tracking-wide text-[color:var(--text-tertiary)]'
                            }
                          >
                            {p.syncEnabled ? 'On' : 'Off'}
                          </span>
                        </label>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{p.key}</td>
                      <td className="py-2 pr-3">{p.name}</td>
                      <td className="py-2 pr-3">{formatDate(p.lastUpdatedAt)}</td>
                      <td className="py-2 pr-3">{formatDate(p.lastFullSyncAt)}</td>
                      <td className="py-2 pr-3 font-mono text-xs text-[color:var(--text-tertiary)]">
                        {p.lastRunId ?? '—'}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => trigger.mutate(p.id)}
                          disabled={trigger.isPending || !p.syncEnabled}
                          title={
                            !p.syncEnabled
                              ? 'Enable sync first'
                              : 'Run a full backfill for this project'
                          }
                          className="rounded border border-[color:var(--border)] px-2 py-1 text-xs hover:bg-[color:var(--surface-hover)] disabled:opacity-50"
                        >
                          {trigger.isPending && trigger.variables === p.id
                            ? 'Triggering…'
                            : queuedAt[p.id]
                              ? 'Queued ✓'
                              : 'Trigger full sync'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {trigger.error ? (
              <p role="alert" className="mt-2 text-xs text-[color:var(--state-error)]">
                {(trigger.error as Error).message}
              </p>
            ) : null}
            {toggleSync.error ? (
              <p role="alert" className="mt-2 text-xs text-[color:var(--state-error)]">
                {(toggleSync.error as Error).message}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </main>
  )
}

interface OutboxStatProps {
  label: string
  value: number
  tone?: 'default' | 'success' | 'error'
}

function OutboxStat({ label, value, tone = 'default' }: OutboxStatProps) {
  const toneClass =
    tone === 'success'
      ? 'text-emerald-500'
      : tone === 'error'
        ? 'text-[color:var(--state-error)]'
        : 'text-foreground'
  return (
    <div className="rounded border border-[color:var(--border)]/40 bg-[color:var(--surface-elev)] p-2">
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="text-xs uppercase tracking-wide text-[color:var(--text-tertiary)]">
        {label}
      </div>
    </div>
  )
}

function AdminSyncRoute() {
  return (
    <AppShell>
      <AdminSyncPage />
    </AppShell>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/admin/sync',
  beforeLoad: async () => {
    const cached = queryClient.getQueryData(authKeys.me())
    const me =
      cached === undefined
        ? await queryClient.fetchQuery({ queryKey: authKeys.me(), queryFn: fetchMe })
        : (cached as Awaited<ReturnType<typeof fetchMe>> | null)
    if (!me?.user) throw redirect({ to: '/login' })
    if (!me.user.roles.includes('app_admin')) {
      throw redirect({ to: '/' })
    }
  },
  component: AdminSyncRoute,
})
