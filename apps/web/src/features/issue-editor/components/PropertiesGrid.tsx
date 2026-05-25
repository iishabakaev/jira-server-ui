import { cn } from '@ui/index'
import { useEffect, useState } from 'react'
import { useProjectSprints } from '../../projects'
import {
  PlanProgressBadge,
  useActivePlan,
  useReachableStatuses,
  useWorkflowWizard,
} from '../../workflow-planner'
import { useIssueTransitions, usePatchIssue, useTransitionIssue } from '../hooks'
import type { IssueSummary } from '../types'

// Сетка свойств для side-panel. M6 редактирует:
//   - summary (textarea, blur-commit)
//   - status (select по доступным транзишенам из кеша + multi-hop wizard)
//   - labels (token input на запятой)
//   - story points (numeric input, blur-commit, clear → null)
//   - start / due date (HTML date input, blur-commit, очистка → null)
// Поля без редактора пока read-only — расширим вместе с editor schemas
// (см. CustomFieldsList и Milestone 6 → "field config-driven rendering").

interface RowProps {
  label: string
  children: React.ReactNode
}

function Row({ label, children }: RowProps) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-start gap-x-3 gap-y-1 text-sm">
      <span className="pt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export interface PropertiesGridProps {
  issue: IssueSummary
}

export function PropertiesGrid({ issue }: PropertiesGridProps) {
  const patch = usePatchIssue(issue.key)
  const tr = useTransitionIssue(issue.key)
  const transitions = useIssueTransitions(issue.key)
  const wizard = useWorkflowWizard()
  const activePlan = useActivePlan(issue.key)
  const reachable = useReachableStatuses(issue.key)
  const sprints = useProjectSprints(issue.projectId)

  // Локальный draft summary: обновляется с каждой клавиатурной нажатой,
  // коммитится только на blur (см. spec §5 — save model).
  const [summaryDraft, setSummaryDraft] = useState(issue.summary)
  useEffect(() => {
    setSummaryDraft(issue.summary)
  }, [issue.summary])

  const [labelsDraft, setLabelsDraft] = useState(issue.labels.join(', '))
  useEffect(() => {
    setLabelsDraft(issue.labels.join(', '))
  }, [issue.labels])

  // Story points хранятся как numeric — на клиенте удобнее работать со
  // строкой, чтобы не дёргать onChange при наборе "0.5" → "0" → "0." → "0.5".
  const [spDraft, setSpDraft] = useState(issue.storyPoints == null ? '' : String(issue.storyPoints))
  useEffect(() => {
    setSpDraft(issue.storyPoints == null ? '' : String(issue.storyPoints))
  }, [issue.storyPoints])

  // Даты: HTML date input хранит формат YYYY-MM-DD; пустая строка означает
  // очистку поля (отправляем null, чтобы серверный PATCH прошёл валидацию
  // t.Union([t.String({ format: 'date' }), t.Null()])).
  const [startDateDraft, setStartDateDraft] = useState(issue.startDate ?? '')
  useEffect(() => {
    setStartDateDraft(issue.startDate ?? '')
  }, [issue.startDate])

  const [dueDateDraft, setDueDateDraft] = useState(issue.dueDate ?? '')
  useEffect(() => {
    setDueDateDraft(issue.dueDate ?? '')
  }, [issue.dueDate])

  const commitSummary = () => {
    const trimmed = summaryDraft.trim()
    if (!trimmed || trimmed === issue.summary) {
      setSummaryDraft(issue.summary)
      return
    }
    patch.mutate({ summary: trimmed })
  }

  const commitStoryPoints = () => {
    const trimmed = spDraft.trim()
    if (trimmed === '') {
      if (issue.storyPoints == null) return
      patch.mutate({ storyPoints: null })
      return
    }
    // Number парсит "10abc" в 10 — пользователь молча теряет хвост ввода.
    // Используем строгий regex + Number.parseFloat: число должно занимать
    // всю строку. Регекс умышленно отвергает scientific notation и
    // locale-запятую, но принимает `.5`, `3.`, `+3` — это форматы, в
    // которых пользователи реально набирают story points.
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) {
      setSpDraft(issue.storyPoints == null ? '' : String(issue.storyPoints))
      return
    }
    const next = Number.parseFloat(trimmed)
    if (!Number.isFinite(next) || next < 0) {
      setSpDraft(issue.storyPoints == null ? '' : String(issue.storyPoints))
      return
    }
    if (next === issue.storyPoints) return
    patch.mutate({ storyPoints: next })
  }

  // ISO date format YYYY-MM-DD; HTML <input type="date"> гарантирует
  // shape, но пустая строка валидна и означает "очистить".
  const commitStartDate = () => {
    const value = startDateDraft.trim() || null
    if (value === (issue.startDate ?? null)) return
    patch.mutate({ startDate: value })
  }

  const commitDueDate = () => {
    const value = dueDateDraft.trim() || null
    if (value === (issue.dueDate ?? null)) return
    patch.mutate({ dueDate: value })
  }

  const commitLabels = () => {
    const next = labelsDraft
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
    // Сравниваем как множества: reorder (`a,b` → `b,a`) — это всё ещё тот же
    // набор лейблов; буквенный compare сбрасывал бы такие правки молча.
    const sortedNext = [...next].sort()
    const sortedCur = [...issue.labels].sort()
    const same =
      sortedNext.length === sortedCur.length && sortedNext.every((v, i) => v === sortedCur[i])
    if (same) return
    patch.mutate({ labels: next })
  }

  // Один hop без required-полей — мутируем напрямую (исторический путь
  // M5). Если у транзишена есть обязательные поля — открываем wizard:
  // он создаст single-step план и соберёт значения. Workflow-engine
  // обрабатывает оба случая одинаково (см. docs/specs/14-workflow-engine.md).
  const onStatusChange = (toStatusId: string) => {
    if (toStatusId === issue.statusId) return
    const option = transitions.data?.options.find((o) => o.toStatusId === toStatusId)
    const requiresFields = option?.requiredFields.some((f) => f.required) ?? false
    if (requiresFields) {
      wizard.open({
        issueKey: issue.key,
        targetStatusId: toStatusId,
        targetStatusName: option?.toStatusName ?? '—',
      })
      return
    }
    tr.mutate({ toStatusId })
  }

  // Multi-hop планер: пользователь выбирает терминальный статус, не
  // присутствующий в one-hop options. Имя берём из reachable-кеша.
  const openMultiHopWizard = (toStatusId: string) => {
    const r = reachable.data?.statuses.find((s) => s.statusId === toStatusId)
    wizard.open({
      issueKey: issue.key,
      targetStatusId: toStatusId,
      targetStatusName: r?.statusName ?? toStatusId,
    })
  }

  const onActivePlanClick = () => {
    if (!activePlan.data) return
    wizard.open({
      issueKey: issue.key,
      targetStatusId: activePlan.data.toStatusId,
      // Сервер сохраняет имя на момент создания плана; fallback —
      // reachable-кеш, дальше — id.
      targetStatusName:
        activePlan.data.targetStatusName ??
        reachable.data?.statuses.find((s) => s.statusId === activePlan.data?.toStatusId)
          ?.statusName ??
        activePlan.data.toStatusId,
    })
  }

  // Один-hop опции уже есть в transitions.data; multi-hop опции —
  // reachable.data.statuses с minSteps >= 2. Отрисовываем под <optgroup>
  // и помечаем префиксом `multi-hop:` в value (см. onChange выше).
  const oneHopIds = new Set((transitions.data?.options ?? []).map((o) => o.toStatusId))
  const multiHopOptions = (reachable.data?.statuses ?? []).filter(
    (s) => s.minSteps >= 2 && !oneHopIds.has(s.statusId) && s.statusId !== issue.statusId,
  )

  return (
    <section aria-label="Properties" className="flex flex-col gap-3">
      <Row label="Summary">
        <textarea
          value={summaryDraft}
          onChange={(e) => setSummaryDraft(e.target.value)}
          onBlur={commitSummary}
          rows={Math.min(4, Math.max(1, summaryDraft.split('\n').length))}
          className={cn(
            'w-full resize-y rounded border border-transparent bg-transparent px-2 py-1',
            'hover:border-border focus:border-ring focus:bg-background focus:outline-none',
          )}
          aria-label="Summary"
        />
      </Row>

      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Properties
      </h4>

      <Row label="Status">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={issue.statusId}
            onChange={(e) => {
              const next = e.target.value
              // Псевдо-опция «multi-hop:<uuid>» открывает wizard вместо
              // обычного transition — HTML <select> не умеет optgroup-actions,
              // поэтому маркируем строку префиксом значения.
              if (next.startsWith('multi-hop:')) {
                openMultiHopWizard(next.slice('multi-hop:'.length))
                e.currentTarget.value = issue.statusId
                return
              }
              onStatusChange(next)
            }}
            disabled={transitions.isLoading || tr.isPending}
            className="h-8 rounded border border-border bg-background px-2 text-sm"
            aria-label="Status"
          >
            <option value={issue.statusId}>{issue.statusName}</option>
            {(transitions.data?.options ?? [])
              .filter((opt) => opt.toStatusId !== issue.statusId)
              .map((opt) => {
                const required = opt.requiredFields.some((f) => f.required)
                return (
                  <option key={opt.toStatusId} value={opt.toStatusId}>
                    → {opt.toStatusName}
                    {required ? ' (fields required)' : ''}
                  </option>
                )
              })}
            {multiHopOptions.length > 0 ? (
              <optgroup label="Multi-step (wizard)">
                {multiHopOptions.map((s) => (
                  <option key={`mh-${s.statusId}`} value={`multi-hop:${s.statusId}`}>
                    ⇢ {s.statusName} ({s.minSteps} steps)
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          {tr.isPending ? <span className="text-xs text-muted-foreground">…</span> : null}
          {activePlan.data ? (
            <PlanProgressBadge
              state={activePlan.data.state}
              steps={activePlan.data.steps}
              onClick={onActivePlanClick}
            />
          ) : null}
        </div>
      </Row>

      <Row label="Assignee">
        <span>
          {issue.assigneeDisplayName ?? issue.assigneeId ?? (
            <em className="text-muted-foreground">Unassigned</em>
          )}
        </span>
      </Row>

      <Row label="Priority">
        <span>{issue.priorityName ?? <em className="text-muted-foreground">—</em>}</span>
      </Row>

      <Row label="Sprint">
        <select
          value={issue.sprintId ?? ''}
          onChange={(e) => {
            const next = e.target.value || null
            if (next === issue.sprintId) return
            patch.mutate({ sprintId: next })
          }}
          disabled={sprints.isLoading || patch.isPending}
          className="h-8 rounded border border-border bg-background px-2 text-sm"
          aria-label="Sprint"
        >
          <option value="">Backlog</option>
          {/* Активный спринт issue может отсутствовать в списке (например, если
              в проекте больше нет issues в этом спринте — distinct-фильтр на
              сервере отсечёт его). Подмешиваем его явно, чтобы не сбросить
              выбранное значение визуально. */}
          {issue.sprintId && !(sprints.data ?? []).some((s) => s.id === issue.sprintId) ? (
            <option value={issue.sprintId}>{issue.sprintName ?? '(current)'}</option>
          ) : null}
          {(sprints.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.state === 'active' ? ' · active' : s.state === 'future' ? ' · future' : ''}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Story points">
        <input
          type="text"
          inputMode="decimal"
          value={spDraft}
          onChange={(e) => setSpDraft(e.target.value)}
          onBlur={commitStoryPoints}
          placeholder="—"
          className={cn(
            'h-8 w-24 rounded border border-transparent bg-transparent px-2',
            'hover:border-border focus:border-ring focus:bg-background focus:outline-none',
          )}
          aria-label="Story points"
        />
      </Row>

      <Row label="Start date">
        <input
          type="date"
          value={startDateDraft}
          onChange={(e) => setStartDateDraft(e.target.value)}
          onBlur={commitStartDate}
          // Перекрёстное ограничение: start ≤ due. Пустое due — нет ограничения.
          max={dueDateDraft || undefined}
          className={cn(
            'h-8 rounded border border-transparent bg-transparent px-2',
            'hover:border-border focus:border-ring focus:bg-background focus:outline-none',
          )}
          aria-label="Start date"
        />
      </Row>

      <Row label="Due date">
        <input
          type="date"
          value={dueDateDraft}
          onChange={(e) => setDueDateDraft(e.target.value)}
          onBlur={commitDueDate}
          // Перекрёстное ограничение: due ≥ start. Пустое start — нет ограничения.
          min={startDateDraft || undefined}
          className={cn(
            'h-8 rounded border border-transparent bg-transparent px-2',
            'hover:border-border focus:border-ring focus:bg-background focus:outline-none',
          )}
          aria-label="Due date"
        />
      </Row>

      <Row label="Labels">
        <input
          type="text"
          value={labelsDraft}
          onChange={(e) => setLabelsDraft(e.target.value)}
          onBlur={commitLabels}
          placeholder="comma, separated, labels"
          className={cn(
            'h-8 w-full rounded border border-transparent bg-transparent px-2',
            'hover:border-border focus:border-ring focus:bg-background focus:outline-none',
          )}
          aria-label="Labels"
        />
      </Row>

      <Row label="Components">
        <span>
          {issue.components.length ? (
            issue.components.join(', ')
          ) : (
            <em className="text-muted-foreground">—</em>
          )}
        </span>
      </Row>

      <Row label="Epic">
        <span>{issue.epicJiraId ?? <em className="text-muted-foreground">—</em>}</span>
      </Row>

      {patch.error ? (
        <p role="alert" className="text-xs text-destructive">
          {(patch.error as Error).message}
        </p>
      ) : null}
      {tr.error ? (
        <p role="alert" className="text-xs text-destructive">
          {(tr.error as Error).message}
        </p>
      ) : null}
    </section>
  )
}
