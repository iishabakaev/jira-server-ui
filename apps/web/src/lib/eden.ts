import { treaty } from '@elysiajs/eden'
import type { App } from '@eden'
import { env } from '../env'

// Единственная точка транспорта для фронтенда. credentials: include
// нужен для cookie-сессии (Elysia auth-плагин). По спецификации никакой
// axios / fetch в компонентах быть не должно.
export const api = treaty<App>(env.API_URL || window.location.origin, {
  fetch: { credentials: 'include' },
})
