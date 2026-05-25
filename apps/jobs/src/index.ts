import { db, projects } from '@db'
import { createPgBossQueue } from './boss'
import type { Queue } from './lib/queue'
import { registerFullSync } from './tasks/full-sync'
import { registerIncrementalSync } from './tasks/incremental-sync'
import { registerPushOutbox } from './tasks/push-outbox'
import { registerRefreshMetadata } from './tasks/refresh-metadata'
import { registerRefreshWorkflow } from './tasks/refresh-workflow'
import { registerWebhookReconcile } from './tasks/webhook-reconcile'
import { registerWorkflowRun } from './tasks/workflow-run'

// Точка входа воркер-процесса. Регистрирует обработчики и расписания.
// Расписания крутятся через pg-boss cron: один воркер ставит, остальные —
// разбирают.

// pg-boss принимает cron в обычном 5-полевом формате (минуты-часы-...).
// Минимальный шаг через cron — 1 минута. Для более частых тиков используем
// enqueue в цикле через schedule + чем чаще, тем меньше окно ожидания.
const CRON_PUSH_OUTBOX = '* * * * *' // каждую минуту тик; worker внутри сам тянет батч
const CRON_WEBHOOK_RECONCILE = '* * * * *' // каждую минуту страховка
const CRON_INCREMENTAL_SYNC = '*/2 * * * *' // раз в 2 минуты на каждый проект
const CRON_REFRESH_METADATA = '0 * * * *' // раз в час

async function scheduleProjectFanout(queue: Queue) {
  // Раз в N минут проходим по всем проектам и enqueue'м incremental-sync.
  // Это разруливает «N проектов × 1 шедула» без pg-boss-API на динамические
  // расписания (pg-boss schedule привязан к имени задачи, не к payload'у).
  await queue.schedule('sync-fanout', CRON_INCREMENTAL_SYNC)
}

async function main() {
  const queue = createPgBossQueue()

  registerPushOutbox(queue)
  registerFullSync(queue)
  registerIncrementalSync(queue)
  registerWebhookReconcile(queue)
  registerRefreshMetadata(queue)
  registerRefreshWorkflow(queue)
  registerWorkflowRun(queue)

  // Фан-аут sync-fanout → incremental-sync per project. Sync включается
  // только когда админ явно поставил галочку (metadata.syncEnabled === true).
  // По умолчанию (undefined) — sync выключен: иначе свежий refresh-metadata
  // натаскал бы сотни проектов из Jira и стал бы каждые 2 минуты обстреливать
  // их JQL'ом.
  queue.defineTask<Record<string, never>>('sync-fanout', async (ctx) => {
    const rows = await db.select({ id: projects.id, metadata: projects.metadata }).from(projects)
    const enabled = rows.filter((r) => r.metadata?.syncEnabled === true)
    for (const r of enabled) {
      await queue.enqueue(
        'incremental-sync',
        { projectId: r.id },
        {
          singletonKey: `inc:${r.id}`,
        },
      )
    }
    ctx.log('sync-fanout.enqueued', {
      projects: enabled.length,
      skipped: rows.length - enabled.length,
    })
  })

  await queue.start()

  // Расписания. Идемпотентны — pg-boss дедуплицирует.
  await queue.schedule('push-outbox', CRON_PUSH_OUTBOX)
  await queue.schedule('webhook-reconcile', CRON_WEBHOOK_RECONCILE)
  await queue.schedule('refresh-metadata', CRON_REFRESH_METADATA, {})
  await scheduleProjectFanout(queue)

  console.log(JSON.stringify({ service: 'worker', msg: 'worker.started' }))

  const shutdown = async (signal: string) => {
    console.log(JSON.stringify({ service: 'worker', msg: 'worker.stopping', signal }))
    await queue.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

if (import.meta.main) {
  void main()
}
