import { useNavigate } from '@tanstack/react-router'
import { cn } from '@ui/index'
import { useEffect, useRef, useState } from 'react'
import { WorkflowWizard } from '../../workflow-planner'
import { useIssueDetail } from '../hooks'
import { isEpicType } from '../issue-type'
import type { IssueDetail } from '../types'
import { ActivityTab } from './ActivityTab'
import { CommentsTab } from './CommentsTab'
import { CustomFieldsList } from './CustomFieldsList'
import { DeploymentBadge } from './DeploymentBadge'
import { DescriptionView } from './DescriptionView'
import { EpicChildrenTree } from './EpicChildrenTree'
import { EpicContextStrip } from './EpicContextStrip'
import { IssueHeader } from './IssueHeader'
import { LinksList } from './LinksList'
import { PropertiesGrid } from './PropertiesGrid'
import { SubtaskList } from './SubtaskList'

// Главный контейнер редактора. Имеем два режима:
//   1) Side-panel (default) — overlay поверх kanban/timeline, узкая колонка
//      справа, всё в одну ленту. Поведение классического Linear-стиля.
//   2) Fullscreen (?fullscreen=1 или клавиша 'f') — двухколоночная раскладка
//      Jira-style: основной контент слева (description, children, tabs),
//      sticky-сайдбар справа (properties, custom fields, links).
//
// Sidebar поднимается на ~960px ширины экрана; ниже — стэк, чтобы не давить
// горизонтальный скролл на мобильных.

export interface IssuePanelProps {
  issueKey: string
  fromPath?: string
  fullscreen?: boolean
  currentUserId: string | null
}

type Tab = 'comments' | 'activity' | 'worklog'

// Содержание сайдбара. Выделено в отдельный компонент, чтобы в fullscreen-
// режиме рендерить его как sticky-колонку, а в side-panel — встроенно ниже
// description.
function IssueSidebar({ detail }: { detail: IssueDetail }) {
  return (
    <aside className="flex flex-col gap-5">
      {detail.deployment ? (
        <section
          aria-label="Deployment"
          className="flex flex-col gap-1.5 rounded border border-border bg-muted/30 px-3 py-2"
        >
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Deployment
          </h4>
          <DeploymentBadge
            info={detail.deployment}
            linkToArtifact
            currentIssueKey={detail.summary.key}
          />
          <p className="text-xs text-muted-foreground">
            Status «{detail.deployment.statusName}»
            {detail.deployment.devopsTaskKey !== detail.summary.key
              ? ` from artifact ${detail.deployment.devopsTaskKey}`
              : ''}
          </p>
        </section>
      ) : null}
      <PropertiesGrid issue={detail.summary} />
      <CustomFieldsList schema={detail.fieldSchema} values={detail.customFields} />
      <LinksList items={detail.links} />
    </aside>
  )
}

export function IssuePanel({ issueKey, fromPath, fullscreen, currentUserId }: IssuePanelProps) {
  const navigate = useNavigate()
  const { data, isLoading, error } = useIssueDetail(issueKey)
  const [tab, setTab] = useState<Tab>('comments')

  const close = () => {
    // Если в SPA-истории есть запись (т.е. пользователь пришёл через клик
    // на kanban-карточке) — откатываем через history.back, чтобы восстановить
    // search-state источника без ручной парсилки `from`. На прямой заход
    // (вкладка открыта по URL `/issues/:key`) history.length === 1 — тогда
    // фолбэк на корень.
    if (typeof window !== 'undefined' && window.history.length > 1 && fromPath) {
      window.history.back()
      return
    }
    void navigate({ to: '/' })
  }
  const togglePromote = () => {
    void navigate({
      to: '/issues/$key',
      params: { key: issueKey },
      search: (prev) => ({
        ...(prev as Record<string, unknown>),
        fullscreen: !fullscreen || undefined,
      }),
    })
  }

  // Esc / f — закрытие и promote. Обработчик регистрируем один раз на mount;
  // актуальные `close`/`togglePromote` достаём через ref, иначе пришлось бы
  // переподписываться при каждом ре-рендере.
  const handlersRef = useRef({ close, togglePromote })
  handlersRef.current = { close, togglePromote }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handlersRef.current.close()
        return
      }
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement | null
        const tag = target?.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return
        handlersRef.current.togglePromote()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Признак «текущая задача — Platform Devops Task». Используем для:
  //   - решения, отдавать ли сабтаскам унаследованный deployment-бейдж,
  //   - подсветки «это артефакт» в самой шапке (через DeploymentBadge на
  //     IssueHeader, см. выше).
  const isOwnDevopsArtifact =
    !!data?.deployment && data.deployment.devopsTaskKey === data.summary.key
  const isEpic = isEpicType(data?.summary.issueTypeName)

  // ─── Main column ────────────────────────────────────────────────────
  // Содержит description, дерево детей/сабтасков и tabs. В side-panel
  // режиме рендерится в одну ленту вместе с sidebar; в fullscreen —
  // ограничивается шириной 3xl и сидит слева.
  function renderMain(d: IssueDetail) {
    return (
      <div className="flex flex-1 flex-col gap-5">
        <section aria-label="Description" className="flex flex-col gap-1.5">
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Description
          </h4>
          <DescriptionView detail={d} />
        </section>

        {isEpic ? (
          <EpicChildrenTree tasks={d.epicChildren} />
        ) : (
          <SubtaskList
            items={d.subtasks}
            parentKey={d.summary.key}
            inheritedDeployment={isOwnDevopsArtifact ? d.deployment : null}
          />
        )}

        <section aria-label="Activity tabs" className="flex flex-col gap-2">
          <div className="flex gap-1 border-b border-border" role="tablist">
            {(['comments', 'activity', 'worklog'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={
                  tab === t
                    ? 'border-b-2 border-primary px-3 py-1.5 text-sm font-medium'
                    : 'px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground'
                }
              >
                {t === 'comments'
                  ? `Comments (${d.comments.length})`
                  : t === 'activity'
                    ? 'Activity'
                    : `Worklog (${d.worklogs.length})`}
              </button>
            ))}
          </div>
          {tab === 'comments' ? (
            <CommentsTab issueKey={issueKey} comments={d.comments} currentUserId={currentUserId} />
          ) : tab === 'activity' ? (
            <ActivityTab issueKey={issueKey} enabled />
          ) : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {d.worklogs.length === 0 ? (
                <li className="italic text-muted-foreground">No worklogs.</li>
              ) : (
                d.worklogs.map((w) => (
                  <li key={w.id} className="flex flex-col gap-0.5 rounded border border-border p-2">
                    <span className="text-xs text-muted-foreground">
                      {new Date(w.startedAt).toLocaleString()} · {w.authorId} ·{' '}
                      {Math.round(w.seconds / 60)}m
                    </span>
                    {w.comment ? <span>{w.comment}</span> : null}
                  </li>
                ))
              )}
            </ul>
          )}
        </section>
      </div>
    )
  }

  // ─── Body layout ────────────────────────────────────────────────────
  // fullscreen → grid с sticky-сайдбаром справа; иначе — одна лента.
  function renderBody(d: IssueDetail) {
    if (fullscreen) {
      return (
        <div className="mx-auto flex w-full max-w-[1440px] flex-1 gap-8 overflow-y-auto px-6 py-6">
          <div className="min-w-0 flex-1">{renderMain(d)}</div>
          <div className="hidden w-80 shrink-0 lg:block">
            <div className="sticky top-4 flex max-h-[calc(100vh-6rem)] flex-col gap-5 overflow-y-auto pr-1">
              <IssueSidebar detail={d} />
            </div>
          </div>
          {/* На узких экранах sidebar едет ниже main, не сжимая колонку. */}
          <div className="lg:hidden" hidden />
        </div>
      )
    }
    return (
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {renderMain(d)}
        <IssueSidebar detail={d} />
      </div>
    )
  }

  return (
    // Esc-аналог реализован глобальным window keydown выше — ARIA-инвариант
    // диалога перекрыт; локальный keyboard-handler здесь продублирует Esc.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc closes via global keydown
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Issue ${issueKey}`}
      className={cn('fixed inset-0 z-50 flex', fullscreen ? 'bg-background' : 'bg-black/30')}
      onClick={(e) => {
        // Клик по бэкдропу закрывает; не закрываем при клике внутри панели.
        if (e.target === e.currentTarget) close()
      }}
    >
      <div
        className={
          fullscreen
            ? 'flex w-full flex-col bg-background'
            : 'ml-auto flex w-full max-w-2xl flex-col bg-background shadow-2xl'
        }
      >
        {data ? (
          <>
            <IssueHeader
              issue={data.summary}
              deployment={data.deployment}
              onClose={close}
              onPromote={togglePromote}
              fullscreen={fullscreen}
            />
            <EpicContextStrip detail={data} />
            {renderBody(data)}
          </>
        ) : isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading {issueKey}…
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            <p className="text-sm text-destructive">
              Failed to load {issueKey}: {(error as Error).message}
            </p>
            <button type="button" onClick={close} className="text-sm text-primary underline">
              Close
            </button>
          </div>
        ) : null}
      </div>
      {/* Workflow wizard монтируется один раз поверх панели. Видимость
          контролирует useWorkflowWizard.issueKey === issueKey. */}
      <WorkflowWizard issueKey={issueKey} />
    </div>
  )
}
