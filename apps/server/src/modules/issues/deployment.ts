// Классификатор «состояния развёртывания» для Platform Devops Task — артефакта,
// который собирает change-задачи и катится в прод как единое целое. Источник
// сигнала — имя статуса задачи; поток см. docs/specs/13-jira-reality.md
// (Platform Devops Task: To Do → … → Deploying to production → Ready To
// Production → Waiting Feedback (Live) → Done).
//
// «Deployed» — артефакт уже в проде; «deploying» — выкатка в процессе;
// «not-deployed» — артефакт в препе/скоринге; null — issue не относится к
// этому workflow (рендерим бейдж только если есть конкретный сигнал).

export type DeploymentState = 'not-deployed' | 'deploying' | 'deployed'

export interface DeploymentInfo {
  state: DeploymentState
  // Имя статуса, по которому посчитано состояние (отображается в tooltip'е).
  statusName: string
  // Ключ артефакта Platform Devops Task. Совпадает с issue.key, если бейдж
  // считается прямо по самой задаче; иначе — ключ родительского/связанного
  // Platform Devops Task.
  devopsTaskKey: string
}

// Имена нормализуем к lower-case без диакритик — Jira-инстанс смешивает
// англ./рус. и регистры. Сопоставление по точному совпадению, иначе можно
// поймать ложноположительные («Ready to refactor» и т.п.).
const DEPLOYED_NAMES = new Set<string>(['ready to production', 'waiting feedback (live)', 'done'])

const DEPLOYING_NAMES = new Set<string>(['deploying to production', 'stress testing'])

const DEVOPS_TYPE_NAMES = new Set<string>(['platform devops task', 'devops task', 'platform task'])

export function isDevopsArtifactType(issueTypeName: string | null | undefined): boolean {
  if (!issueTypeName) return false
  return DEVOPS_TYPE_NAMES.has(issueTypeName.toLowerCase().trim())
}

// Централизованная проверка «это эпик». Используется и сервером (включать ли
// epicChildren-выборку), и клиентом (рендерить ли EpicChildrenTree вместо
// SubtaskList). Расхождение в нормализации привело бы к тому, что бэк
// прислал бы детей, а UI бы их не показал, или наоборот.
export function isEpicType(issueTypeName: string | null | undefined): boolean {
  if (!issueTypeName) return false
  return issueTypeName.toLowerCase().trim() === 'epic'
}

// Состояние артефакта по его собственному статусу. Используется и для самой
// Platform Devops Task, и для пропагации на её сабтаски/связи.
export function classifyDeploymentByStatus(statusName: string): DeploymentState {
  const n = statusName.toLowerCase().trim()
  if (DEPLOYED_NAMES.has(n)) return 'deployed'
  if (DEPLOYING_NAMES.has(n)) return 'deploying'
  return 'not-deployed'
}

export function buildDeploymentInfo(
  artifactKey: string,
  artifactStatusName: string,
): DeploymentInfo {
  return {
    state: classifyDeploymentByStatus(artifactStatusName),
    statusName: artifactStatusName,
    devopsTaskKey: artifactKey,
  }
}
