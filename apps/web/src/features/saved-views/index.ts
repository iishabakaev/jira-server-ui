// Публичные экспорты фичи saved-views. Кросс-фичевый импорт — только отсюда
// (см. .agents/PATTERNS.md).

export { ViewsMenu, type ViewsMenuProps } from './components/ViewsMenu'
export { type SavedView, savedViewsStore, useSavedViews } from './store'
