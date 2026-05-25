// Pluggable-контракт очереди. По умолчанию реализуется через pg-boss
// (apps/jobs/src/boss.ts); Trigger.dev v3 — необязательная замена.
// Задачи импортируют только этот интерфейс, чтобы не зависеть от реализации.

export interface EnqueueOpts {
  startAfter?: Date | number
  singletonKey?: string
  retryLimit?: number
  retryDelay?: number
  retryBackoff?: boolean
  expireInMinutes?: number
}

export interface TaskCtx<T> {
  id: string
  name: string
  data: T
  log: (msg: string, fields?: Record<string, unknown>) => void
}

export interface Queue {
  enqueue<T>(name: string, payload: T, opts?: EnqueueOpts): Promise<{ id: string }>
  schedule(name: string, cron: string, payload?: unknown): Promise<void>
  defineTask<T>(name: string, handler: (ctx: TaskCtx<T>) => Promise<unknown>): void
  start(): Promise<void>
  stop(): Promise<void>
}
