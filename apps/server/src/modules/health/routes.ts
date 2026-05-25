import { Elysia, t } from 'elysia'
import { db } from '@db'
import { sql } from 'drizzle-orm'
import { logger } from '../../plugins/logger'

// Liveness/readiness-зонды. Liveness — процесс жив. Readiness — Postgres достижим
// (это единственный обязательный внешний сервис, см. docs/specs/02-project-structure.md).
//
// Ответ readiness не содержит текст ошибки наружу: сообщения драйвера
// Postgres могут раскрывать имена хостов/схем и попадают только в логи.
export const healthModule = new Elysia({ prefix: '/health' })
  .get(
    '/live',
    () => ({ status: 'ok' as const }),
    {
      response: { 200: t.Object({ status: t.Literal('ok') }) },
    },
  )
  .get('/ready', async ({ set }) => {
    try {
      await db.execute(sql`select 1`)
      return { status: 'ok' as const, db: 'reachable' as const }
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'health.ready.db_unreachable')
      set.status = 503
      return { status: 'degraded' as const, db: 'unreachable' as const }
    }
  })
