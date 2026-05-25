import { cn } from '@ui/index'
import { useIssueActivity } from '../hooks'
import type { ActivityEntryState, IssueActivityEntry } from '../types'

// Лента изменений по карточке. Источник — outbox-события: всё, что мы
// инициировали из этого UI, уже фиксируется в outbox с состоянием отправки
// в Jira. Полная история (включая webhook-инкременты от Jira) будет добавлена
// позже отдельным slot'ом — сейчас MVP закрывает observability локальных мутаций.

const STATE_DOT: Record<ActivityEntryState, string> = {
  pending: 'bg-amber-500',
  in_flight: 'bg-blue-500 animate-pulse',
  done: 'bg-emerald-500',
  error: 'bg-red-500',
  dead: 'bg-red-700',
}

const STATE_LABEL: Record<ActivityEntryState, string> = {
  pending: 'Pending',
  in_flight: 'Sending…',
  done: 'Synced',
  error: 'Retry pending',
  dead: 'Failed',
}

function ActivityRow({ entry }: { entry: IssueActivityEntry }) {
  const dot = STATE_DOT[entry.state]
  const stateLabel = STATE_LABEL[entry.state]
  return (
    <li className="flex flex-col gap-1 rounded border border-border bg-background p-2">
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn('size-1.5 rounded-full', dot)} aria-hidden />
        <span className="font-medium" title={`outbox state: ${entry.state}`}>
          {stateLabel}
        </span>
        <span>· {new Date(entry.createdAt).toLocaleString()}</span>
        {entry.attempts > 0 ? (
          <span title={`Push attempts: ${entry.attempts}`}>
            · {entry.attempts}
            {entry.attempts === 1 ? ' attempt' : ' attempts'}
          </span>
        ) : null}
      </header>
      <ul className="flex flex-col gap-0.5 text-sm">
        {entry.summaries.map((s) => (
          <li key={`${entry.id}-${s}`} className="break-words">
            {s}
          </li>
        ))}
      </ul>
      {entry.lastError ? (
        <p role="alert" className="text-xs text-destructive">
          {entry.lastError}
        </p>
      ) : null}
    </li>
  )
}

export interface ActivityTabProps {
  issueKey: string
  enabled: boolean
}

export function ActivityTab({ issueKey, enabled }: ActivityTabProps) {
  const { data, isLoading, error } = useIssueActivity(issueKey, enabled)

  if (!enabled) return null
  if (isLoading) {
    return <p className="text-sm italic text-muted-foreground">Loading activity…</p>
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Failed to load activity: {(error as Error).message}
      </p>
    )
  }
  const items = data ?? []
  if (items.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        No local changes yet. Edits made here will appear chronologically.
      </p>
    )
  }
  return (
    <ul aria-label="Issue activity" className="flex flex-col gap-2">
      {items.map((entry) => (
        <ActivityRow key={entry.id} entry={entry} />
      ))}
    </ul>
  )
}
