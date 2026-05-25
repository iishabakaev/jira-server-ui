import { env } from '../env'

// Клиентский IP, заслуживающий доверия. X-Forwarded-For без cap-а доверять
// нельзя: клиент может вписать в него что угодно. Доверяем только хвосту
// длиной TRUSTED_PROXY_HOPS — этот фрагмент пишет наш reverse-proxy.
export function trustedClientIp(headers: Headers): string | null {
  const hops = env.TRUSTED_PROXY_HOPS
  if (hops <= 0) return null
  const raw = headers.get('x-forwarded-for')
  if (!raw) return null
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (list.length < hops) return null
  // Адрес, который вписал proxy на ближайшем хопе к нашему API.
  return list[list.length - hops] ?? null
}

// CSRF-защита через Origin/Referer-allowlist. SameSite=Lax пропускает
// top-level POST с чужих доменов, поэтому полагаться только на куку нельзя.
// Браузеры всегда отправляют Origin на POST/PUT/DELETE с cross-origin контента;
// для same-origin — тоже отправляют, и заголовок совпадает с APP_BASE_URL.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isCsrfSafe(request: Request, allowedOrigin: string): boolean {
  if (SAFE_METHODS.has(request.method)) return true
  const origin = request.headers.get('origin')
  if (origin) return origin === allowedOrigin
  // Часть legacy-клиентов опускают Origin; в этом случае проверяем Referer.
  const referer = request.headers.get('referer')
  if (!referer) return false
  try {
    const u = new URL(referer)
    return `${u.protocol}//${u.host}` === allowedOrigin
  } catch {
    return false
  }
}

// UUID v4 regex, для жёсткой валидации session id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidSessionId(id: string): boolean {
  return UUID_RE.test(id)
}
