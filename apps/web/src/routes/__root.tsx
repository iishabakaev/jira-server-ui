import { createRootRoute, Outlet } from '@tanstack/react-router'
import { PatReattachBanner } from '../features/auth'

// Корневой маршрут TanStack Router. Здесь живут layout-shell и провайдеры
// верхнего уровня; дети монтируются через outlet.
export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Системные баннеры — над всем содержимым, чтобы пользователь
          увидел проблему раньше, чем кликнет в недоступный workflow. */}
      <PatReattachBanner />
      <Outlet />
    </div>
  )
}
