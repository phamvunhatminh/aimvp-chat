import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function newId(): string {
  return crypto.randomUUID()
}

export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}
