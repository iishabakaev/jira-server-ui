import { Button, cn } from '@ui/index'
import type { DeploymentInfo, IssueSummary, SyncState } from '../types'
import { DeploymentBadge } from './DeploymentBadge'

// Шапка панели: ключ issue, тип, sync state, deployment-бейдж, кнопки
// expand/close. Deployment рендерится только если detail.deployment !== null
// — то есть либо сама задача — Platform Devops Task, либо у неё артефакт-
// родитель. На остальных типах бейджа нет, шапка остаётся компактной.

const SYNC_DOT: Record<SyncState, { dot: string; label: string }> = {
  synced: { dot: 'bg-emerald-500', label: 'Synced' },
  pending: { dot: 'bg-amber-500', label: 'Pending' },
  pushing: { dot: 'bg-blue-500 animate-pulse', label: 'Pushing…' },
  error: { dot: 'bg-red-500', label: 'Error' },
  conflict: { dot: 'bg-purple-500', label: 'Conflict' },
}

export interface IssueHeaderProps {
  issue: IssueSummary
  deployment?: DeploymentInfo | null
  onClose?: () => void
  onPromote?: () => void
  fullscreen?: boolean
}

export function IssueHeader({
  issue,
  deployment,
  onClose,
  onPromote,
  fullscreen,
}: IssueHeaderProps) {
  const sync = SYNC_DOT[issue.syncState]
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-border bg-background px-4 py-2">
      <span className="font-mono text-sm font-semibold">{issue.key}</span>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
        {issue.issueTypeName}
      </span>
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn('inline-block size-2 rounded-full', sync.dot)} aria-hidden />
        {sync.label}
      </span>
      {deployment ? (
        <DeploymentBadge info={deployment} linkToArtifact currentIssueKey={issue.key} size="sm" />
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        {onPromote ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onPromote}
            aria-label={fullscreen ? 'Collapse to panel' : 'Promote to full-screen'}
            title={fullscreen ? 'Collapse to panel' : 'Promote to full-screen'}
          >
            {fullscreen ? '⤡' : '⤢'}
          </Button>
        ) : null}
        {onClose ? (
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close issue">
            ✕
          </Button>
        ) : null}
      </div>
    </header>
  )
}
