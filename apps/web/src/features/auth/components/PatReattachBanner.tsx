import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { usePatStatus } from '../hooks'

// Баннер «нужен повторный attach PAT». Worker помечает credentials как
// `needsReattach=true` после серии 401 от Jira (см. apps/jobs lib/credentials);
// /api/auth/jira-pat прокидывает флаг на клиент. Пока SSE-канал не подключён
// (Milestone 3 ещё в стадии stub'а), полагаемся на регулярный polling
// usePatStatus + reactivity TanStack Query — баннер появляется не позже,
// чем через ~30 с после флипа на сервере.

const SESSION_DISMISS_KEY = 'jiraPat.reattachBannerDismissed'

export function PatReattachBanner() {
  const pat = usePatStatus()
  // SPA-only приложение, но sessionStorage не существует во время SSR/тестов;
  // дешёвая проверка спасает от падения, если кто-нибудь в будущем поднимет
  // jsdom без window.sessionStorage.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.sessionStorage.getItem(SESSION_DISMISS_KEY) === '1'
  })

  // Скрываем баннер на странице /settings/jira — пользователь и так
  // занимается починкой, повторный нотификатор только шумит.
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Если флаг needsReattach сбросился (юзер заново привязал PAT), снимаем
  // dismiss — следующий incident должен показать баннер снова. Зависим от
  // примитива needsReattach, не от ссылочно-меняющегося `pat.data`, чтобы
  // эффект не запускался на каждый poll-цикл.
  const needsReattach = pat.data?.needsReattach ?? false
  useEffect(() => {
    if (!needsReattach && dismissed) {
      window.sessionStorage.removeItem(SESSION_DISMISS_KEY)
      setDismissed(false)
    }
  }, [needsReattach, dismissed])

  if (!pat.data) return null
  if (!pat.data.attached) return null
  if (!pat.data.needsReattach) return null
  if (dismissed) return null
  if (pathname.startsWith('/settings/jira')) return null

  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900"
    >
      <span className="font-medium">Jira PAT needs re-attach.</span>
      <span className="flex-1 text-amber-800">
        Your Jira token stopped working — sync paused until you reconnect.
      </span>
      <Link
        to="/settings/jira"
        className="rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-medium hover:bg-amber-200"
      >
        Re-attach PAT
      </Link>
      <button
        type="button"
        onClick={() => {
          window.sessionStorage.setItem(SESSION_DISMISS_KEY, '1')
          setDismissed(true)
        }}
        aria-label="Dismiss banner"
        className="text-xs text-amber-700 hover:text-amber-900"
      >
        Dismiss
      </button>
    </div>
  )
}
