import { describe, expect, it } from 'bun:test'
import { timelineService } from './service'

// Юнит-тест чистых валидаторов timelineService.window. Не дергаем БД —
// listTimelineBars не вызывается, поскольку валидация падает раньше.

describe('timelineService.window', () => {
  it('rejects from > to', async () => {
    await expect(
      timelineService.window({
        projectId: '00000000-0000-0000-0000-000000000001',
        from: '2026-06-01',
        to: '2026-05-01',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('rejects oversized window', async () => {
    await expect(
      timelineService.window({
        projectId: '00000000-0000-0000-0000-000000000001',
        from: '2020-01-01',
        to: '2030-01-01',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })

  it('rejects malformed ISO date', async () => {
    await expect(
      timelineService.window({
        projectId: '00000000-0000-0000-0000-000000000001',
        from: 'not-a-date',
        to: '2026-05-01',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' })
  })
})
