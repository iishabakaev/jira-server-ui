import { t } from 'elysia'
import { Value } from '@sinclair/typebox/value'
import type { TSchema } from '@sinclair/typebox'

// Контракт окружения. Валидируется на старте через TypeBox — fail-fast,
// чтобы не ловить undefined в рантайме. Все секреты приходят сюда.
const EnvSchema = t.Object({
  NODE_ENV: t.Union([t.Literal('development'), t.Literal('test'), t.Literal('production')], {
    default: 'development',
  }),
  APP_BASE_URL: t.String({ minLength: 1, default: 'http://localhost:3000' }),
  PORT: t.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  LOG_LEVEL: t.Union(
    [
      t.Literal('fatal'),
      t.Literal('error'),
      t.Literal('warn'),
      t.Literal('info'),
      t.Literal('debug'),
      t.Literal('trace'),
    ],
    { default: 'info' },
  ),

  DATABASE_URL: t.String({ minLength: 1 }),

  SESSION_COOKIE_NAME: t.String({ default: 'jira_ui_sid' }),
  // Wrapping-key для AES-GCM-обёртки PAT и refresh-токенов.
  // Ровно 32 байта в base64 (длина строки 44, оканчивается на '='). При
  // несоответствии длины fail-fast на старте.
  JIRA_PAT_KEK: t.String({ minLength: 44, maxLength: 44 }),

  AUTH_LOCAL_ENABLED: t.Boolean({ default: true }),
  AUTH_LOCAL_ALLOW_SIGNUP: t.Boolean({ default: false }),
  AUTH_KEYCLOAK_ENABLED: t.Boolean({ default: false }),
  KEYCLOAK_ISSUER_URL: t.Optional(t.String()),
  KEYCLOAK_CLIENT_ID: t.Optional(t.String()),
  KEYCLOAK_CLIENT_SECRET: t.Optional(t.String()),
  ROLE_GROUP_MAP: t.String({ default: '{}' }),

  JIRA_BASE_URL: t.Optional(t.String()),
  JIRA_WEBHOOK_SECRET: t.Optional(t.String()),
  JIRA_MAX_RPS: t.Integer({ minimum: 1, default: 6 }),
  JIRA_MAX_BURST: t.Integer({ minimum: 1, default: 12 }),
  JIRA_MAX_CONCURRENCY: t.Integer({ minimum: 1, default: 8 }),

  SYNC_DEFAULT_WINDOW_DAYS: t.Integer({ minimum: 1, default: 365 }),

  OTEL_EXPORTER_OTLP_ENDPOINT: t.Optional(t.String()),
  // OpenAPI выключен по умолчанию; в dev compose явно ставится в true.
  EXPOSE_OPENAPI: t.Boolean({ default: false }),

  // Цепочка доверенных reverse-proxy между клиентом и API. 0 — клиент
  // подключается напрямую и X-Forwarded-For игнорируется. n>0 — берём
  // n-й справа адрес из заголовка (всё, что левее, контролируется клиентом).
  TRUSTED_PROXY_HOPS: t.Integer({ minimum: 0, default: 0 }),
})

export type Env = typeof EnvSchema.static

// Приводит строковые env-переменные к ожидаемым типам по схеме каждого ключа.
// Никаких эвристик "выглядит как число / boolean" — только то, что просит схема.
// Это важно: KEYCLOAK_CLIENT_SECRET может состоять из одних цифр, а попытка
// привести его к number сломала бы валидацию String.
function getPropSchema(key: string): TSchema | null {
  const obj = EnvSchema as unknown as { properties: Record<string, TSchema> }
  return obj.properties[key] ?? null
}

function unwrap(schema: TSchema): TSchema {
  // TypeBox помечает Optional через символьный ключ Kind. У Optional<T>
  // целевой тип лежит в `.target` — раскрываем рекурсивно.
  const kind = (schema as unknown as { [k: symbol]: string })[Symbol.for('TypeBox.Kind')]
  if (kind === 'Optional') return unwrap((schema as unknown as { target: TSchema }).target)
  return schema
}

function coerceOne(key: string, raw: string): unknown {
  const schema = getPropSchema(key)
  if (!schema) return raw
  const inner = unwrap(schema)
  const innerType = (inner as { type?: string }).type
  if (innerType === 'boolean') {
    if (/^(true|1|yes|on)$/i.test(raw)) return true
    if (/^(false|0|no|off)$/i.test(raw)) return false
    return raw
  }
  if (innerType === 'integer' || innerType === 'number') {
    const n = Number.parseInt(raw, 10)
    return Number.isFinite(n) ? n : raw
  }
  return raw
}

function coerce(raw: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === '') continue
    out[k] = coerceOne(k, v)
  }
  return out
}

function loadEnv(): Env {
  const coerced = coerce(process.env as Record<string, string | undefined>)
  const merged = Value.Default(EnvSchema, coerced)
  const errors = [...Value.Errors(EnvSchema, merged)]
  if (errors.length > 0) {
    const message = errors
      .map((e) => `  ${e.path || '(root)'}: ${e.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${message}`)
  }
  return merged as Env
}

export const env = loadEnv()
