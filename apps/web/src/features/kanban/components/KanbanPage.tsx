import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { useMe } from '../../auth'
import { useProjects } from '../../projects'
import { QuickCreateProvider, useQuickCreateUi } from '../../quick-create'
import type { KanbanQuery, ProjectKanbanColumn } from '../api'
import { classifyIssueType } from '../hierarchy'
import { kanbanKeys, useProjectKanban } from '../hooks'
import { useKanbanUi } from '../store'
import type { Density, IssueSummary } from '../types'
import { useKanbanDnd } from '../useKanbanDnd'
import { readLastProject, useLastProject } from '../useLastProject'
import { type ChipKey, ChipRow } from './ChipRow'
import { Column } from './Column'
import { RailNav } from './RailNav'
import { type GroupBy, type Layout, SubBar } from './SubBar'
import { Swimlane, type SwimlaneRollupBucket } from './Swimlane'
import { TopBar } from './TopBar'

// KanbanPage — корневой layout ALFAIAAS. Структура:
//   ┌ rail (48) ┬ topbar (44) ────────────┐
//   │           ├ subbar (36) ────────────┤
//   │           ├ chiprow (32) ───────────┤
//   │           └ board (свимлейны/колонки)
//   └───────────┴─────────────────────────┘
// Серверный groupBy управляет первой осью группировки (columns), но
// для эстетики design'а из спецификации мы также группируем визуально
// по эпикам в режиме client-side swimlane: если groupBy === 'status',
// рисуем плоские колонки; иначе сервер уже делит на колонки по
// эпику/assignee/priority, и мы их рендерим как swimlanes без вложенных
// status-колонок (M-следующее: вложенный grid columns×swimlanes).

type KanbanSearch = {
  project?: string
  group?: GroupBy
  density?: Density
  text?: string
  hideDone?: boolean
  layout?: Layout
  filters?: string
}

export function KanbanPage() {
  const navigate = useNavigate({ from: '/kanban' })
  const navigateRouter = useNavigate()
  const location = useLocation()
  const search = useSearch({ from: '/kanban' }) as KanbanSearch
  const projects = useProjects()
  const me = useMe()
  const selected = useKanbanUi((s) => s.selected)

  const groupBy: GroupBy = search.group ?? 'status'
  const density: Density = search.density ?? 'comfortable'
  const text = search.text ?? ''
  const hideDone = search.hideDone ?? false
  const layout: Layout = search.layout ?? 'board'
  const projectId = search.project ?? null

  // Локальные UI-only chip-filters; URL-параметр держим отдельно от
  // структурных search-полей.
  const [activeChips, setActiveChips] = useState<Set<ChipKey>>(
    () => new Set((search.filters ?? '').split(',').filter(Boolean) as ChipKey[]),
  )
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showSubtasks, setShowSubtasks] = useState(false)

  useLastProject(projectId)

  useEffect(() => {
    if (!projectId && projects.data && projects.data.length > 0) {
      // Восстанавливаем последний выбранный проект из localStorage, если он
      // всё ещё существует в списке. Иначе — первый по алфавиту.
      const last = readLastProject()
      const fallback =
        (last && projects.data.find((p) => p.id === last)?.id) ?? projects.data[0]!.id
      void navigate({
        search: (prev) => ({ ...prev, project: fallback }),
        replace: true,
      })
    }
  }, [projectId, projects.data, navigate])

  const query: KanbanQuery = useMemo(() => {
    const q: KanbanQuery = { groupBy, limit: 200 }
    if (text.trim().length >= 2) q.text = text.trim()
    if (hideDone) q.statusCategories = ['new', 'indeterminate']
    return q
  }, [groupBy, text, hideDone])

  const data = useProjectKanban(projectId, query)
  const dndQueryKey = projectId ? kanbanKeys.data(projectId, query) : ['kanban', 'data', 'noop']
  const dnd = useKanbanDnd(projectId, dndQueryKey)

  const openQuickCreate = useQuickCreateUi((s) => s.openDialog)
  // Кнопку «+ New» разблокируем как только выбран проект: даже если
  // refresh-metadata ещё не подтянул issue-types, диалог сам покажет
  // дружественное сообщение «No issue types cached yet — run
  // refresh-metadata first» вместо безмолвно неактивной кнопки.
  const canQuickCreate = Boolean(projectId)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  const setSearch = (patch: Partial<KanbanSearch>) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  }

  const onChipToggle = (k: ChipKey) => {
    setActiveChips((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      setSearch({ filters: next.size ? Array.from(next).join(',') : undefined })
      return next
    })
  }

  const onToggleSwimlane = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const columns = data.data
    ? data.data.other
      ? [...data.data.columns, data.data.other]
      : data.data.columns
    : []

  // Применяем chip-фильтры клиентски — серверу пока не отдаём.
  const myAccountId = me.data?.user.jiraAccountId ?? null
  const filterIssue = (i: IssueSummary): boolean => {
    // Сабтаски по умолчанию скрыты на kanban'е, как в Jira. Тоггл
    // «Show subtasks» снимает фильтр и сабтаски появляются в своих колонках.
    // Иерархия: Epic → Task → Process / Change Task (subtask). Process/Change
    // относим к сабтаскам, даже если в Jira-инстансе issue_types.subtask=false
    // — это позволяет UI-уровню оставаться источником правды для группировок.
    if (!showSubtasks) {
      const level = classifyIssueType(i.issueTypeName)
      if (i.isSubtask || level === 'subtask') return false
    }
    if (activeChips.has('mine')) {
      // Без привязанного PAT мы не знаем accountId — chip остаётся видимым,
      // но не фильтрует ничего; пользователь увидит пустую доску и поймёт,
      // что нужно привязать PAT.
      if (!myAccountId || i.assigneeId !== myAccountId) return false
    }
    if (activeChips.has('unassigned') && i.assigneeId) return false
    if (
      activeChips.has('high-priority') &&
      i.priorityName !== 'High' &&
      i.priorityName !== 'Highest'
    )
      return false
    if (activeChips.has('bugs') && i.issueTypeName?.toLowerCase() !== 'bug') return false
    if (activeChips.has('syncing') && i.syncState === 'synced') return false
    if (activeChips.has('due-week')) {
      // "Due this week" — карточка с dueDate в окне [сегодня, сегодня+7).
      if (!i.dueDate) return false
      const due = new Date(`${i.dueDate}T00:00:00`)
      const now = new Date()
      now.setHours(0, 0, 0, 0)
      const cutoff = new Date(now)
      cutoff.setDate(cutoff.getDate() + 7)
      if (due < now || due >= cutoff) return false
    }
    return true
  }

  const filteredColumns = columns.map((c) => ({ ...c, items: c.items.filter(filterIssue) }))

  // rollup-полоска: цвет по category, ширина пропорциональна количеству.
  const buildRollup = (cols: ProjectKanbanColumn[]): SwimlaneRollupBucket[] =>
    cols.map((c) => ({
      label: c.name,
      value: c.items.length,
      color:
        c.statusCategory === 'done'
          ? 'oklch(62% 0.16 145)'
          : c.statusCategory === 'new'
            ? 'oklch(60% 0.08 260)'
            : 'oklch(72% 0.16 80)',
    }))

  return (
    <div className="grid h-screen w-screen grid-cols-[48px_1fr] bg-[color:var(--background)]">
      <RailNav />

      <main className="grid min-w-0 grid-rows-[44px_36px_32px_1fr]">
        <TopBar
          projects={projects.data ?? []}
          projectId={projectId}
          text={text}
          isLoading={data.isFetching || projects.isLoading || dnd.isMutating}
          canQuickCreate={canQuickCreate}
          currentSearch={search as Record<string, string | boolean | undefined>}
          onProjectChange={(id) => setSearch({ project: id })}
          onTextChange={(s) => setSearch({ text: s || undefined })}
          onQuickCreate={() => openQuickCreate(projectId)}
          onApplyView={(view) => {
            // Применяем сохранённый view: целиком заменяем search-state
            // на то, что сохранили. При необходимости в дальнейшем — replace=false,
            // чтобы оставить шаг в браузерной истории.
            void navigate({
              search: () => view.search as KanbanSearch,
              replace: true,
            })
          }}
        />
        <SubBar
          groupBy={groupBy}
          density={density}
          layout={layout}
          showSubtasks={showSubtasks}
          isRefreshing={data.isFetching}
          hideDone={hideDone}
          onGroupByChange={(g) => setSearch({ group: g })}
          onDensityChange={(d) => setSearch({ density: d })}
          onLayoutChange={(l) => setSearch({ layout: l })}
          onToggleSubtasks={() => setShowSubtasks((v) => !v)}
          onHideDoneChange={(b) => setSearch({ hideDone: b || undefined })}
          onRefresh={() => void data.refetch()}
        />
        <ChipRow active={activeChips} onToggle={onChipToggle} />

        <div className="board relative min-h-0 overflow-auto px-3.5 pb-6 pt-2">
          {!projectId ? (
            <Centered>
              {projects.isLoading
                ? 'Loading projects…'
                : projects.data && projects.data.length === 0
                  ? 'No projects mirrored yet — run a full sync from /admin/sync.'
                  : 'Pick a project above.'}
            </Centered>
          ) : data.error ? (
            <Centered tone="destructive">
              Failed to load kanban: {data.error instanceof Error ? data.error.message : 'unknown'}
            </Centered>
          ) : data.isLoading || !data.data ? (
            <SkeletonBoard density={density} />
          ) : filteredColumns.length === 0 ? (
            <Centered>No issues match the current filters.</Centered>
          ) : layout === 'list' ? (
            <ListLayout
              columns={filteredColumns}
              groupBy={groupBy}
              onCardClick={(issue) => {
                void navigateRouter({
                  to: '/issues/$key',
                  params: { key: issue.key },
                  search: { from: location.href },
                })
              }}
            />
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragEnd={dnd.handleDragEnd}
            >
              {groupBy === 'status' ? (
                <FlatBoard
                  columns={filteredColumns}
                  density={density}
                  selectedIds={selected}
                  onCardClick={(issue) => {
                    void navigateRouter({
                      to: '/issues/$key',
                      params: { key: issue.key },
                      search: { from: location.href },
                    })
                  }}
                />
              ) : (
                <SwimlaneBoard
                  columns={filteredColumns}
                  density={density}
                  selectedIds={selected}
                  collapsed={collapsed}
                  rollup={buildRollup(filteredColumns)}
                  onToggle={onToggleSwimlane}
                  onCardClick={(issue) => {
                    void navigateRouter({
                      to: '/issues/$key',
                      params: { key: issue.key },
                      search: { from: location.href },
                    })
                  }}
                />
              )}
            </DndContext>
          )}
        </div>
      </main>

      <QuickCreateProvider projectId={projectId} />
    </div>
  )
}

function ListLayout({
  columns,
  groupBy,
  onCardClick,
}: {
  columns: ProjectKanbanColumn[]
  groupBy: GroupBy
  onCardClick: (issue: IssueSummary) => void
}) {
  // Плоский список — табличный вид с группировкой по тому же измерению,
  // что и колонки. Внутри группы сортируем по rank → key, чтобы порядок
  // был стабильным между рендерами.
  const groups = columns.map((c) => ({
    name: c.name,
    items: [...c.items].sort((a, b) => {
      if (a.orderingRank && b.orderingRank) return a.orderingRank.localeCompare(b.orderingRank)
      if (a.orderingRank) return -1
      if (b.orderingRank) return 1
      return a.key.localeCompare(b.key)
    }),
  }))

  return (
    <div className="flex flex-col gap-4 pb-3">
      {groups.map((g) => (
        <div key={g.name} className="rounded-md border border-[color:var(--border)]">
          <header className="flex items-center gap-2 border-b border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[color:var(--text-secondary)]">
            <span className="truncate">{g.name}</span>
            <span className="text-[color:var(--text-tertiary)]">· {g.items.length}</span>
          </header>
          <ul className="divide-y divide-[color:var(--border)]">
            {g.items.map((issue) => (
              <li key={issue.id}>
                <button
                  type="button"
                  onClick={() => onCardClick(issue)}
                  className="grid w-full grid-cols-[80px_1fr_140px_140px_100px] items-center gap-3 px-3 py-1.5 text-left text-[12.5px] hover:bg-[color:var(--surface)]"
                >
                  <span className="font-mono text-[11.5px] text-[color:var(--text-tertiary)]">
                    {issue.key}
                  </span>
                  <span className="truncate text-[color:var(--text-primary)]">{issue.summary}</span>
                  <span className="truncate text-[color:var(--text-secondary)]">
                    {issue.statusName}
                  </span>
                  <span className="truncate text-[color:var(--text-secondary)]">
                    {issue.assigneeDisplayName ?? (
                      <em className="text-[color:var(--text-tertiary)]">Unassigned</em>
                    )}
                  </span>
                  <span className="truncate text-[color:var(--text-secondary)]">
                    {issue.priorityName ?? '—'}
                  </span>
                </button>
              </li>
            ))}
            {g.items.length === 0 && (
              <li className="px-3 py-2 text-[12px] italic text-[color:var(--text-tertiary)]">
                {groupBy === 'status' ? 'No issues in this status.' : 'No issues.'}
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  )
}

function FlatBoard({
  columns,
  density,
  selectedIds,
  onCardClick,
}: {
  columns: ProjectKanbanColumn[]
  density: Density
  selectedIds: Set<string>
  onCardClick: (issue: IssueSummary) => void
}) {
  return (
    <div className="flex h-full min-h-0 gap-3 pb-3">
      {columns.map((col) => {
        const columnId = col.groupId ?? col.name
        return (
          <Column
            key={columnId}
            name={col.name}
            count={col.count}
            items={col.items}
            density={density}
            wipLimit={null}
            columnId={columnId}
            selectedIds={selectedIds}
            onCardClick={onCardClick}
          />
        )
      })}
    </div>
  )
}

function SwimlaneBoard({
  columns,
  density,
  selectedIds,
  collapsed,
  rollup,
  onToggle,
  onCardClick,
}: {
  columns: ProjectKanbanColumn[]
  density: Density
  selectedIds: Set<string>
  collapsed: Set<string>
  rollup: SwimlaneRollupBucket[]
  onToggle(id: string): void
  onCardClick(i: IssueSummary): void
}) {
  // status×swimlane grid: каждая колонка от сервера — swimlane (по выбранному
  // измерению — assignee/epic/priority/sprint). Внутри swimlane выкладываем
  // полноценные status-колонки, чтобы пользователь видел колонки «по статусу»
  // и для не-status группировки.
  const statuses = useMemo(() => collectStatuses(columns), [columns])

  let hueIdx = 0
  return (
    <div className="flex flex-col">
      {columns.map((col) => {
        const id = col.groupId ?? col.name
        const isCollapsed = collapsed.has(id)
        const hue = (hueIdx++ * 47 + 280) % 360
        const done = col.items.filter((i) => i.statusCategory === 'done').length
        // По одному ведру на каждый встречающийся статус проекта; пустые
        // ведра остаются видимыми, чтобы у DnD были drop-targets.
        const buckets = new Map<string, IssueSummary[]>(statuses.map((s) => [s.id, []]))
        for (const it of col.items) {
          const arr = buckets.get(it.statusId)
          if (arr) arr.push(it)
          else buckets.set(it.statusId, [it])
        }
        return (
          <Swimlane
            key={id}
            title={col.name}
            keyLabel={col.groupId ?? null}
            hue={hue}
            count={col.count}
            doneCount={done}
            doneTarget={col.items.length || 1}
            collapsed={isCollapsed}
            onToggle={() => onToggle(id)}
            rollup={rollup}
          >
            <div className="flex min-h-0 gap-3 pt-1">
              {statuses.map((s) => {
                const items = buckets.get(s.id) ?? []
                return (
                  <Column
                    key={`${id}-${s.id}`}
                    name={s.name}
                    count={items.length}
                    items={items}
                    density={density}
                    wipLimit={null}
                    columnId={`${id}::${s.id}`}
                    selectedIds={selectedIds}
                    onCardClick={onCardClick}
                  />
                )
              })}
            </div>
          </Swimlane>
        )
      })}
    </div>
  )
}

// Собирает уникальные статусы по items всех swimlane'ов и сортирует их
// по category (new → indeterminate → done) → name. Этого достаточно как
// каркас status-колонок: расширим до полного набора проекта (включая
// пустые) после M-следующего, когда будем подгружать listProjectStatuses
// напрямую в kanban-ответ.
function collectStatuses(columns: ProjectKanbanColumn[]): Array<{
  id: string
  name: string
  category: 'new' | 'indeterminate' | 'done'
}> {
  const seen = new Map<
    string,
    { id: string; name: string; category: 'new' | 'indeterminate' | 'done' }
  >()
  for (const col of columns) {
    for (const it of col.items) {
      if (!seen.has(it.statusId)) {
        seen.set(it.statusId, {
          id: it.statusId,
          name: it.statusName,
          category: it.statusCategory,
        })
      }
    }
  }
  const order: Record<string, number> = { new: 0, indeterminate: 1, done: 2 }
  return Array.from(seen.values()).sort((a, b) => {
    const ca = order[a.category] ?? 3
    const cb = order[b.category] ?? 3
    if (ca !== cb) return ca - cb
    return a.name.localeCompare(b.name)
  })
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

function SkeletonBoard({ density }: { density: Density }) {
  const width =
    density === 'compact' ? 'w-[240px]' : density === 'spacious' ? 'w-[320px]' : 'w-[280px]'
  return (
    <div className="flex gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`h-[420px] ${width} shrink-0 animate-pulse rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)]`}
        />
      ))}
    </div>
  )
}
