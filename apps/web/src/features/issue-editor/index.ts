// Публичные экспорты фичи issue-editor. Внешним модулям доступны только эти
// сущности (см. .agents/PATTERNS.md — кросс-фичевый импорт только из index).

export { IssueEditorError } from './api'
export { IssuePanel } from './components/IssuePanel'
export {
  issueEditorKeys,
  useAddComment,
  useDeleteComment,
  useEditComment,
  useIssueActivity,
  useIssueDetail,
  useIssueTransitions,
  usePatchIssue,
  useTransitionIssue,
} from './hooks'
export type {
  DeploymentInfo,
  DeploymentState,
  EpicChildTask,
  IssueActivityEntry,
  IssueComment,
  IssueDetail,
  IssueLinkRef,
  IssuePatchInput,
  IssueSummary,
  SubtaskSummary,
  TransitionOption,
  TransitionsResponse,
} from './types'
