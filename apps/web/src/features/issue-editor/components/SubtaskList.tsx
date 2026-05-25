import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link } from '@tanstack/react-router'
import { cn } from '@ui/index'
import { useReorderSubtasks } from '../hooks'
import type { DeploymentInfo, SubtaskSummary } from '../types'
import { DeploymentBadge } from './DeploymentBadge'

// Inline-checklist сабтасков. M6: read-only чекбоксы + drag-reorder через
// @dnd-kit/sortable. Drop изменяет orderingRank (POST /api/issues/batch-rank,
// см. useReorderSubtasks). Чекбокс пока не триггерит transition — это
// сделает workflow-wizard на следующей итерации.

const CATEGORY_TEXT: Record<SubtaskSummary['statusCategory'], string> = {
  new: 'text-muted-foreground',
  indeterminate: 'text-blue-700',
  done: 'text-emerald-700 line-through',
}

interface SubtaskRowProps {
  subtask: SubtaskSummary
  // Унаследованный deployment-state. Передаём, если родительская задача —
  // Platform Devops Task: тогда сабтаски-change-tasks отображают тот же бейдж.
  inheritedDeployment?: DeploymentInfo | null
}

function SubtaskRow({ subtask, inheritedDeployment }: SubtaskRowProps) {
  const sortable = useSortable({ id: subtask.id })
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }
  return (
    <li
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted/50',
        sortable.isDragging && 'opacity-50',
      )}
    >
      {/* Drag-ручка — отдельный элемент: клик по строке открывает сабтаск,
          а drag захватывается только за ручку, иначе TanStack Link перехватывает. */}
      <button
        type="button"
        aria-label={`Reorder ${subtask.key}`}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <DragHandleIcon />
      </button>
      <input
        type="checkbox"
        checked={subtask.statusCategory === 'done'}
        readOnly
        aria-label={`Status: ${subtask.statusName}`}
        className="size-3.5"
      />
      <Link
        to="/issues/$key"
        params={{ key: subtask.key }}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 text-sm hover:underline',
          CATEGORY_TEXT[subtask.statusCategory],
        )}
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{subtask.key}</span>
        <span className="truncate">{subtask.summary}</span>
      </Link>
      {inheritedDeployment ? <DeploymentBadge info={inheritedDeployment} size="sm" /> : null}
    </li>
  )
}

function DragHandleIcon() {
  // Шесть точек 3×2 — стандартная пиктограмма "перетащить".
  return (
    <svg
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="currentColor"
      aria-hidden="true"
      className="size-3"
    >
      <circle cx="2" cy="3" r="1" />
      <circle cx="2" cy="7" r="1" />
      <circle cx="2" cy="11" r="1" />
      <circle cx="8" cy="3" r="1" />
      <circle cx="8" cy="7" r="1" />
      <circle cx="8" cy="11" r="1" />
    </svg>
  )
}

export interface SubtaskListProps {
  items: SubtaskSummary[]
  // keyOrId родительского issue нужен, чтобы reorder-мутация обновила
  // правильный detail-кеш в React Query.
  parentKey: string
  // Унаследованный deployment: если родительская задача — Platform Devops Task,
  // сабтаски считаются «выкатанными» вместе с артефактом. Бейдж показываем
  // на каждой строке.
  inheritedDeployment?: DeploymentInfo | null
}

export function SubtaskList({ items, parentKey, inheritedDeployment }: SubtaskListProps) {
  const reorder = useReorderSubtasks(parentKey)
  const sensors = useSensors(
    // distance-порог в 4px нужен, чтобы обычный клик по Link внутри строки
    // не превращался в drag-старт.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (items.length === 0) {
    return null
  }
  const doneCount = items.filter((s) => s.statusCategory === 'done').length

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const fromIdx = items.findIndex((s) => s.id === active.id)
    const toIdx = items.findIndex((s) => s.id === over.id)
    if (fromIdx < 0 || toIdx < 0) return
    const ordered = arrayMove(items, fromIdx, toIdx)
    // Соседи определяем по фактической позиции перетащенного элемента в новом
    // массиве, а не по toIdx — robust к будущим изменениям arrayMove и
    // совпадает с конвенцией useKanbanDnd.
    const finalIdx = ordered.findIndex((s) => s.id === active.id)
    if (finalIdx < 0) return
    const beforeId = finalIdx > 0 ? ordered[finalIdx - 1]!.id : null
    const afterId = finalIdx < ordered.length - 1 ? ordered[finalIdx + 1]!.id : null
    reorder.mutate({
      ordered,
      payload: { subtaskId: String(active.id), beforeId, afterId },
    })
  }

  return (
    <section aria-label="Subtasks" className="flex flex-col gap-1">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Subtasks{' '}
        <span className="font-normal">
          ({doneCount}/{items.length} done)
        </span>
      </h4>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Press space or enter to pick up a subtask, use arrow keys to move, space or enter to drop, escape to cancel.',
          },
        }}
      >
        <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5">
            {items.map((s) => (
              <SubtaskRow key={s.id} subtask={s} inheritedDeployment={inheritedDeployment} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  )
}
