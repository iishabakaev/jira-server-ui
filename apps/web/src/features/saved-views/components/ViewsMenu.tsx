import { cn } from '@ui/index'
import { Bookmark, BookmarkPlus, ChevronDown, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type SavedView, savedViewsStore, useSavedViews } from '../store'

// Дропдаун «Views». Сохраняет текущие kanban search-параметры под именем,
// которое вводит пользователь. Применение view вызывает onApply со
// search-объектом — KanbanPage перезапишет URL.

export interface ViewsMenuProps {
  currentSearch: Record<string, string | boolean | undefined>
  currentProjectId: string | null
  onApply(view: SavedView): void
}

export function ViewsMenu({ currentSearch, currentProjectId, onApply }: ViewsMenuProps) {
  const views = useSavedViews()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Закрытие по клику снаружи.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!containerRef.current) return
      if (containerRef.current.contains(e.target as Node)) return
      setOpen(false)
      setSaving(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (saving) inputRef.current?.focus()
  }, [saving])

  const projectViews = currentProjectId
    ? views.filter((v) => !v.projectId || v.projectId === currentProjectId)
    : views

  const commitSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const saved = savedViewsStore.save({
      name: trimmed,
      projectId: currentProjectId,
      search: currentSearch,
    })
    onApply(saved)
    setName('')
    setSaving(false)
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Saved views"
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-transparent px-2.5 text-[12px] font-medium text-[color:var(--text-secondary)] transition-colors',
          'hover:border-[color:var(--border)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text-primary)]',
          open &&
            'border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-primary)]',
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bookmark className="size-3.5" strokeWidth={1.75} />
        Views
        <ChevronDown className="size-3.5" strokeWidth={1.75} />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-[280px] overflow-hidden rounded-md border border-[color:var(--border)] bg-[color:var(--surface-elev)] shadow-[var(--shadow-pop)]"
        >
          <div className="border-b border-[color:var(--border)] px-3 py-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[color:var(--text-tertiary)]">
              Saved views
            </div>
          </div>

          {projectViews.length === 0 ? (
            <p className="px-3 py-3 text-[12px] text-[color:var(--text-tertiary)]">
              No saved views yet. Save the current filters below.
            </p>
          ) : (
            <ul className="max-h-[260px] overflow-auto py-1">
              {projectViews.map((v) => (
                <li
                  key={v.id}
                  className="group flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-[color:var(--surface-hover)]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      onApply(v)
                      setOpen(false)
                    }}
                    className="flex-1 truncate text-left text-[12.5px] font-medium text-[color:var(--text-primary)]"
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    title="Delete view"
                    onClick={(e) => {
                      e.stopPropagation()
                      savedViewsStore.remove(v.id)
                    }}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <Trash2
                      className="size-3.5 text-[color:var(--text-tertiary)] hover:text-[color:var(--state-error)]"
                      strokeWidth={1.75}
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-[color:var(--border)] p-2">
            {saving ? (
              <div className="flex gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={name}
                  maxLength={64}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitSave()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setSaving(false)
                    }
                  }}
                  placeholder="View name"
                  className="h-7 flex-1 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-2 text-[12px] outline-none focus:border-[color:var(--accent)]"
                />
                <button
                  type="button"
                  onClick={commitSave}
                  disabled={name.trim().length === 0}
                  className="rounded-md bg-[color:var(--accent)] px-2.5 text-[12px] font-medium text-white disabled:opacity-50"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSaving(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[color:var(--border)] px-2 py-1.5 text-[12px] font-medium text-[color:var(--text-secondary)] hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)]"
              >
                <BookmarkPlus className="size-3.5" strokeWidth={1.75} />
                Save current filters
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
