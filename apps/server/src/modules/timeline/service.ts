import { appError } from '../../plugins/error'
import { listTimelineBars } from './queries'
import type { TimelineQuery, TimelineResponse } from './schema'

// Тонкий фасад: parse → query → wrap. Никакой бизнес-логики — группировку
// и геометрию делает фронт (features/timeline/lib/geometry.ts), сервер
// отдаёт плоский массив, чтобы кешировать ответ в TanStack Query без
// привязки к зум-уровню.

const DAY_MS = 86_400_000
// Cap на размер окна — защита от DoS-нагрузки. 2 года — щедро для
// планирования (квартальный зум всё ещё помещается). TypeBox ловит
// неверный формат даты, но не cross-field constraint.
const MAX_WINDOW_DAYS = 366 * 2

export const timelineService = {
  async window(query: TimelineQuery): Promise<TimelineResponse> {
    const fromMs = Date.parse(query.from)
    const toMs = Date.parse(query.to)
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      throw appError('validation_failed', 'from/to are not valid ISO dates')
    }
    if (fromMs > toMs) {
      throw appError('validation_failed', 'from must be <= to')
    }
    const days = Math.floor((toMs - fromMs) / DAY_MS)
    if (days > MAX_WINDOW_DAYS) {
      throw appError('validation_failed', `window too large: ${days} days, max ${MAX_WINDOW_DAYS}`)
    }

    const items = await listTimelineBars(query)
    return {
      projectId: query.projectId,
      from: query.from,
      to: query.to,
      group: query.group ?? 'epic',
      items,
    }
  },
}
