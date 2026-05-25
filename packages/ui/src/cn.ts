import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Стандартный shadcn-стиль cn(): clsx для условий + tailwind-merge для
// корректного слияния конфликтующих утилит.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
