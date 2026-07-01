import { useEffect, useState } from 'react'
import type { FilterKind } from './types'

export interface Settings {
  /** When true, unread articles scrolled past the top of the list mark themselves as read. */
  autoMarkOnScroll: boolean
  /** Milliseconds to wait after an article leaves the viewport before marking it read.
   *  Higher = more forgiving of scroll-bounce; lower = snappier. */
  autoMarkDelayMs: number
  /** Article list row density. */
  density: 'comfortable' | 'compact'
  /** Filter applied on first page load. */
  defaultFilter: FilterKind
}

export const DEFAULT_SETTINGS: Settings = {
  autoMarkOnScroll: true,
  autoMarkDelayMs: 700,
  density: 'comfortable',
  defaultFilter: 'unread',
}

const STORAGE_KEY = 'feedler.settings.v1'

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function save(s: Settings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* quota? ignore */ }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, () => void] {
  const [settings, setSettings] = useState<Settings>(() => load())

  // Persist on change
  useEffect(() => { save(settings) }, [settings])

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try { setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(e.newValue) }) } catch { /* ignore */ }
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const update = (patch: Partial<Settings>) => setSettings(s => ({ ...s, ...patch }))
  const reset = () => setSettings(DEFAULT_SETTINGS)
  return [settings, update, reset]
}
