import { PgBoss } from 'pg-boss'
import { env } from './env'
import type { EnqueueOpts, Queue, TaskCtx } from './lib/queue'

// pg-boss реализация Queue. Polling + лизинг через Postgres, никаких Redis.
// PgBoss экспортируется именовано (см. pg-boss/dist/index.d.ts).

type JobLike = { id: string; data: unknown }

export function createPgBossQueue(): Queue {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: 'pgboss',
    // Retention (deleteAfterSeconds) — это QueueOptions, не ConstructorOptions.
    // На M0 задаём дефолты, а конкретные очереди настраиваются в M3+.
  })

  const handlers = new Map<string, (ctx: TaskCtx<unknown>) => Promise<unknown>>()

  return {
    async enqueue<T>(name: string, payload: T, opts?: EnqueueOpts) {
      const id = await boss.send(name, payload as Record<string, unknown>, {
        startAfter: opts?.startAfter as number | Date | undefined,
        singletonKey: opts?.singletonKey,
        retryLimit: opts?.retryLimit ?? 10,
        retryDelay: opts?.retryDelay ?? 5,
        retryBackoff: opts?.retryBackoff ?? true,
        // В pg-boss v12 параметр называется expireInSeconds.
        expireInSeconds: (opts?.expireInMinutes ?? 60) * 60,
      })
      return { id: id ?? '' }
    },

    async schedule(name: string, cron: string, payload?: unknown) {
      await boss.schedule(name, cron, (payload ?? {}) as Record<string, unknown>)
    },

    defineTask<T>(name: string, handler: (ctx: TaskCtx<T>) => Promise<unknown>) {
      handlers.set(name, handler as (ctx: TaskCtx<unknown>) => Promise<unknown>)
    },

    async start() {
      await boss.start()
      // pg-boss v10+ требует явного создания очереди до подписки work().
      // Без этого fetch() кидает "Queue does not exist".
      for (const name of handlers.keys()) {
        await boss.createQueue(name)
      }
      for (const [name, handler] of handlers) {
        await boss.work(name, async (jobs: JobLike[]) => {
          for (const job of jobs) {
            await handler({
              id: job.id,
              name,
              data: job.data,
              log: (msg, fields) =>
                console.log(JSON.stringify({ job: name, id: job.id, msg, ...fields })),
            })
          }
        })
      }
    },

    async stop() {
      await boss.stop()
    },
  }
}
