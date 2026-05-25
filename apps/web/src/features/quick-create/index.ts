// Публичные экспорты фичи quick-create. Кросс-фичевый импорт — только отсюда
// (см. .agents/PATTERNS.md).

export { QuickCreateError } from './api'
export { QuickCreateDialog } from './components/QuickCreateDialog'
export { QuickCreateProvider } from './components/QuickCreateProvider'
export { quickCreateKeys, useQuickCreate } from './hooks'
export { useQuickCreateUi } from './store'
export type { AvailableIssueType, QuickCreateInput } from './types'
