import { Link } from '@tanstack/react-router'
import type { IssueDetail } from '../types'

// Полоска контекста: если у текущей карточки есть эпик или родитель — показываем
// ссылку, по которой панель сразу переключится на родителя. Это центральная UX-
// мотивация editor'а из docs/specs/09-ui-issue-editor.md (§2).

export function EpicContextStrip({ detail }: { detail: IssueDetail }) {
  const { summary } = detail
  const parts: Array<{ label: string; targetKey: string }> = []
  if (summary.parentJiraId) {
    parts.push({ label: 'Parent', targetKey: summary.parentJiraId })
  }
  if (summary.epicJiraId && summary.epicJiraId !== summary.parentJiraId) {
    parts.push({ label: 'Epic', targetKey: summary.epicJiraId })
  }
  if (parts.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-4 py-1.5 text-xs">
      {parts.map((p) => (
        <span key={`${p.label}:${p.targetKey}`} className="inline-flex items-center gap-1">
          <span className="text-muted-foreground">{p.label}:</span>
          <Link
            to="/issues/$key"
            params={{ key: p.targetKey }}
            className="font-mono font-medium text-primary hover:underline"
          >
            {p.targetKey}
          </Link>
        </span>
      ))}
    </div>
  )
}
