import type { IssueDetail } from '../types'

// Read-only представление описания. ADF-рендер появится позже (TipTap M6+);
// сейчас выводим плоский текст из description_text — он уже извлекается
// сервером при sync'е и хранится отдельно для FTS.

export function DescriptionView({ detail }: { detail: IssueDetail }) {
  const text = detail.descriptionText?.trim() ?? ''
  if (!text) {
    return <p className="text-sm italic text-muted-foreground">No description.</p>
  }
  return <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{text}</div>
}
