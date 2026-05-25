import { drizzle } from 'drizzle-orm/bun-sql'
import { SQL } from 'bun'
import * as schema from './schema'

// Адрес подключения к Postgres. Обязателен — fail-fast если переменной нет.
const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

// Bun.SQL — нативный pg-драйвер Bun (Bun 1.2+). Без npm-pg, без mq-обёрток.
const sql = new SQL(url)

// Singleton Drizzle-клиента с привязанной schema (нужно для relational queries).
export const db = drizzle(sql, { schema })

export type Db = typeof db

/**
 * Удобная обёртка над транзакциями: гарантирует, что DB-мутация и связанная
 * с ней outbox-запись попадают в один commit (см. docs/specs/05-sync-engine.md).
 */
export async function withTx<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx as unknown as Db))
}
