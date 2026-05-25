import { Link } from '@tanstack/react-router'
import { cn } from '@ui/index'
import { useState } from 'react'
import type { EpicChildTask, StatusCategory, SubtaskSummary } from '../types'
import { DeploymentBadge } from './DeploymentBadge'

// Дерево детей эпика: задачи + их сабтаски одним свитком. Используется только
// в view эпика — обычные задачи рендерят плоский SubtaskList.
//
// Раскрытие/сворачивание задачи (через useState + button) — UI-only, не
// уезжает в URL: бэк всегда возвращает полное дерево, лишних запросов не
// делаем.

const CATEGORY_DOT: Record<StatusCategory, string> = {
  new: 'bg-zinc-400',
  indeterminate: 'bg-blue-500',
  done: 'bg-emerald-500',
}

function StatusDot({ category }: { category: StatusCategory }) {
  return (
    <span className={cn('inline-block size-2 rounded-full', CATEGORY_DOT[category])} aria-hidden />
  )
}

function SubtaskRow({ subtask }: { subtask: SubtaskSummary }) {
  return (
    <li className="flex items-center gap-2 rounded px-2 py-1 hover:bg-muted/50">
      <StatusDot category={subtask.statusCategory} />
      <Link
        to="/issues/$key"
        params={{ key: subtask.key }}
        className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline"
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{subtask.key}</span>
        <span
          className={cn(
            'truncate',
            subtask.statusCategory === 'done' && 'line-through text-muted-foreground',
          )}
        >
          {subtask.summary}
        </span>
      </Link>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{subtask.statusName}</span>
    </li>
  )
}

function TaskNode({ task }: { task: EpicChildTask }) {
  // По умолчанию раскрываем задачу-артефакт (Platform Devops Task), потому
  // что её сабтаски — основная мотивация смотреть на эпик «фичей вышло».
  const isArtifact = task.deployment !== null
  const [open, setOpen] = useState(isArtifact)
  const hasSubtasks = task.subtasks.length > 0
  const doneCount = task.subtasks.filter((s) => s.statusCategory === 'done').length

  return (
    <li className="flex flex-col gap-1 rounded border border-border bg-background">
      <div className="flex items-center gap-2 px-2 py-1.5">
        {hasSubtasks ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="size-4 shrink-0 rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="size-4 shrink-0" aria-hidden />
        )}
        <StatusDot category={task.statusCategory} />
        <Link
          to="/issues/$key"
          params={{ key: task.key }}
          className="flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline"
        >
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {task.issueTypeName}
          </span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{task.key}</span>
          <span
            className={cn(
              'truncate',
              task.statusCategory === 'done' && 'line-through text-muted-foreground',
            )}
          >
            {task.summary}
          </span>
        </Link>
        {task.deployment ? <DeploymentBadge info={task.deployment} size="sm" /> : null}
        {hasSubtasks ? (
          <span className="ml-1 shrink-0 text-xs text-muted-foreground">
            {doneCount}/{task.subtasks.length}
          </span>
        ) : null}
        {task.assigneeDisplayName ? (
          <span className="ml-1 shrink-0 text-xs text-muted-foreground">
            {task.assigneeDisplayName}
          </span>
        ) : null}
      </div>
      {open && hasSubtasks ? (
        <ul className="flex flex-col gap-0 border-t border-border bg-muted/20 pb-1 pl-6 pr-1 pt-1">
          {task.subtasks.map((s) => (
            <SubtaskRow key={s.id} subtask={s} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

export interface EpicChildrenTreeProps {
  tasks: EpicChildTask[]
}

export function EpicChildrenTree({ tasks }: EpicChildrenTreeProps) {
  if (tasks.length === 0) {
    return (
      <section aria-label="Epic children" className="flex flex-col gap-1.5">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tasks in this epic
        </h4>
        <p className="text-sm italic text-muted-foreground">No tasks linked to this epic yet.</p>
      </section>
    )
  }
  // Краткая сводка: сколько артефактов уже задеплоено. Полезно с первого
  // взгляда понять, «вышел ли эпик».
  const artifacts = tasks.filter((c) => c.deployment !== null)
  const deployedArtifacts = artifacts.filter((c) => c.deployment?.state === 'deployed').length
  return (
    <section aria-label="Epic children" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tasks in this epic <span className="font-normal normal-case">({tasks.length})</span>
        </h4>
        {artifacts.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            Devops artifacts: {deployedArtifacts}/{artifacts.length} deployed
          </span>
        ) : null}
      </div>
      <ul className="flex flex-col gap-1">
        {tasks.map((c) => (
          <TaskNode key={c.id} task={c} />
        ))}
      </ul>
    </section>
  )
}
