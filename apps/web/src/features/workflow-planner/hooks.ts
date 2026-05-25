import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelPlan,
  executePlan,
  getActivePlan,
  getPlan,
  getReachableStatuses,
  planTransition,
  retryPlan,
} from './api'
import { type ExecuteInput, isTerminalPlanState, type PlanDetail, type PlanState } from './types'

// React Query keys для workflow-планера. Изолируем от issue-editor: смена
// статуса через wizard инвалидирует и план, и issue detail/transitions, но
// делаем это явно из onSuccess, чтобы не цепляться через общий префикс.
export const workflowKeys = {
  all: ['workflow'] as const,
  plan: (planId: string | null) => [...workflowKeys.all, 'plan', planId ?? 'noop'] as const,
  active: (issueKey: string | null) => [...workflowKeys.all, 'active', issueKey ?? 'noop'] as const,
  reachable: (issueKey: string | null) =>
    [...workflowKeys.all, 'reachable', issueKey ?? 'noop'] as const,
}

// paused тоже считаем «не активным для poll'а»: воркер не двигает план,
// пока пользователь не нажмёт Retry/Cancel — оба явно инвалидируют кеш.
function shouldKeepPolling(state: PlanState): boolean {
  return !isTerminalPlanState(state) && state !== 'paused'
}

// Поллинг активного плана: пока state не терминальный — рефетч каждые 2s.
// 2s — компромисс между «видно прогресс» и нагрузкой; spec §15 разрешает
// до 1s, но 2s достаточно для трёх-четырёх transition'ов воркера.
const POLL_INTERVAL_MS = 2_000

export function useActivePlan(issueKey: string | null) {
  return useQuery({
    queryKey: workflowKeys.active(issueKey),
    queryFn: () => getActivePlan(issueKey!),
    enabled: Boolean(issueKey),
    staleTime: 5_000,
    refetchInterval: (q) => {
      // Не поллим, если предыдущий запрос упал (auth/network) — даём
      // глобальному обработчику решить, что делать; в противном случае
      // получаем неограниченный поток запросов в 401-loop.
      if (q.state.error) return false
      const data = q.state.data as PlanDetail | null | undefined
      if (!data) return false
      return shouldKeepPolling(data.state) ? POLL_INTERVAL_MS : false
    },
  })
}

// Запрос конкретного плана по id. Поллит, пока state в активной фазе.
export function usePlanDetail(planId: string | null) {
  return useQuery({
    queryKey: workflowKeys.plan(planId),
    queryFn: () => getPlan(planId!),
    enabled: Boolean(planId),
    staleTime: 1_000,
    refetchInterval: (q) => {
      if (q.state.error) return false
      const data = q.state.data as PlanDetail | undefined
      if (!data) return false
      return shouldKeepPolling(data.state) ? POLL_INTERVAL_MS : false
    },
  })
}

export function useReachableStatuses(issueKey: string | null) {
  return useQuery({
    queryKey: workflowKeys.reachable(issueKey),
    queryFn: () => getReachableStatuses(issueKey!),
    enabled: Boolean(issueKey),
    // Workflow-граф меняется редко (после refresh-workflow задачи) —
    // 5 минут кеша достаточно, лишний рефетч на каждую открытую панель.
    staleTime: 5 * 60_000,
  })
}

export function usePlanTransition() {
  return useMutation({
    mutationFn: (input: { issueKey: string; toStatusId: string }) =>
      planTransition(input.issueKey, input.toStatusId),
  })
}

export function useExecutePlan(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ExecuteInput) => executePlan(input),
    onSuccess: (res) => {
      // План перешёл в queued — рефетчим active и plan-detail сразу, чтобы
      // UI не ждал следующего интервала poll'а. Без явной инвалидации
      // plan(planId) кнопка Run остаётся enabled до первого poll'a (2s).
      void qc.invalidateQueries({ queryKey: workflowKeys.active(issueKey) })
      void qc.invalidateQueries({ queryKey: workflowKeys.plan(res.planId) })
    },
  })
}

export function useCancelPlan(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (planId: string) => cancelPlan(planId),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.active(issueKey) })
      void qc.invalidateQueries({ queryKey: workflowKeys.plan(res.planId) })
    },
  })
}

export function useRetryPlan(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (planId: string) => retryPlan(planId),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.active(issueKey) })
      void qc.invalidateQueries({ queryKey: workflowKeys.plan(res.planId) })
    },
  })
}
