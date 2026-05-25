import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectListItem } from '../api'
import { filterProjects } from '../lib/fuzzy'

// Универсальный фуззи-пикер проектов. Используется на kanban и timeline —
// единственная точка входа для смены контекста проекта.
//
// Контракт: контролируемый компонент. Открытие/закрытие выпадашки —
// внутреннее состояние; selectedId и onSelect — снаружи.

type Props = {
  projects: ProjectListItem[]
  selectedId: string | null
  onSelect(id: string): void
  isLoading?: boolean
  // Метка слева; если null — лейбл не рендерится (для тесных тулбаров).
  label?: string | null
  // Подсказка плейсхолдера, когда selected не выбран.
  placeholder?: string
  // Минимальная ширина выпадающего списка (px).
  menuMinWidth?: number
}

export function ProjectPicker({
  projects,
  selectedId,
  onSelect,
  isLoading,
  label = 'Project',
  placeholder = 'Pick a project',
  menuMinWidth = 280,
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId],
  )

  const filtered = useMemo(() => filterProjects(projects, query), [projects, query])
  // Clamp подсветки: после сужения filtered индекс может выйти за границы —
  // тогда визуально подсвечена не та строка, а Enter ничего не делает.
  // Считаем эффективный highlight в момент рендера, без useEffect.
  const safeHighlight = filtered.length === 0 ? 0 : Math.min(highlight, filtered.length - 1)

  // Сбрасываем индекс подсветки при изменении набора через onChange ниже —
  // эффектом не управляем, чтобы избежать лишних рендеров (см. exhaustive-deps).

  // Закрытие по клику снаружи.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (containerRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const openMenu = () => {
    setOpen(true)
    setQuery('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  const commit = (project: ProjectListItem) => {
    onSelect(project.id)
    close()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = filtered[safeHighlight]
      if (target) commit(target)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-2 text-sm">
      {label !== null ? <span className="text-muted-foreground">{label}</span> : null}
      <button
        type="button"
        onClick={() => (open ? close() : openMenu())}
        className="h-8 min-w-[200px] rounded border border-border bg-background px-2 text-left text-sm hover:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={isLoading && projects.length === 0}
      >
        {selected ? (
          <span className="flex items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-tight">
              {selected.key}
            </span>
            <span className="truncate">{selected.name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">
            {isLoading ? 'Loading projects…' : projects.length === 0 ? 'No projects' : placeholder}
          </span>
        )}
      </button>

      {open ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 max-h-[340px] overflow-hidden rounded-md border border-border bg-popover shadow-lg"
          style={{ minWidth: menuMinWidth }}
          role="dialog"
          aria-label="Pick project"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlight(0)
            }}
            onKeyDown={onKeyDown}
            placeholder="Search by key or name…"
            className="block w-full border-b border-border bg-background px-3 py-2 text-sm focus:outline-none"
            aria-label="Search projects"
            aria-autocomplete="list"
            aria-controls="project-picker-listbox"
          />
          <div
            id="project-picker-listbox"
            role="listbox"
            className="max-h-[290px] overflow-auto py-1"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No matching projects.</div>
            ) : (
              filtered.map((p, idx) => {
                const isActive = idx === safeHighlight
                const isSelected = p.id === selectedId
                return (
                  <button
                    key={p.id}
                    type="button"
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => commit(p)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${
                      isActive ? 'bg-accent text-accent-foreground' : 'text-foreground'
                    } ${isSelected ? 'font-medium' : ''}`}
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-tight">
                      {p.key}
                    </span>
                    <span className="truncate">{p.name}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
