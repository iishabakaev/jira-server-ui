import { Button, cn } from '@app/ui'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ProjectDetail } from '../../projects'
import { QuickCreateError } from '../api'
import { useQuickCreate } from '../hooks'
import type { AvailableIssueType, IssueSummary } from '../types'

// Модалка quick-create. Минималистичная: summary (textarea) + selector
// типа issue + Cancel/Create. Cmd/Ctrl+Enter — submit, Esc — cancel.
// Использует <dialog> для нативного focus-trap и backdrop'а.

type Props = {
  open: boolean
  project: ProjectDetail | null
  onClose(): void
  onCreated?(issue: IssueSummary): void
}

export function QuickCreateDialog({ open, project, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const summaryRef = useRef<HTMLTextAreaElement | null>(null)
  const summaryId = useId()
  const typeId = useId()
  const errorId = useId()

  const [summary, setSummary] = useState('')
  const [issueTypeId, setIssueTypeId] = useState<string>('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const availableTypes: AvailableIssueType[] = project?.availableIssueTypes ?? []
  const projectId = project?.id ?? null
  const canSubmit = Boolean(projectId) && summary.trim().length > 0 && Boolean(issueTypeId)

  const mutation = useQuickCreate({
    onSuccess: (issue) => {
      onCreated?.(issue)
      setSummary('')
      setSubmitError(null)
      onClose()
    },
  })

  // Дефолт типа: первый из списка (refresh-metadata кладёт их в стабильном
  // порядке по имени). Перевыбираем, если project поменялся.
  useEffect(() => {
    if (!open) return
    if (availableTypes.length === 0) {
      setIssueTypeId('')
      return
    }
    setIssueTypeId((current) => {
      if (current && availableTypes.some((t) => t.id === current)) return current
      return availableTypes[0]!.id
    })
  }, [open, availableTypes])

  // Открытие/закрытие через нативный API <dialog>. showModal даёт backdrop
  // и focus-trap бесплатно. React-стейт — единственный источник правды;
  // onCancel ниже делает preventDefault, чтобы dialog.open и наш open не
  // расходились во время cancel-event'а.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialog.open === open) return
    // showModal/close могут кинуть InvalidStateError при двойном вызове
    // в strict-mode-двойном useEffect'е или при быстром toggle. Логируем
    // и продолжаем — следующий рендер выровняет состояние.
    try {
      if (open) {
        dialog.showModal()
        // Авто-фокус на summary; setTimeout надёжнее RAF'а после showModal,
        // потому что некоторые браузеры двигают focus после первой
        // отрисовки, а RAF выполняется до неё.
        setTimeout(() => summaryRef.current?.focus(), 0)
      } else {
        dialog.close()
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('quick-create dialog toggle failed', err)
    }
  }, [open])

  // Ловим Esc и backdrop-click → закрываем диалог. <dialog> по умолчанию
  // отстреливает 'cancel', а backdrop-click отдаёт click на самом dialog'е.
  const onDialogClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) onClose()
  }

  const submit = () => {
    if (!projectId || !canSubmit) return
    setSubmitError(null)
    mutation.mutate(
      {
        projectId,
        issueTypeId,
        summary: summary.trim(),
      },
      {
        onError: (err) => {
          setSubmitError(err instanceof QuickCreateError ? err.message : 'Failed to create issue')
        },
      },
    )
  }

  const onSummaryKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Cmd/Ctrl+Enter — submit (стандарт для всех Jira-подобных quick-create).
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const stateLabel = useMemo(() => {
    if (!project) return 'Loading project metadata…'
    if (availableTypes.length === 0) {
      return 'No issue types cached yet — run refresh-metadata first'
    }
    return null
  }, [project, availableTypes])

  return (
    <dialog
      ref={dialogRef}
      onClick={onDialogClick}
      // Keyboard-аналог backdrop-click — Esc, который ловит onCancel.
      // Добавляем no-op onKeyDown, чтобы удовлетворить a11y-правило
      // и не дёргать всё содержимое внутри <form> двойным handler'ом.
      onKeyDown={() => {}}
      onCancel={(e) => {
        // Перехватываем cancel-event, чтобы синхронизировать React-стейт.
        // Без preventDefault dialog.open станет false до того, как наш
        // useEffect успеет всё корректно cleanup'нуть.
        e.preventDefault()
        onClose()
      }}
      className={cn(
        'rounded-lg border border-border bg-background p-0 text-foreground shadow-xl',
        'backdrop:bg-black/40 w-[min(560px,90vw)]',
      )}
      aria-labelledby={`${summaryId}-label`}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex flex-col gap-4 p-5"
      >
        <header className="flex items-center justify-between">
          <h2 id={`${summaryId}-label`} className="text-base font-semibold">
            Quick create
          </h2>
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs">⌘↵</kbd>
        </header>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={typeId} className="text-xs font-medium text-muted-foreground">
            Issue type
          </label>
          <select
            id={typeId}
            value={issueTypeId}
            onChange={(e) => setIssueTypeId(e.target.value)}
            disabled={availableTypes.length === 0}
            className={cn(
              'h-9 rounded-md border border-border bg-background px-2 text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:opacity-50',
            )}
          >
            {availableTypes.length === 0 ? (
              <option value="">No types available</option>
            ) : (
              availableTypes.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={summaryId} className="text-xs font-medium text-muted-foreground">
            Summary
          </label>
          <textarea
            id={summaryId}
            ref={summaryRef}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            onKeyDown={onSummaryKeyDown}
            placeholder="What needs to be done?"
            rows={3}
            maxLength={512}
            aria-describedby={submitError ? errorId : undefined}
            className={cn(
              'resize-y rounded-md border border-border bg-background px-3 py-2 text-sm',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          />
        </div>

        {stateLabel ? <p className="text-sm text-muted-foreground">{stateLabel}</p> : null}

        {submitError ? (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        ) : null}

        <footer className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!canSubmit || mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create'}
          </Button>
        </footer>
      </form>
    </dialog>
  )
}
