import { useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { RailNav } from '../../kanban/components/RailNav'
import { readLastProject, useLastProject } from '../../kanban/useLastProject'
import { useProjects } from '../../projects'
import { usePatchIssueDates, useTimelineWindow } from '../hooks'
import { buildRows, defaultWindow, parseIsoDate, toIsoDate } from '../lib/geometry'
import type { TimelineBar, TimelineGroupBy, Zoom } from '../types'
import { Body } from './Body'
import { SubBar } from './SubBar'
import { TopBar } from './TopBar'

// Контейнер timeline-страницы. URL-search-state → TanStack Query.
// Project источник — единый /api/projects, тот же, что использует kanban'
// picker. Никаких Jira boards: проекты выбираются фуззи-поиском
// по key/name, kanban/timeline — наши UI-presentations поверх issues.
//
// Layout совпадает с KanbanPage: 48px rail + 44px TopBar + 36px SubBar + body.
// Это даёт визуальную консистентность shell'а между двумя view'ами при
// разном теле (колонки vs gantt-сетка).

type Search = {
  project?: string
  from?: string
  zoom?: Zoom
  group?: TimelineGroupBy
}

export function TimelinePage() {
  const navigate = useNavigate({ from: '/timeline' })
  const search = useSearch({ from: '/timeline' }) as Search
  const zoom: Zoom = search.zoom ?? '2w'
  const group: TimelineGroupBy = search.group ?? 'epic'

  const projectsQuery = useProjects()
  const projects = projectsQuery.data ?? []

  // Авто-выбор первого проекта (или последнего из localStorage).
  useLastProject(search.project ?? null)
  useEffect(() => {
    if (!search.project && projects.length > 0) {
      const last = readLastProject()
      const fallback = (last && projects.find((p) => p.id === last)?.id) ?? projects[0]!.id
      void navigate({
        search: (prev) => ({ ...prev, project: fallback }),
        replace: true,
      })
    }
  }, [navigate, projects, search.project])

  // Окно дат: from в URL → парсим, иначе today; to считаем из zoom.
  const anchor = useMemo(() => {
    if (search.from) {
      try {
        return parseIsoDate(search.from)
      } catch {
        // ignore, fallthrough
      }
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
  }, [search.from])

  const window = useMemo(() => defaultWindow(anchor, zoom), [anchor, zoom])

  const query =
    search.project != null
      ? {
          projectId: search.project,
          from: toIsoDate(window.from),
          to: toIsoDate(window.to),
          group,
        }
      : null
  const timeline = useTimelineWindow(query)
  const patch = usePatchIssueDates()

  const rows = useMemo(() => {
    if (!timeline.data) return { rows: [], groupCount: 0 }
    return buildRows(timeline.data.items, group)
  }, [timeline.data, group])

  const setSearch = (patch: Partial<Search>) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  }

  const handleBarClick = (bar: TimelineBar) => {
    void navigate({ to: '/issues/$key', params: { key: bar.key }, search: { from: '/timeline' } })
  }

  const handleBarCommit = (commit: {
    barId: string
    startDate: string | null
    dueDate: string | null
  }) => {
    // Передаём только изменённые поля, чтобы PATCH не сбрасывал чужие значения.
    const bar = timeline.data?.items.find((b) => b.id === commit.barId)
    if (!bar) return
    const input: { keyOrId: string; startDate?: string | null; dueDate?: string | null } = {
      keyOrId: bar.key,
    }
    if (commit.startDate !== bar.startDate) input.startDate = commit.startDate
    if (commit.dueDate !== bar.dueDate) input.dueDate = commit.dueDate
    patch.mutate(input)
  }

  const isLoading = timeline.isFetching || patch.isPending

  return (
    <div className="grid h-screen w-screen grid-cols-[48px_1fr] bg-[color:var(--background)]">
      <RailNav />

      <main className="grid min-w-0 grid-rows-[44px_36px_1fr]">
        <TopBar
          projects={projects}
          projectId={search.project ?? null}
          isLoading={isLoading}
          onProjectChange={(id) => setSearch({ project: id })}
        />
        <SubBar
          group={group}
          zoom={zoom}
          isRefreshing={isLoading}
          onGroupChange={(g) => setSearch({ group: g })}
          onZoomChange={(z) => setSearch({ zoom: z })}
          onGoToday={() => setSearch({ from: undefined })}
          onRefresh={() => void timeline.refetch()}
        />

        {!search.project ? (
          <Centered>
            {projectsQuery.isLoading
              ? 'Loading projects…'
              : projects.length === 0
                ? 'No projects mirrored yet — run a full sync from /admin/sync.'
                : 'Pick a project above.'}
          </Centered>
        ) : timeline.error ? (
          <Centered tone="destructive">
            Failed to load timeline:{' '}
            {timeline.error instanceof Error ? timeline.error.message : 'unknown'}
          </Centered>
        ) : timeline.isLoading || !timeline.data ? (
          <Centered>Loading bars…</Centered>
        ) : rows.rows.length === 0 ? (
          <Centered>No issues with dates in this window.</Centered>
        ) : (
          <Body
            rows={rows.rows}
            windowFrom={window.from}
            windowTo={window.to}
            zoom={zoom}
            onBarClick={handleBarClick}
            onBarCommit={handleBarCommit}
          />
        )}
      </main>
    </div>
  )
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'destructive' }) {
  return (
    <div
      className={
        tone === 'destructive'
          ? 'flex h-full items-center justify-center text-sm text-[color:var(--state-error)]'
          : 'flex h-full items-center justify-center text-sm text-[color:var(--text-tertiary)]'
      }
    >
      {children}
    </div>
  )
}
