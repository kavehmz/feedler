import { useEffect } from 'react'

interface Props { onClose: () => void }

const GROUPS: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['j'], desc: 'Next article' },
      { keys: ['k'], desc: 'Previous article' },
      { keys: ['/'], desc: 'Focus search' },
    ],
  },
  {
    title: 'On the selected article',
    items: [
      { keys: ['m'], desc: 'Toggle read / unread' },
      { keys: ['s'], desc: 'Star / unstar' },
      { keys: ['o'], desc: 'Open original in new tab' },
    ],
  },
  {
    title: 'In the current view (sidebar selection)',
    items: [
      { keys: ['Shift', 'M'], desc: 'Mark all as read' },
    ],
  },
  {
    title: 'App',
    items: [
      { keys: ['r'], desc: 'Refresh all feeds' },
      { keys: ['e'], desc: 'Export to Markdown' },
      { keys: ['?'], desc: 'Show this list' },
      { keys: ['Esc'], desc: 'Close any dialog' },
    ],
  },
]

export function ShortcutsDialog({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-ink-900 rounded-lg shadow-2xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-ink-100 dark:border-ink-800 flex items-center justify-between">
          <h3 className="font-semibold">Keyboard shortcuts</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 text-xl leading-none">×</button>
        </div>

        <div className="p-5 space-y-5">
          {GROUPS.map(g => (
            <div key={g.title}>
              <div className="text-xs uppercase tracking-wide text-ink-400 dark:text-ink-500 font-semibold mb-2">
                {g.title}
              </div>
              <div className="space-y-1.5">
                {g.items.map(item => (
                  <div key={item.desc} className="flex items-center justify-between text-sm">
                    <span className="text-ink-700 dark:text-ink-200">{item.desc}</span>
                    <div className="flex gap-1">
                      {item.keys.map(k => <Kbd key={k}>{k}</Kbd>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          <div className="pt-2 border-t border-ink-100 dark:border-ink-800 text-xs text-ink-400 dark:text-ink-500">
            Shortcuts are disabled while you're typing in a text field.
          </div>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 min-w-[24px] text-center rounded border border-ink-200 dark:border-ink-700 bg-ink-50 dark:bg-ink-800 text-xs font-mono font-medium text-ink-700 dark:text-ink-200 shadow-[0_1px_0_rgba(0,0,0,0.05)]">
      {children}
    </kbd>
  )
}
