import { useEffect } from 'react'
import { useProjectDetail } from '../../projects'
import { useQuickCreateUi } from '../store'
import { QuickCreateDialog } from './QuickCreateDialog'

// Provider монтируется на kanban-странице. Делает две вещи:
//   1. Слушает глобальный hotkey 'c' и открывает quick-create, если
//      пользователь не печатает в input/textarea/contenteditable.
//   2. Рендерит модалку с project detail, подтягивая availableIssueTypes.

type Props = {
  projectId: string | null
}

function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLInputElement) {
    // type=button/submit и т.п. — это не textentry, пропускаем
    const type = el.type
    return type !== 'button' && type !== 'submit' && type !== 'reset' && type !== 'checkbox'
  }
  if (el instanceof HTMLTextAreaElement) return true
  if (el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return false
}

export function QuickCreateProvider({ projectId }: Props) {
  const open = useQuickCreateUi((s) => s.open)
  const openDialog = useQuickCreateUi((s) => s.openDialog)
  const closeDialog = useQuickCreateUi((s) => s.closeDialog)

  // project detail — для availableIssueTypes. Хук переживает
  // projectId=null и просто возвращает enabled=false, ничего не фетча.
  const project = useProjectDetail(projectId)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Лёгкие отсечки идут первыми, чтобы не делать лишних проверок.
      if (e.repeat) return
      if (e.isComposing || e.keyCode === 229) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key !== 'c' && e.key !== 'C') return
      if (isTextEntryElement(document.activeElement)) return
      // Не открываем второй раз поверх уже открытой модалки.
      // getState() читает live-значение store'а, минуя стейл-замыкание.
      if (useQuickCreateUi.getState().open) return
      // Тот же гейт, что у кнопки «+ New» в TopBar'е: hotkey активен сразу,
      // как только выбран проект. Если issue-types ещё не подтянуты — диалог
      // сам отрисует «Loading project metadata…» / «run refresh-metadata first».
      if (!projectId) return

      e.preventDefault()
      openDialog(projectId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openDialog, projectId])

  return <QuickCreateDialog open={open} project={project.data ?? null} onClose={closeDialog} />
}
