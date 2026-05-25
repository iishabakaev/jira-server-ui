// Клиентское зеркало серверных хелперов из apps/server/src/modules/issues/
// deployment.ts. Дублирование узкое и осознанное: сервер и клиент должны
// одинаково отвечать на вопрос «это эпик?» / «это Platform Devops Task?»,
// иначе IssuePanel рисует SubtaskList, а сервер вернул epicChildren — или
// наоборот. При расширении набора имён правьте оба файла одним PR'ом.

const DEVOPS_TYPE_NAMES = new Set<string>(['platform devops task', 'devops task', 'platform task'])

export function isEpicType(issueTypeName: string | null | undefined): boolean {
  if (!issueTypeName) return false
  return issueTypeName.toLowerCase().trim() === 'epic'
}

export function isDevopsArtifactType(issueTypeName: string | null | undefined): boolean {
  if (!issueTypeName) return false
  return DEVOPS_TYPE_NAMES.has(issueTypeName.toLowerCase().trim())
}
