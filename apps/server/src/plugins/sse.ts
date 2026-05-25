import { Elysia } from 'elysia'

// Реестр SSE-топиков. Полноценный fan-out через pg_notify реализуется
// в milestone 3 (см. docs/specs/10-realtime-and-status.md). Здесь декларация,
// чтобы маршруты подписки могли быть смонтированы без слома сборки.

export type SseTopic = string

export const ssePlugin = new Elysia({ name: 'sse' }).decorate('sse', {
  publish(_topic: SseTopic, _type: string, _data: unknown) {
    // no-op до подключения LISTEN/NOTIFY
  },
})
