import { cn } from '@ui/index'
import type { PlanState, PlanStep } from '../types'

// Inline-бейдж прогресса для активного плана. Показываем краткое описание
// «N/M · running» с цветом, отражающим state. Polling выполняет вызывающий
// хук (useActivePlan/usePlanDetail); сам бейдж — чисто презентационный.

const STATE_LABEL: Record<PlanState, string> = {
  draft: 'Draft',
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const STATE_TONE: Record<PlanState, string> = {
  draft: 'bg-muted text-muted-foreground',
  queued: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  running: 'bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-200',
  paused: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
  done: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
  failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-muted text-muted-foreground line-through',
}

export interface PlanProgressBadgeProps {
  state: PlanState
  steps: Pick<PlanStep, 'state'>[]
  // Если задан — клик по бейджу открывает wizard (используется в IssuePanel).
  onClick?: () => void
  className?: string
}

export function PlanProgressBadge({ state, steps, onClick, className }: PlanProgressBadgeProps) {
  const done = steps.filter((s) => s.state === 'done').length
  const total = steps.length
  const label = `${done}/${total} · ${STATE_LABEL[state]}`

  const base =
    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ' +
    STATE_TONE[state]

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(base, 'hover:opacity-80', className)}
        aria-label={`Workflow plan: ${label}`}
      >
        {label}
      </button>
    )
  }
  return (
    <span className={cn(base, className)} title={`Workflow plan: ${label}`}>
      {label}
    </span>
  )
}
