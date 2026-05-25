import { db } from './client'
import { users } from './schema/users'
import { localCredentials } from './schema/local_credentials'

// Сид локальной БД: одна учётка app_admin с известным паролем для dev.
// В проде сид не запускают; CLI `bun run cli users create` — единственный
// поддерживаемый путь создания первого администратора.
// Параметры Argon2id: m=64MB, t=3, p=1 (см. docs/specs/03-auth.md).

// Сид никогда не запускается в проде: в проде первого админа создаёт
// CLI `bun run cli users create`. Здесь fail-fast, чтобы случайный
// `db:seed` на проде не оставил известный пароль в БД.
if (process.env.NODE_ENV === 'production') {
  throw new Error('seed is disabled when NODE_ENV=production')
}

const DEV_USERNAME = process.env.DEV_ADMIN_USERNAME ?? 'admin'
const DEV_PASSWORD = process.env.DEV_ADMIN_PASSWORD ?? 'admin'

async function hashPassword(plain: string): Promise<string> {
  // Динамический импорт — чтобы скрипт `bun run` не падал, когда
  // @node-rs/argon2 ещё не установлен (например, при первом bun install).
  // `algorithm: 2` = Argon2id (см. @node-rs/argon2/Algorithm). Const enum
  // нельзя трогать напрямую под verbatimModuleSyntax, поэтому используем литерал.
  const { hash } = await import('@node-rs/argon2')
  return hash(plain, {
    algorithm: 2,
    memoryCost: 64 * 1024,
    timeCost: 3,
    parallelism: 1,
  })
}

async function main() {
  const passwordHash = await hashPassword(DEV_PASSWORD)

  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        externalSub: crypto.randomUUID(),
        provider: 'local',
        email: `${DEV_USERNAME}@local`,
        displayName: DEV_USERNAME,
        roles: ['user', 'app_admin'],
      })
      .onConflictDoNothing({ target: users.email })
      .returning()

    if (!user) {
      console.log(JSON.stringify({ service: 'db', msg: 'seed.user.exists' }))
      return
    }

    await tx.insert(localCredentials).values({
      userId: user.id,
      username: DEV_USERNAME,
      passwordHash,
    })
  })

  console.log(JSON.stringify({ service: 'db', msg: 'seed.done', username: DEV_USERNAME }))
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(JSON.stringify({ service: 'db', msg: 'seed.failed', error: String(err) }))
    process.exit(1)
  })
}
