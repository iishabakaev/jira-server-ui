import { hash, verify } from '@node-rs/argon2'

// Argon2id-параметры по docs/specs/03-auth.md (NIST-aligned, m=64MiB, t=3, p=1).
// Параметры зашиты в строке хеша, поэтому при их изменении старые хеши
// продолжают проверяться, но переписываются на новый формат при первом успехе.
// algorithm=2 — Argon2id (см. enum Algorithm в @node-rs/argon2); используем
// число напрямую, чтобы не тянуть const enum под verbatimModuleSyntax.
const ARGON2_OPTIONS = {
  algorithm: 2,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const

export const MIN_PASSWORD_LEN = 12

export class WeakPasswordError extends Error {
  constructor(public reason: 'too_short' | 'banned') {
    super(reason === 'too_short' ? 'Password is too short' : 'Password is banned')
    this.name = 'WeakPasswordError'
  }
}

// Минимальная проверка качества пароля. Полный banned-list из top-10k breached
// будет встроен в build-time скриптом; пока — короткий стоп-лист самых частых.
const BANNED = new Set<string>([
  'password',
  'password1',
  'qwerty12345',
  '123456789012',
  'administrator',
  'iloveyou1234',
  'welcome12345',
])

export function assertPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LEN) throw new WeakPasswordError('too_short')
  if (BANNED.has(password.toLowerCase())) throw new WeakPasswordError('banned')
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS)
}

export interface VerifyResult {
  ok: boolean
  /** Хеш создан со старыми параметрами — стоит молча переписать. */
  needsRehash: boolean
}

// Разбор параметров Argon2-хеша. Формат:
//   $argon2id$v=19$m=<mem>,t=<time>,p=<par>$<salt>$<hash>
const ARGON2_PARAMS_RE = /\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/i

function parseArgonParams(hashStr: string): { memoryCost: number; timeCost: number; parallelism: number } | null {
  const m = ARGON2_PARAMS_RE.exec(hashStr)
  if (!m) return null
  return {
    memoryCost: Number.parseInt(m[1]!, 10),
    timeCost: Number.parseInt(m[2]!, 10),
    parallelism: Number.parseInt(m[3]!, 10),
  }
}

export async function verifyPassword(password: string, storedHash: string): Promise<VerifyResult> {
  const ok = await verify(storedHash, password)
  if (!ok) return { ok: false, needsRehash: false }
  const params = parseArgonParams(storedHash)
  const needsRehash =
    !params ||
    params.memoryCost !== ARGON2_OPTIONS.memoryCost ||
    params.timeCost !== ARGON2_OPTIONS.timeCost ||
    params.parallelism !== ARGON2_OPTIONS.parallelism
  return { ok: true, needsRehash }
}

// Lockout-политика: после 5 подряд неудач — экспоненциальный backoff,
// удваивается каждую следующую попытку, упирается в 60 минут.
const LOCKOUT_BASE_THRESHOLD = 5
const LOCKOUT_CAP_MS = 60 * 60 * 1000

export function computeLockoutUntil(failedAttempts: number, now: Date = new Date()): Date | null {
  if (failedAttempts < LOCKOUT_BASE_THRESHOLD) return null
  const overage = failedAttempts - LOCKOUT_BASE_THRESHOLD
  const minutes = Math.min(2 ** overage, LOCKOUT_CAP_MS / 60_000)
  return new Date(now.getTime() + minutes * 60_000)
}
