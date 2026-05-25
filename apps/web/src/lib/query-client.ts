import { QueryClient } from '@tanstack/react-query'

// Один QueryClient на приложение. Дефолты подобраны под наш профиль:
// все чтения идут из локальной БД на сервере, кэш TTL по умолчанию короткий,
// инвалидация — через SSE-патчинг кэша.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})
