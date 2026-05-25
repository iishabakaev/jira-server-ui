import { useQueryClient } from '@tanstack/react-query'
import { Button, cn } from '@ui/index'
import { useEffect, useMemo, useRef, useState } from 'react'
import { issueEditorKeys } from '../../issue-editor/hooks'
import { WorkflowPlannerError } from '../api'
import {
  useActivePlan,
  useCancelPlan,
  useExecutePlan,
  usePlanDetail,
  usePlanTransition,
  useRetryPlan,
} from '../hooks'
import { useWorkflowWizard } from '../store'
import {
  type ExecuteInput,
  isTerminalPlanState,
  type PlanPreview,
  type PlanState,
  type PlanStep,
  type PlanStepPreview,
} from '../types'
import { StepCard } from './StepCard'

// Главный wizard. Жизненный цикл:
//   1. Открыт — определяем plan: либо подхватываем активный (useActivePlan),
//      либо создаём draft через POST /api/workflow/plan.
//   2. Пользователь заполняет required-поля по каждому шагу.
//   3. Run — POST /api/workflow/execute переводит plan в queued; worker
//      начинает прогонять transition'ы. UI поллит план через usePlanDetail.
//   4. Терминальное состояние: на done закрываем wizard и инвалидируем
//      кеш редактора; на failed показываем Retry/Cancel.
//
// Wizard монтируется один раз в IssuePanel; useWorkflowWizard.open(...) из
// PropertiesGrid открывает его с целевым статусом.

interface WorkflowWizardProps {
  // Issue, в контексте которого работает wizard. Если null — wizard скрыт.
  // Передаётся снаружи (а не читается из store), чтобы wizard всегда
  // относился к открытому IssuePanel, а не к глобальной выделенной задаче.
  issueKey: string
}

function buildEmptyValues(preview: PlanPreview | null): Record<string, Record<string, unknown>> {
  if (!preview) return {}
  const out: Record<string, Record<string, unknown>> = {}
  for (const step of preview.steps) {
    out[String(step.seq)] = {}
  }
  return out
}

function buildValuesFromActive(plan: {
  steps: PlanStep[]
}): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const s of plan.steps) {
    out[String(s.seq)] = { ...s.fieldValues }
  }
  return out
}

function allRequiredFilled(
  preview: PlanPreview,
  values: Record<string, Record<string, unknown>>,
): boolean {
  for (const step of preview.steps) {
    const stepValues = values[String(step.seq)] ?? {}
    for (const f of step.requiredFields) {
      if (!f.required) continue
      const v = stepValues[f.field]
      if (v === undefined || v === null || v === '') return false
    }
  }
  return true
}

function stateHeadline(state: PlanState): string {
  switch (state) {
    case 'draft':
      return 'Draft — review steps and run'
    case 'queued':
      return 'Queued — waiting for worker'
    case 'running':
      return 'Running'
    case 'paused':
      return 'Paused'
    case 'done':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

export function WorkflowWizard({ issueKey }: WorkflowWizardProps) {
  const wizard = useWorkflowWizard()
  const qc = useQueryClient()

  // Открыт ли wizard именно для этого issue?
  const isOpenForThisIssue = wizard.issueKey === issueKey
  const targetStatusId = wizard.targetStatusId
  const targetStatusName = wizard.targetStatusName

  const active = useActivePlan(isOpenForThisIssue ? issueKey : null)
  const planMut = usePlanTransition()
  const exec = useExecutePlan(issueKey)
  const cancel = useCancelPlan(issueKey)
  const retry = useRetryPlan(issueKey)

  // Локальный preview из plan() — используется, пока нет активного плана.
  const [preview, setPreview] = useState<PlanPreview | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [valuesByStep, setValuesByStep] = useState<Record<string, Record<string, unknown>>>({})
  const [finalComment, setFinalComment] = useState('')

  // ID плана, который мы наблюдаем. Берём из active.data?.id, либо из preview.
  const observedPlanId = active.data?.id ?? wizard.planId ?? preview?.planId ?? null
  const detail = usePlanDetail(observedPlanId)

  // Стабильные ссылки на функции, которые не должны участвовать в deps
  // (иначе useExhaustiveDependencies триггерит лишние ре-ран'ы).
  const refs = useRef({
    planMutate: planMut.mutate,
    attachPlan: wizard.attachPlan,
  })
  refs.current = {
    planMutate: planMut.mutate,
    attachPlan: wizard.attachPlan,
  }

  // Track, для какого planId мы уже инициализировали preview/values из
  // active.data. Защищает от перезаписи введённых пользователем значений
  // на каждом poll-тике active.data.
  const initializedForPlanId = useRef<string | null>(null)

  // Эффект 1: подхватываем активный план, когда он появляется.
  // Идёт ровно один раз на planId — повторные тики active.data ничего
  // не делают; пользовательский ввод сохраняется.
  useEffect(() => {
    if (!isOpenForThisIssue) return
    const data = active.data
    if (!data) return
    if (initializedForPlanId.current === data.id) return
    initializedForPlanId.current = data.id
    refs.current.attachPlan(data.id)
    // Если preview уже пришёл от planMut с реальными requiredFields/именами —
    // не затираем его синтетическим stub'ом из active.data; кеш одного planId
    // эквивалентен обоим источникам.
    setPreview((prev) => {
      if (prev && prev.planId === data.id) return prev
      return {
        planId: data.id,
        totalSteps: data.steps.length,
        hasRequiredFields: false,
        steps: data.steps.map<PlanStepPreview>((s) => ({
          seq: s.seq,
          fromStatusId: s.fromStatusId,
          toStatusId: s.toStatusId,
          fromStatusName: '—',
          toStatusName: '—',
          jiraTransitionId: s.jiraTransitionId,
          transitionName: 'Transition',
          requiredFields: [],
        })),
      }
    })
    setValuesByStep((prev) => {
      // Если пользователь уже что-то ввёл — не затираем.
      const empty = Object.keys(prev).length === 0
      return empty ? buildValuesFromActive(data) : prev
    })
  }, [isOpenForThisIssue, active.data])

  // Эффект 2: создаём draft-план при открытии wizard, если активного нет.
  // Зависит от фактически наблюдаемого состояния active-query, чтобы
  // корректно сработать после resolve isLoading → null.
  useEffect(() => {
    if (!isOpenForThisIssue || !targetStatusId) return
    if (active.isLoading) return
    if (active.data) return
    if (preview || planMut.isPending) return

    refs.current.planMutate(
      { issueKey, toStatusId: targetStatusId },
      {
        onSuccess: (p) => {
          setPreview(p)
          setValuesByStep(buildEmptyValues(p))
          refs.current.attachPlan(p.planId)
          initializedForPlanId.current = p.planId
          setPlanError(null)
        },
        onError: (err) => {
          // 409 workflow_active — сервер кладёт активный planId в meta;
          // подхватываем и продолжаем как с существующим планом.
          if (err instanceof WorkflowPlannerError && err.code === 'workflow_active') {
            const raw = err.meta?.planId
            const planId = typeof raw === 'string' ? raw : null
            if (planId) {
              refs.current.attachPlan(planId)
              return
            }
          }
          setPlanError(err instanceof Error ? err.message : 'Failed to plan transition')
        },
      },
    )
  }, [
    isOpenForThisIssue,
    targetStatusId,
    issueKey,
    active.isLoading,
    active.data,
    preview,
    planMut.isPending,
  ])

  // Сбрасываем локальный стейт при закрытии wizard'а.
  useEffect(() => {
    if (isOpenForThisIssue) return
    setPreview(null)
    setValuesByStep({})
    setFinalComment('')
    setPlanError(null)
    initializedForPlanId.current = null
  }, [isOpenForThisIssue])

  // На done — инвалидируем кеш редактора, чтобы статус и transitions
  // обновились. Берём detail.data целиком, чтобы биом-эвристика
  // useExhaustiveDependencies не ругалась на «более узкий» детект.
  const detailData = detail.data
  useEffect(() => {
    if (!detailData) return
    if (detailData.state === 'done') {
      void qc.invalidateQueries({ queryKey: issueEditorKeys.detail(issueKey) })
      void qc.invalidateQueries({ queryKey: issueEditorKeys.transitions(issueKey) })
    }
  }, [detailData, issueKey, qc])

  const liveState = detail.data?.state ?? 'draft'
  const isTerminal = isTerminalPlanState(liveState)
  const isReadOnly = liveState !== 'draft' && liveState !== 'paused'

  const canSubmit = useMemo(() => {
    if (!preview) return false
    if (exec.isPending) return false
    if (isReadOnly) return false
    return allRequiredFilled(preview, valuesByStep)
  }, [preview, valuesByStep, exec.isPending, isReadOnly])

  const onRun = () => {
    if (!preview) return
    const input: ExecuteInput = {
      planId: preview.planId,
      fieldValuesByStep: valuesByStep,
    }
    if (finalComment.trim().length > 0) {
      input.finalComment = finalComment.trim()
    }
    exec.mutate(input)
  }

  const onClose = () => {
    wizard.close()
  }

  const onCancel = () => {
    if (!observedPlanId) {
      onClose()
      return
    }
    cancel.mutate(observedPlanId, {
      onSuccess: () => onClose(),
    })
  }

  const onRetry = () => {
    if (!observedPlanId) return
    retry.mutate(observedPlanId)
  }

  if (!isOpenForThisIssue) return null

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop closes via onClick; Esc handled by IssuePanel
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Workflow transition to ${targetStatusName ?? 'target status'}`}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !exec.isPending) onClose()
      }}
    >
      <div className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border bg-background p-4 shadow-2xl">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold">
              {/* Берём имя из PlanDetail (сохранено сервером в plan.context),
                  иначе fallback на то, что положил вызывающий через store. */}
              Transition to {detail.data?.targetStatusName ?? targetStatusName ?? '—'}
            </h2>
            <p className="text-xs text-muted-foreground">
              {stateHeadline(liveState)}
              {detail.data
                ? ` · ${detail.data.steps.filter((s) => s.state === 'done').length}/${detail.data.steps.length}`
                : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {planError ? (
          <p role="alert" className="text-sm text-destructive">
            {planError}
          </p>
        ) : null}

        {planMut.isPending && !preview ? (
          <p className="text-sm text-muted-foreground">Planning…</p>
        ) : null}

        {preview ? (
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
            {preview.steps.map((step) => {
              // Ищем live-state по seq, а не по индексу: spec допускает
              // 'skipped' шаги, и server-row может оказаться разреженным.
              const live = detail.data?.steps.find((s) => s.seq === step.seq) ?? null
              const stepValues = valuesByStep[String(step.seq)] ?? {}
              return (
                <StepCard
                  key={step.seq}
                  preview={step}
                  live={live}
                  values={stepValues}
                  onValuesChange={(next) =>
                    setValuesByStep((prev) => ({ ...prev, [String(step.seq)]: next }))
                  }
                  fieldsDisabled={isReadOnly}
                />
              )
            })}
          </ul>
        ) : null}

        {preview && !isReadOnly ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="wf-final-comment" className="text-xs text-muted-foreground">
              Final comment (optional)
            </label>
            <textarea
              id="wf-final-comment"
              value={finalComment}
              onChange={(e) => setFinalComment(e.target.value)}
              rows={2}
              maxLength={4096}
              className={cn(
                'w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm',
              )}
            />
          </div>
        ) : null}

        {exec.error ? (
          <p role="alert" className="text-sm text-destructive">
            {(exec.error as Error).message}
          </p>
        ) : null}
        {detail.data?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {detail.data.error}
          </p>
        ) : null}

        <footer className="flex items-center justify-end gap-2">
          {/* Retry виден и на failed, и на paused (см. spec §14 «Pause on
              first failure» — paused — единственное user-recoverable состояние). */}
          {liveState === 'failed' || liveState === 'paused' ? (
            <Button type="button" variant="outline" onClick={onRetry} disabled={retry.isPending}>
              Retry
            </Button>
          ) : null}
          {isTerminal ? (
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onCancel} disabled={cancel.isPending}>
                {liveState === 'draft' ? 'Cancel' : 'Cancel plan'}
              </Button>
              <Button type="button" onClick={onRun} disabled={!canSubmit}>
                {exec.isPending ? 'Running…' : 'Run'}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
