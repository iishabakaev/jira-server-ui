import { Link } from '@tanstack/react-router'
import { cn } from '@ui/index'
import type { DeploymentInfo } from '../types'

// Бейдж состояния выкатки Platform Devops Task'а. Рендерим:
//   - в шапке editor'а у самой Platform Devops Task,
//   - на сабтасках Platform Devops Task'а (унаследовали state),
//   - на children-tree эпика рядом с задачей-артефактом.
//
// Состояний три (см. apps/server/src/modules/issues/deployment.ts):
//   not-deployed → серая точка
//   deploying    → синяя пульсирующая (в процессе)
//   deployed     → зелёная (артефакт в проде)

const STATE_STYLES: Record<DeploymentInfo['state'], { dot: string; label: string; text: string }> =
  {
    'not-deployed': {
      dot: 'bg-zinc-400',
      label: 'Not deployed',
      text: 'text-zinc-700',
    },
    deploying: {
      dot: 'bg-blue-500 animate-pulse',
      label: 'Deploying',
      text: 'text-blue-700',
    },
    deployed: {
      dot: 'bg-emerald-500',
      label: 'Deployed',
      text: 'text-emerald-700',
    },
  }

export interface DeploymentBadgeProps {
  info: DeploymentInfo
  // Когда true — бейдж становится ссылкой на Platform Devops Task'а, который
  // дал нам state. Используем на сабтасках/children-tree, где «исходный»
  // артефакт — это другой issue.
  linkToArtifact?: boolean
  // Текущий ключ issue — нужен, чтобы решить, скрыть ли стрелочку «← {key}»
  // (если бейдж на самой Platform Devops Task'е, ссылаться на себя не надо).
  currentIssueKey?: string
  size?: 'sm' | 'md'
}

export function DeploymentBadge({
  info,
  linkToArtifact = false,
  currentIssueKey,
  size = 'md',
}: DeploymentBadgeProps) {
  const style = STATE_STYLES[info.state]
  const showArtifactRef = linkToArtifact && info.devopsTaskKey !== currentIssueKey
  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-xs'
  const dotSize = size === 'sm' ? 'size-1.5' : 'size-2'

  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full bg-muted', padding, style.text)}
      title={`${style.label} · status: ${info.statusName} · artifact: ${info.devopsTaskKey}`}
    >
      <span className={cn('inline-block rounded-full', dotSize, style.dot)} aria-hidden />
      <span className="font-medium">{style.label}</span>
      {showArtifactRef ? (
        <Link
          to="/issues/$key"
          params={{ key: info.devopsTaskKey }}
          className="font-mono text-[10px] text-muted-foreground hover:underline"
        >
          ← {info.devopsTaskKey}
        </Link>
      ) : null}
    </span>
  )
}
