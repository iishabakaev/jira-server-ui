import { migrate } from 'drizzle-orm/bun-sql/migrator'
import { db } from './client'

// Применяет миграции из ./drizzle. Запускается на старте api-роли
// (точка входа entrypoint.sh может вызвать `bun run db:migrate` перед api).
// Forward-only: миграции одобряются по diff'у TS-схемы человеком,
// откат — только через новую миграцию.
async function main() {
  const start = Date.now()
  console.log(JSON.stringify({ service: 'db', msg: 'migrate.starting' }))
  await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname })
  console.log(
    JSON.stringify({ service: 'db', msg: 'migrate.done', durationMs: Date.now() - start }),
  )
  process.exit(0)
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(JSON.stringify({ service: 'db', msg: 'migrate.failed', error: String(err) }))
    process.exit(1)
  })
}
