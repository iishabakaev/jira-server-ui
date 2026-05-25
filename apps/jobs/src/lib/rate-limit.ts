import { env } from '../env'

// Token bucket для исходящих запросов к Jira REST. Один экземпляр на инстанс.
// Конкретные параметры — из env (JIRA_MAX_RPS / BURST / CONCURRENCY).
// Полная имплементация — milestone 2 (см. docs/specs/15-performance.md).

interface BucketState {
  tokens: number
  lastRefill: number
  inFlight: number
  perUser: Map<string, number>
}

const state: Map<string, BucketState> = new Map()

function getBucket(instance: string): BucketState {
  let b = state.get(instance)
  if (!b) {
    b = {
      tokens: env.JIRA_MAX_BURST,
      lastRefill: Date.now(),
      inFlight: 0,
      perUser: new Map(),
    }
    state.set(instance, b)
  }
  return b
}

async function acquire(instance: string, userId: string): Promise<void> {
  const bucket = getBucket(instance)
  // Пополнение по wall-clock: rps токенов в секунду.
  const now = Date.now()
  const elapsedSec = (now - bucket.lastRefill) / 1000
  bucket.tokens = Math.min(env.JIRA_MAX_BURST, bucket.tokens + elapsedSec * env.JIRA_MAX_RPS)
  bucket.lastRefill = now

  if (bucket.tokens < 1 || bucket.inFlight >= env.JIRA_MAX_CONCURRENCY) {
    const waitMs = Math.ceil((1 - bucket.tokens) * (1000 / env.JIRA_MAX_RPS))
    await new Promise((r) => setTimeout(r, Math.max(20, waitMs)))
    return acquire(instance, userId)
  }
  const userInFlight = bucket.perUser.get(userId) ?? 0
  if (userInFlight >= 3) {
    await new Promise((r) => setTimeout(r, 50))
    return acquire(instance, userId)
  }
  bucket.tokens -= 1
  bucket.inFlight += 1
  bucket.perUser.set(userId, userInFlight + 1)
}

function release(instance: string, userId: string): void {
  const bucket = state.get(instance)
  if (!bucket) return
  bucket.inFlight = Math.max(0, bucket.inFlight - 1)
  const u = (bucket.perUser.get(userId) ?? 0) - 1
  if (u <= 0) bucket.perUser.delete(userId)
  else bucket.perUser.set(userId, u)
}

export async function acquireAndRun<T>(
  opts: { userId: string; instance: string; cost?: number },
  fn: () => Promise<T>,
): Promise<T> {
  await acquire(opts.instance, opts.userId)
  try {
    return await fn()
  } finally {
    release(opts.instance, opts.userId)
  }
}
