import { useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type { Feed, FeedsResponse, Selection } from '../types'

interface Props {
  feeds: FeedsResponse | null
  selection: Selection
  onSelect: (s: Selection) => void
  onChanged: () => void  // reload feeds (after add/remove/rename)
}

export function Sidebar({ feeds, selection, onSelect, onChanged }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [addOpen, setAddOpen] = useState(false)
  const [errorFeed, setErrorFeed] = useState<Feed | null>(null)

  const toggleFolder = (n: string) => setCollapsed(c => ({ ...c, [n]: !c[n] }))

  const folderNames = useMemo(
    () => feeds?.folders.map(f => f.name).filter(n => n !== 'Uncategorized') ?? [],
    [feeds],
  )

  const isActive = (s: Selection): boolean => {
    if (s.kind !== selection.kind) return false
    if (s.kind === 'feed' && selection.kind === 'feed') return s.feedId === selection.feedId
    if (s.kind === 'folder' && selection.kind === 'folder') return s.folder === selection.folder
    return true
  }

  return (
    <aside className="w-72 shrink-0 h-full overflow-y-auto border-r border-ink-100 dark:border-ink-800 bg-ink-50/50 dark:bg-ink-900/40">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-accent-500 flex items-center justify-center text-white font-bold">F</div>
        <div className="font-semibold text-lg flex-1">Feedler</div>
        <button
          onClick={() => setAddOpen(o => !o)}
          className="px-2 py-1 rounded-md text-xs font-medium bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 dark:hover:bg-ink-700"
          title="Add a new feed"
        >
          {addOpen ? '×' : '+ Add'}
        </button>
      </div>

      {addOpen && (
        <AddFeedForm
          folders={folderNames}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); onChanged() }}
        />
      )}

      <nav className="px-2 pb-6">
        <SidebarItem
          label="All articles"
          icon="📰"
          unread={feeds?.total_unread ?? 0}
          active={isActive({ kind: 'all' })}
          onClick={() => onSelect({ kind: 'all' })}
        />
        <SidebarItem
          label="Starred"
          icon="⭐"
          unread={feeds?.total_starred ?? 0}
          active={isActive({ kind: 'starred' })}
          onClick={() => onSelect({ kind: 'starred' })}
        />

        <div className="mt-4 mb-1 px-3 text-xs uppercase tracking-wide text-ink-400 dark:text-ink-500">Folders</div>

        {feeds?.folders.map(folder => {
          const isOpen = !collapsed[folder.name]
          return (
            <div key={folder.name}>
              <div className="flex items-center group">
                <button
                  className="px-1.5 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                  onClick={() => toggleFolder(folder.name)}
                  title={isOpen ? 'Collapse' : 'Expand'}
                >
                  {isOpen ? '▾' : '▸'}
                </button>
                <button
                  className={`flex-1 flex items-center justify-between px-2 py-1.5 rounded-md text-sm
                    ${isActive({ kind: 'folder', folder: folder.name }) ? 'sidebar-item-active' : 'hover:bg-ink-100 dark:hover:bg-ink-800'}`}
                  onClick={() => onSelect({ kind: 'folder', folder: folder.name })}
                >
                  <span className="truncate">{folder.name}</span>
                  {folder.unread_count > 0 && (
                    <span className="ml-2 text-xs tabular-nums text-ink-400 dark:text-ink-500">{folder.unread_count}</span>
                  )}
                </button>
              </div>
              {isOpen && (
                <div className="ml-5 mt-0.5">
                  {folder.feeds.map(f => (
                    <FeedRow
                      key={f.id}
                      feed={f}
                      active={isActive({ kind: 'feed', feedId: f.id })}
                      folders={folderNames}
                      onSelect={() => onSelect({ kind: 'feed', feedId: f.id, feedTitle: f.title })}
                      onShowError={() => setErrorFeed(f)}
                      onChanged={onChanged}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {errorFeed && (
        <ErrorDetailsDialog feed={errorFeed} onClose={() => setErrorFeed(null)} />
      )}
    </aside>
  )
}

function FeedRow({
  feed, active, folders, onSelect, onShowError, onChanged,
}: {
  feed: Feed
  active: boolean
  folders: string[]
  onSelect: () => void
  onShowError: () => void
  onChanged: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const handleRefresh = async () => {
    setBusy(true); setMenuOpen(false)
    try { await api.refreshOne(feed.id); onChanged() }
    finally { setBusy(false) }
  }
  const handleRemove = async () => {
    setMenuOpen(false)
    if (!confirm(`Remove feed "${feed.title}"?\nThis deletes ${feed.unread_count}+ stored articles for this feed.`)) return
    await api.deleteFeed(feed.id)
    onChanged()
  }
  const handleRename = async () => {
    setMenuOpen(false)
    const next = prompt('New title:', feed.title)
    // No-op when the trimmed title is empty or unchanged (feed_management §3.2).
    if (next == null || next.trim() === '' || next.trim() === feed.title) return
    await api.updateFeed(feed.id, { title: next.trim() })
    onChanged()
  }
  const handleMove = async () => {
    setMenuOpen(false)
    const next = prompt(
      `Move "${feed.title}" to folder:\n(existing: ${folders.join(', ') || '(none)'})`,
      feed.folder,
    )
    if (next == null) return
    await api.updateFeed(feed.id, { folder: next.trim() })
    onChanged()
  }
  const handleCopyURL = async () => {
    setMenuOpen(false)
    // Clipboard can be denied (insecure context); fail visibly, never silently
    // (feed_management §3.4/§7, honesty — start.md §0).
    try {
      await navigator.clipboard.writeText(feed.xml_url)
    } catch {
      alert('Could not copy the feed URL — clipboard access was denied.\n\n' + feed.xml_url)
    }
  }

  return (
    <div className={`group/row flex items-center rounded-md ${active ? 'sidebar-item-active' : 'hover:bg-ink-100 dark:hover:bg-ink-800'}`}>
      <button
        onClick={onSelect}
        title={feed.last_error ? `Error: ${feed.last_error}` : feed.xml_url}
        className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 text-sm"
      >
        <span className="flex items-center gap-2 min-w-0">
          {feed.last_error ? (
            <button
              onClick={(e) => { e.stopPropagation(); onShowError() }}
              className="text-red-500 hover:text-red-600"
              title="Click to see the error"
            >⚠</button>
          ) : (
            <span className="text-ink-400">·</span>
          )}
          <span className={`truncate ${busy ? 'opacity-50' : ''}`}>{feed.title || feed.xml_url}</span>
        </span>
        {feed.unread_count > 0 && (
          <span className="text-xs tabular-nums text-ink-400 dark:text-ink-500">{feed.unread_count}</span>
        )}
      </button>
      <div className="relative" ref={menuRef}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o) }}
          className="px-1.5 py-1 opacity-0 group-hover/row:opacity-100 focus:opacity-100 text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
          title="Feed actions"
          aria-label="Feed actions"
        >⋯</button>
        {menuOpen && (
          <div className="absolute right-0 top-7 z-20 w-44 bg-white dark:bg-ink-800 rounded-md shadow-lg border border-ink-100 dark:border-ink-700 py-1 text-sm">
            <MenuItem onClick={handleRefresh}>↻ Refresh now</MenuItem>
            <MenuItem onClick={handleRename}>✎ Rename</MenuItem>
            <MenuItem onClick={handleMove}>📁 Move to folder…</MenuItem>
            <MenuItem onClick={handleCopyURL}>⎘ Copy feed URL</MenuItem>
            {feed.last_error && <MenuItem onClick={onShowError}>⚠ Show error</MenuItem>}
            <div className="my-1 border-t border-ink-100 dark:border-ink-700" />
            <MenuItem danger onClick={handleRemove}>🗑 Remove</MenuItem>
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ children, onClick, danger }: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left px-3 py-1.5 hover:bg-ink-100 dark:hover:bg-ink-700 ${
        danger ? 'text-red-600 dark:text-red-400' : ''
      }`}
    >{children}</button>
  )
}

function AddFeedForm({
  folders, onClose, onAdded,
}: { folders: string[]; onClose: () => void; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true); setError(null)
    try {
      await api.addFeed({ xml_url: url.trim(), folder: folder.trim() || undefined })
      setUrl(''); setFolder('')
      onAdded()
    } catch (err: any) {
      setError(err?.message || 'Failed to add feed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mx-3 mb-3 p-3 rounded-md bg-white dark:bg-ink-900 border border-ink-100 dark:border-ink-800 space-y-2">
      <div className="text-xs uppercase tracking-wide text-ink-400 dark:text-ink-500">Add feed</div>
      <input
        type="url"
        autoFocus
        required
        placeholder="https://example.com/feed.xml"
        value={url}
        onChange={e => setUrl(e.target.value)}
        className="w-full px-2 py-1.5 text-sm rounded bg-ink-100 dark:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
      <input
        list="folder-options"
        placeholder="Folder (optional, e.g. AI)"
        value={folder}
        onChange={e => setFolder(e.target.value)}
        className="w-full px-2 py-1.5 text-sm rounded bg-ink-100 dark:bg-ink-800 focus:outline-none focus:ring-2 focus:ring-accent-500"
      />
      <datalist id="folder-options">
        {folders.map(f => <option key={f} value={f} />)}
      </datalist>
      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className="px-2.5 py-1 text-xs rounded hover:bg-ink-100 dark:hover:bg-ink-800">Cancel</button>
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="px-2.5 py-1 text-xs rounded-md font-medium bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
        >{busy ? 'Adding…' : 'Add'}</button>
      </div>
    </form>
  )
}

function ErrorDetailsDialog({ feed, onClose }: { feed: Feed; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-ink-900 rounded-lg shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-ink-100 dark:border-ink-800 flex items-center justify-between">
          <h3 className="font-semibold">Feed error</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-400">Feed</div>
            <div className="font-medium">{feed.title}</div>
            <a href={feed.xml_url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent-600 dark:text-accent-400 hover:underline break-all">
              {feed.xml_url}
            </a>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-400">Last error</div>
            <pre className="mt-1 p-3 rounded bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs whitespace-pre-wrap break-words">
              {feed.last_error || '(none)'}
            </pre>
          </div>
          {feed.last_fetched_at && (
            <div className="text-xs text-ink-500">
              Last fetched: {new Date(feed.last_fetched_at).toLocaleString()}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm rounded hover:bg-ink-100 dark:hover:bg-ink-800">Close</button>
            <button
              onClick={async () => { await api.refreshOne(feed.id); onClose() }}
              className="px-3 py-1.5 text-sm rounded-md font-medium bg-accent-500 text-white hover:bg-accent-600"
            >Retry now</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function SidebarItem({
  label, icon, unread, active, onClick,
}: { label: string; icon: string; unread: number; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium
        ${active ? 'sidebar-item-active' : 'hover:bg-ink-100 dark:hover:bg-ink-800'}`}
      onClick={onClick}
    >
      <span className="flex items-center gap-2">
        <span>{icon}</span>
        <span>{label}</span>
      </span>
      {unread > 0 && (
        <span className="text-xs tabular-nums text-ink-400 dark:text-ink-500">{unread}</span>
      )}
    </button>
  )
}
