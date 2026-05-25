import { Elysia } from 'elysia'

// Заглушка для ограничителя частоты на запросах к нашему API.
// Реальная реализация — token bucket в Postgres, milestone 9.
export const rateLimitPlugin = new Elysia({ name: 'rate-limit' })
