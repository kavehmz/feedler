import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from './api'
import type { Article, FeedsResponse, FilterKind, Selection } from './types'
import { Sidebar } from './components/Sidebar'
import { ArticleList } from './components/ArticleList'
import { ArticleView } from './components/ArticleView'
import { Toolbar } from './components/Toolbar'
import { ExportDialog } from './components/ExportDialog'
import { ImportDialog } from './components/ImportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { useSettings } from './settings'

// Deep link: the BE redirects /a/{id} to /?article={id} (api_contract §7).
function readDeepLinkId(): number | null {
  const a = new URL(window.location.href).searchParams.get('article')
  if (!a) return null
  const id = parseInt(a, 10)
  return Number.isNaN(id) ? null : id
}

export function App() {
  const [settings, updateSettings, resetSettings] = useSettings()
  const [deepLinkId] = useState(readDeepLinkId)
  const [feeds, setFeeds] = useState<FeedsResponse | null>(null)
  const [selection, setSelection] = useState<Selection>({ kind: 'all' })
  // A deep-link overrides defaultFilter with `all` for this load (reading_spec §10).
  const [filter, setFilter] = useState<FilterKind>(deepLinkId != null ? 'all' : settings.defaultFilter)
  const [search, setSearch] = useState('')
  const [articles, setArticles] = useState<Article[]>([])
  const [total, setTotal] = useState(0)
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(deepLinkId)
  // The deep-linked article's own record, so the pane can open it even when it
  // is older than the loaded list page (reading_spec §7.2).
  const [deepLinked, setDeepLinked] = useState<Article | null>(null)
  // The first feeds/list load waits for the deep-link read-mark, so neither
  // comes back with the article still unread.
  const [deepLinkPending, setDeepLinkPending] = useState(deepLinkId != null)
  const [refreshing, setRefreshing] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const loadFeeds = useCallback(async () => {
    try {
      const r = await api.getFeeds()
      setFeeds(r)
    } catch (e) { console.error(e) }
  }, [])

  const loadArticles = useCallback(async () => {
    setLoadingArticles(true)
    try {
      const p: api.ListArticlesParams = {
        filter: filter === 'all' ? undefined : filter,
        search: search || undefined,
        limit: 100,
      }
      if (selection.kind === 'feed') p.feedId = selection.feedId
      if (selection.kind === 'folder') p.folder = selection.folder
      if (selection.kind === 'starred') p.filter = 'starred'
      const r = await api.listArticles(p)
      setArticles(r.items)
      setTotal(r.total)
    } catch (e) {
      console.error(e)
      setArticles([])
    } finally {
      setLoadingArticles(false)
    }
  }, [filter, search, selection])

  useEffect(() => { if (!deepLinkPending) loadFeeds() }, [loadFeeds, deepLinkPending])
  useEffect(() => { if (!deepLinkPending) loadArticles() }, [loadArticles, deepLinkPending])

  // Deep link: open the article from its own record, mark it read like any
  // open, and clean the URL (reading_spec §10).
  useEffect(() => {
    if (deepLinkId == null) return
    const u = new URL(window.location.href)
    u.searchParams.delete('article')
    window.history.replaceState({}, '', u.pathname + (u.search || ''))
    ;(async () => {
      try {
        const a = await api.getArticle(deepLinkId)
        setDeepLinked(a)
        if (!a.is_read) {
          try {
            await api.markRead(a.id)
            setDeepLinked(prev => prev && prev.id === a.id ? { ...prev, is_read: true } : prev)
          } catch (e) { console.error('mark read failed', e) }
        }
      } catch (e) {
        // No such article (e.g. its feed was removed): the pane stays empty.
        console.error('deep-link article not found', e)
        setSelectedId(null)
      } finally {
        setDeepLinkPending(false)
      }
    })()
  }, [deepLinkId])

  const onSelectArticle = useCallback(async (a: Article) => {
    // Selection is instant; the read-state flip + count refresh follow the read
    // call's completion and only on success — counts must never lie (reading_spec §5.1).
    setSelectedId(a.id)
    if (!a.is_read) {
      try {
        await api.markRead(a.id)
        setArticles(prev => prev.map(x => x.id === a.id ? { ...x, is_read: true } : x))
        loadFeeds() // unread counts
      } catch (e) { console.error('mark read failed', e) }
    }
  }, [loadFeeds])

  const handleRefreshAll = useCallback(async () => {
    setRefreshing(true)
    try {
      await api.refreshAll()
      // Poll until refresh stat updates (the BE sets it on completion).
      const t0 = Date.now()
      // Wait at least 1s, then poll every 1.5s for up to 90s
      await new Promise(r => setTimeout(r, 1200))
      while (Date.now() - t0 < 90_000) {
        const s = await api.refreshStatus()
        if (s.finished_at && new Date(s.finished_at).getTime() >= t0) break
        await new Promise(r => setTimeout(r, 1500))
      }
      await loadFeeds()
      await loadArticles()
    } finally {
      setRefreshing(false)
    }
  }, [loadFeeds, loadArticles])

  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.classList.toggle('dark', next === 'dark')
    localStorage.setItem('feedler.theme', next)
  }, [theme])

  const handleStar = useCallback(async (id: number) => {
    const r = await api.toggleStar(id)
    setArticles(prev => prev.map(x => x.id === id ? { ...x, is_starred: r.is_starred } : x))
    setDeepLinked(prev => prev && prev.id === id ? { ...prev, is_starred: r.is_starred } : prev)
  }, [])

  const handleToggleRead = useCallback(async (id: number, currentlyRead: boolean) => {
    try {
      if (currentlyRead) await api.markUnread(id)
      else await api.markRead(id)
      setArticles(prev => prev.map(x => x.id === id ? { ...x, is_read: !currentlyRead } : x))
      setDeepLinked(prev => prev && prev.id === id ? { ...prev, is_read: !currentlyRead } : prev)
      loadFeeds()
    } catch (e) { console.error('toggle read failed', e) }
  }, [loadFeeds])

  const handleMarkAllRead = useCallback(async () => {
    const body: { feed_id?: number; folder?: string } = {}
    if (selection.kind === 'feed') body.feed_id = selection.feedId
    if (selection.kind === 'folder') body.folder = selection.folder
    if (!confirm('Mark all visible articles as read?')) return
    await api.markAllRead(body)
    await loadArticles()
    await loadFeeds()
  }, [selection, loadArticles, loadFeeds])

  // The pane's subject: the loaded row, else the deep-linked record (reading_spec §7.2).
  const selectedArticle = useMemo(
    () => articles.find(a => a.id === selectedId)
      || (deepLinked && deepLinked.id === selectedId ? deepLinked : null),
    [articles, selectedId, deepLinked],
  )

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return
      const idx = articles.findIndex(a => a.id === selectedId)
      if (e.key === 'j') {
        e.preventDefault()
        const next = articles[Math.min(articles.length - 1, idx + 1)]
        if (next) onSelectArticle(next)
      } else if (e.key === 'k') {
        e.preventDefault()
        const prev = articles[Math.max(0, idx - 1)]
        if (prev) onSelectArticle(prev)
      } else if (e.key === 'r') {
        e.preventDefault()
        handleRefreshAll()
      } else if (e.key === 's' && selectedId != null) {
        e.preventDefault()
        handleStar(selectedId)
      } else if (e.key === 'M') {
        // Shift+M — mark all in current scope as read
        e.preventDefault()
        handleMarkAllRead()
      } else if (e.key === 'm' && selectedArticle) {
        e.preventDefault()
        handleToggleRead(selectedArticle.id, selectedArticle.is_read)
      } else if (e.key === 'o' && selectedArticle) {
        if (selectedArticle.link) window.open(selectedArticle.link, '_blank', 'noopener,noreferrer')
      } else if (e.key === 'e') {
        e.preventDefault()
        setExportOpen(true)
      } else if (e.key === '/') {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
      } else if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [articles, selectedId, selectedArticle, onSelectArticle, handleRefreshAll, handleStar, handleToggleRead, handleMarkAllRead])

  return (
    <div className="flex h-full w-full overflow-hidden">
      {sidebarOpen && (
        <Sidebar
          feeds={feeds}
          selection={selection}
          onSelect={(s) => { setSelection(s); setSelectedId(null); setDeepLinked(null) }}
          onChanged={async () => { await loadFeeds(); await loadArticles() }}
        />
      )}
      <div className="flex flex-col flex-1 min-w-0">
        <Toolbar
          theme={theme}
          onToggleTheme={toggleTheme}
          refreshing={refreshing}
          onRefresh={handleRefreshAll}
          onOpenExport={() => setExportOpen(true)}
          onOpenImport={() => setImportOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          filter={filter}
          onFilter={setFilter}
          search={search}
          onSearch={setSearch}
          onMarkAllRead={handleMarkAllRead}
          totalUnread={feeds?.total_unread ?? 0}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
        />
        <div className="flex flex-1 min-h-0">
          <ArticleList
            articles={articles}
            total={total}
            loading={loadingArticles}
            selectedId={selectedId}
            onSelect={onSelectArticle}
            onToggleStar={handleStar}
            selection={selection}
            density={settings.density}
            autoMarkOnScroll={settings.autoMarkOnScroll}
            autoMarkDelayMs={settings.autoMarkDelayMs}
            onAutoRead={(id) => {
              setArticles(prev => prev.map(x => x.id === id ? { ...x, is_read: true } : x))
              loadFeeds()
            }}
          />
          <ArticleView
            article={selectedArticle}
            onToggleStar={handleStar}
            onToggleRead={handleToggleRead}
          />
        </div>
      </div>
      {exportOpen && (
        <ExportDialog
          onClose={() => setExportOpen(false)}
          feeds={feeds}
          selection={selection}
        />
      )}
      {importOpen && <ImportDialog onClose={() => setImportOpen(false)} onImported={async () => {
        setImportOpen(false)
        await loadFeeds()
      }} />}
      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={updateSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  )
}
