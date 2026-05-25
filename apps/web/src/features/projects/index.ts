// Публичные экспорты фичи projects. Кросс-фичевый импорт допустим только
// из этого файла (см. .agents/PATTERNS.md).

export type {
  ProjectAvailableIssueType,
  ProjectDetail,
  ProjectListItem,
  ProjectSprint,
  ProjectsError,
} from './api'
export { fetchProjectDetail, fetchProjectSprints, fetchProjects } from './api'
export { ProjectPicker } from './components/ProjectPicker'
export { projectsKeys, useProjectDetail, useProjectSprints, useProjects } from './hooks'
export { filterProjects, scoreProject } from './lib/fuzzy'
