// Минимальный env-валидатор для воркера. Полный набор переменных
// зашит в apps/server/src/env.ts; здесь — только то, что нужно job-процессу.

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

function int(name: string, fallback: number): number {
  const v = process.env[name]
  if (!v) return fallback
  const n = Number.parseInt(v, 10)
  if (!Number.isFinite(n)) throw new Error(`Invalid integer env: ${name}=${v}`)
  return n
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
  DATABASE_URL: required('DATABASE_URL'),
  JIRA_BASE_URL: process.env.JIRA_BASE_URL ?? '',
  // KEK для расшифровки PAT в исходящих outbox-задачах. Обязателен для
  // push-outbox; в задачах, которые не звонят в Jira от имени пользователя,
  // отсутствие просто игнорируется.
  JIRA_PAT_KEK: process.env.JIRA_PAT_KEK ?? '',
  JIRA_MAX_RPS: int('JIRA_MAX_RPS', 6),
  JIRA_MAX_BURST: int('JIRA_MAX_BURST', 12),
  JIRA_MAX_CONCURRENCY: int('JIRA_MAX_CONCURRENCY', 8),
  SYNC_DEFAULT_WINDOW_DAYS: int('SYNC_DEFAULT_WINDOW_DAYS', 365),
}
