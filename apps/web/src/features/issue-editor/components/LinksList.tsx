import { Link } from '@tanstack/react-router'
import type { IssueLinkRef } from '../types'

// Группируем связи по человекочитаемому label ("blocks" / "is blocked by" / …).
// Создание / удаление связей появится позже; пока — read-only.

export function LinksList({ items }: { items: IssueLinkRef[] }) {
  if (items.length === 0) return null
  const groups = new Map<string, IssueLinkRef[]>()
  for (const link of items) {
    const list = groups.get(link.label) ?? []
    list.push(link)
    groups.set(link.label, list)
  }
  return (
    <section aria-label="Links" className="flex flex-col gap-1">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Links</h4>
      <ul className="flex flex-col gap-1.5">
        {Array.from(groups.entries()).map(([label, links]) => (
          <li key={label} className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{label}</span>
            <ul className="flex flex-col gap-0.5 pl-3">
              {links.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <Link
                    to="/issues/$key"
                    params={{ key: l.issue.key }}
                    className="flex min-w-0 items-center gap-2 text-sm hover:underline"
                  >
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {l.issue.key}
                    </span>
                    <span className="truncate">{l.issue.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
