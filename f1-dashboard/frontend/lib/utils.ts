import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Backend team colors come without a '#' prefix; normalize for CSS use. */
export function hexColor(c: string | null | undefined): string | null {
  if (!c) return null
  return c.startsWith('#') ? c : `#${c}`
}
