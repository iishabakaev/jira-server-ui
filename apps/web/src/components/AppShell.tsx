import type { ReactNode } from 'react'
import { RailNav } from '../features/kanban/components/RailNav'

// Общий shell приложения: 48-px рельса слева + контентная область.
// Сюда подключаются все «листовые» страницы (kanban, timeline, admin,
// settings), чтобы навигация и габариты совпадали. Страницы с собственным
// внутренним полноэкранным layout (kanban/timeline) рендерят свой
// header/board прямо внутри children — главное, что rail един.

export interface AppShellProps {
  children: ReactNode
  onSearchClick?: () => void
}

export function AppShell({ children, onSearchClick }: AppShellProps) {
  return (
    <div className="grid h-screen w-screen grid-cols-[48px_1fr] bg-[color:var(--background)]">
      <RailNav onSearchClick={onSearchClick} />
      <div className="grid min-w-0 grid-rows-[1fr] overflow-hidden">{children}</div>
    </div>
  )
}
