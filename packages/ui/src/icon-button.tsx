import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

// Иконочная кнопка для топбара и rail nav. Поддерживает aria-current="page"
// для активного состояния в навигации.

type Size = 'sm' | 'md'

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size
  active?: boolean
}

const sizes: Record<Size, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, size = 'md', active, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'grid place-items-center rounded-md text-[color:var(--text-tertiary)] transition-colors',
        'hover:bg-[color:var(--surface)] hover:text-[color:var(--text-secondary)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]',
        active && 'bg-[color:var(--accent-tint)] text-[color:var(--accent)] hover:bg-[color:var(--accent-tint)] hover:text-[color:var(--accent)]',
        sizes[size],
        className,
      )}
      {...rest}
    />
  )
})
