import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from './cn'

// Универсальный shadcn-style бейдж. Используется для эпик-чипов, лейблов,
// статус-pill'ов. Цветовая логика наружу — через style/className.

type Variant = 'default' | 'outline' | 'soft' | 'destructive'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant
}

const variants: Record<Variant, string> = {
  default: 'bg-[color:var(--surface-elev)] text-[color:var(--text-primary)] border border-[color:var(--border)]',
  outline: 'bg-transparent text-[color:var(--text-secondary)] border border-[color:var(--border)]',
  soft: 'bg-[color:var(--surface)] text-[color:var(--text-secondary)] border border-[color:var(--border)]',
  destructive: 'bg-[color:var(--state-error-tint)] text-[color:var(--state-error)] border border-[color:var(--state-error)]/30',
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant = 'default', ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-px text-[10.5px] font-medium leading-tight',
        variants[variant],
        className,
      )}
      {...rest}
    />
  )
})
