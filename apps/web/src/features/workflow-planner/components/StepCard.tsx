import { cn } from '@ui/index'
import type { PlanStep, PlanStepPreview, StepState, TransitionFieldReq } from '../types'
import { RequiredFieldsForm } from './RequiredFieldsForm'

// Карточка одного шага плана. Используется и в preview-режиме (до execute,
// когда live-state ещё нет), и в run-режиме (когда уже идёт исполнение и мы
// подкрашиваем шаг согласно plan.steps[i].state).

const STATE_DOT: Record<StepState, string> = {
  pending: 'bg-muted-foreground/40',
  running: 'bg-blue-500 animate-pulse',
  done: 'bg-emerald-500',
  failed: 'bg-destructive',
  skipped: 'bg-muted-foreground/30',
}

const STATE_LABEL: Record<StepState, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
}

export interface StepCardProps {
  preview: PlanStepPreview
  live?: PlanStep | null
  values: Record<string, unknown>
  onValuesChange: (next: Record<string, unknown>) => void
  // Заблокировать поля (например, во время running/done/failed).
  fieldsDisabled?: boolean
}

export function StepCard({ preview, live, values, onValuesChange, fieldsDisabled }: StepCardProps) {
  const state: StepState = live?.state ?? 'pending'
  const requiredFields: TransitionFieldReq[] = preview.requiredFields.filter((f) => f.required)

  return (
    <li className="rounded border border-border bg-card p-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn('inline-block h-2.5 w-2.5 rounded-full', STATE_DOT[state])}
            aria-hidden
          />
          <span className="text-sm font-medium">
            {preview.seq + 1}. {preview.fromStatusName} → {preview.toStatusName}
          </span>
          <span className="text-xs text-muted-foreground">via «{preview.transitionName}»</span>
        </div>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {STATE_LABEL[state]}
        </span>
      </header>

      {live?.error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {live.error}
        </p>
      ) : null}

      {requiredFields.length > 0 ? (
        <div className="mt-3">
          <RequiredFieldsForm
            stepSeq={preview.seq}
            fields={requiredFields}
            values={values}
            onChange={onValuesChange}
            disabled={fieldsDisabled}
          />
        </div>
      ) : null}
    </li>
  )
}
