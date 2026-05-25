import { PgBoss } from 'pg-boss'
import { env } from '../env'

// Тонкий enqueuer на стороне сервера. Полная очередь живёт в apps/jobs;
// API только постит задачи. Один singleton — иначе на каждый POST мы бы
// открывали новый pool в Postgres.

let bossSingleton: PgBoss | null = null
let starting: Promise<PgBoss> | null = null

async function getBoss(): Promise<PgBoss> {
  if (bossSingleton) return bossSingleton
  if (starting) return starting
  starting = (async () => {
    const boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: 'pgboss',
    })
    await boss.start()
    bossSingleton = boss
    return boss
  })()
  return starting
}

export async function enqueueJob<T extends Record<string, unknown>>(
  name: string,
  payload: T,
  opts?: { singletonKey?: string },
): Promise<string | null> {
  const boss = await getBoss()
  // pg-boss v10+ требует createQueue перед send. Идемпотентный вызов.
  try {
    await boss.createQueue(name)
  } catch {
    // queue уже существует — игнорируем.
  }
  return boss.send(name, payload, {
    singletonKey: opts?.singletonKey,
    retryLimit: 5,
    retryBackoff: true,
  })
}
