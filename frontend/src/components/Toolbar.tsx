import type { FilterKind } from '../types'

interface Props {
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  refreshing: boolean
  onRefresh: () => void
  onOpenExport: () => void
  onOpenImport: () => void
  onOpenSettings: () => void
  filter: FilterKind
  onFilter: (f: FilterKind) => void
  search: string
  onSearch: (s: string) => void
  onMarkAllRead: () => void
  totalUnread: number
  onToggleSidebar: () => void
}

export function Toolbar(p: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-100 dark:border-ink-800 bg-white dark:bg-ink-950">
      <button
        className="p-1.5 rounded hover:bg-ink-100 dark:hover:bg-ink-800"
        onClick={p.onToggleSidebar}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      </button>

      <button
        className="px-2.5 py-1.5 rounded-md text-sm font-medium hover:bg-ink-100 dark:hover:bg-ink-800 disabled:opacity-50 flex items-center gap-1.5"
        onClick={p.onRefresh}
        disabled={p.refreshing}
        title="Refresh all feeds (r)"
      >
        <span className={p.refreshing ? 'spin inline-block' : 'inline-block'}>↻</span>
        <span className="hidden sm:inline">{p.refreshing ? 'Refreshing…' : 'Refresh'}</span>
      </button>

      <FilterPill
        label={`Unread${p.totalUnread ? ` (${p.totalUnread})` : ''}`}
        active={p.filter === 'unread'}
        onClick={() => p.onFilter('unread')}
      />
      <FilterPill label="All" active={p.filter === 'all'} onClick={() => p.onFilter('all')} />
      <FilterPill label="Starred" active={p.filter === 'starred'} onClick={() => p.onFilter('starred')} />

      <div className="flex-1 min-w-0 px-2">
        <input
          id="search-input"
          type="text"
          value={p.search}
          onChange={e => p.onSearch(e.target.value)}
          placeholder="Search… (press /)"
          className="w-full max-w-md px-3 py-1.5 text-sm rounded-md bg-ink-100 dark:bg-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-500"
        />
      </div>

      <button
        className="px-2.5 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
        onClick={p.onMarkAllRead}
        title="Mark all visible articles as read"
      >
        ✓ Read all
      </button>
      <button
        className="px-2.5 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
        onClick={p.onOpenExport}
        title="Export Markdown (e)"
      >
        ⇩ Export
      </button>
      <button
        className="px-2.5 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
        onClick={p.onOpenImport}
        title="Import OPML"
      >
        ⤒ Import
      </button>
      <button
        className="p-1.5 rounded hover:bg-ink-100 dark:hover:bg-ink-800"
        onClick={p.onToggleTheme}
        title="Toggle theme"
        aria-label="Toggle theme"
      >
        {p.theme === 'dark' ? '☀' : '☾'}
      </button>
      <button
        className="p-1.5 rounded hover:bg-ink-100 dark:hover:bg-ink-800"
        onClick={p.onOpenSettings}
        title="Settings"
        aria-label="Settings"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
    </div>
  )
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md text-sm font-medium ${
        active
          ? 'bg-accent-500 text-white'
          : 'hover:bg-ink-100 dark:hover:bg-ink-800 text-ink-600 dark:text-ink-300'
      }`}
    >
      {label}
    </button>
  )
}
