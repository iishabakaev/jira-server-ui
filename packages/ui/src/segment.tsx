import type { ReactNode } from 'react'
import { cn } from './cn'

// Сегментированный переключатель (Group / Density / Layout). Управляемый
// компонент: значение наружу, варианты — через массив items. Стилистика
// повторяет .seg из ALFAIAAS spec'а: тонкий border-контейнер, активный
// сегмент чуть приподнят.

export interface SegmentItem<T extends string> {
  value: T
  label: ReactNode
  title?: string
}

export interface SegmentProps<T extends string> {
  value: T
  items: SegmentItem<T>[]
  onChange: (next: T) => void
  className?: string
  ariaLabel?: string
}

export function Segment<T extends string>({
  value,
  items,
  onChange,
  className,
  ariaLabel,
}: SegmentProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex gap-[2px] rounded-[5px] border border-[color:var(--border)] bg-[color:var(--surface)] p-[2px]',
        className,
      )}
    >
      {items.map((it) => {
        const pressed = it.value === value
        return (
          <button
            type="button"
            key={it.value}
            role="tab"
            aria-pressed={pressed}
            aria-selected={pressed}
            title={it.title}
            onClick={() => onChange(it.value)}
            className={cn(
              'rounded-[3px] px-[7px] py-[3px] text-[11.5px] font-medium transition-colors',
              pressed
                ? 'bg-[color:var(--surface-elev)] text-[color:var(--text-primary)] shadow-[inset_0_1px_0_0_var(--border-strong)]'
                : 'text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]',
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
