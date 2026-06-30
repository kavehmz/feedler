import { useEffect } from 'react'
import type { Settings } from '../settings'
import type { FilterKind } from '../types'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onReset: () => void
  onClose: () => void
}

export function SettingsDialog({ settings, onChange, onReset, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-ink-900 rounded-lg shadow-2xl w-full max-w-lg"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-ink-100 dark:border-ink-800 flex items-center justify-between">
          <h3 className="font-semibold">Settings</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {/* Auto-mark as read on scroll */}
          <Section title="Reading">
            <Toggle
              label="Mark articles as read when I scroll past them"
              hint="Reeder-style: when an unread article scrolls off the top of the list, it gets marked read automatically."
              checked={settings.autoMarkOnScroll}
              onChange={v => onChange({ autoMarkOnScroll: v })}
            />

            <div className={settings.autoMarkOnScroll ? '' : 'opacity-50 pointer-events-none'}>
              <div className="flex items-baseline justify-between">
                <label className="text-sm">Delay before marking read</label>
                <span className="text-xs tabular-nums text-ink-400">{settings.autoMarkDelayMs}ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={3000}
                step={100}
                value={settings.autoMarkDelayMs}
                onChange={e => onChange({ autoMarkDelayMs: parseInt(e.target.value, 10) })}
                className="w-full mt-1 accent-accent-500"
              />
              <div className="text-xs text-ink-400 dark:text-ink-500">
                Lower = snappier · Higher = more forgiving of scroll-bounce
              </div>
            </div>
          </Section>

          <Section title="Layout">
            <RadioGroup
              label="Article list density"
              value={settings.density}
              options={[
                { value: 'comfortable', label: 'Comfortable' },
                { value: 'compact', label: 'Compact' },
              ]}
              onChange={v => onChange({ density: v as Settings['density'] })}
            />
          </Section>

          <Section title="Defaults">
            <RadioGroup
              label="Filter when I open Feedler"
              value={settings.defaultFilter}
              options={[
                { value: 'unread', label: 'Unread' },
                { value: 'all', label: 'All' },
                { value: 'starred', label: 'Starred' },
              ]}
              onChange={v => onChange({ defaultFilter: v as FilterKind })}
            />
          </Section>

          <div className="flex items-center justify-between pt-2 border-t border-ink-100 dark:border-ink-800">
            <button
              onClick={() => { if (confirm('Reset all settings to defaults?')) onReset() }}
              className="text-sm text-ink-500 hover:text-red-600"
            >Reset to defaults</button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent-500 text-white hover:bg-accent-600"
            >Done</button>
          </div>

          <div className="text-xs text-ink-400 dark:text-ink-500 leading-relaxed">
            Settings are stored in your browser (localStorage). Server-side preferences
            (refresh interval, timezone for exports) are controlled by environment
            variables in <code>docker-compose.yml</code>.
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wide text-ink-400 dark:text-ink-500 font-semibold">{title}</div>
      {children}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-1 accent-accent-500"
      />
      <div className="flex-1">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-ink-400 dark:text-ink-500 mt-0.5">{hint}</div>}
      </div>
    </label>
  )
}

function RadioGroup({ label, value, options, onChange }: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <div className="text-sm mb-1.5">{label}</div>
      <div className="flex gap-1 rounded-md bg-ink-100 dark:bg-ink-800 p-0.5">
        {options.map(o => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 px-3 py-1.5 text-sm rounded ${
              value === o.value
                ? 'bg-white dark:bg-ink-700 shadow-sm font-medium'
                : 'text-ink-500 dark:text-ink-400 hover:text-ink-800 dark:hover:text-ink-200'
            }`}
          >{o.label}</button>
        ))}
      </div>
    </div>
  )
}
