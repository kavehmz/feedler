import { useCallback, useEffect, useMemo, useState } from 'react'
import * as api from './api'
import type { Article, FeedsResponse, FilterKind, Selection } from './types'
import { Sidebar } from './components/Sidebar'
import { ArticleList } from './components/ArticleList'
import { ArticleView } from './components/ArticleView'
import { Toolbar } from './components/Toolbar'
import { ExportDialog } from './components/ExportDialog'
import { ImportDialog } from './components/ImportDialog'

export function App() {
  const [feeds, setFeeds] = useState<FeedsResponse | null>(null)
  const [selection, setSelection] = useState<Selection>({ kind: 'all' })
  const [filter, setFilter] = useState<FilterKind>('unread')
  const [search, setSearch] = useState('')
  const [articles, setArticles] = useState<Article[]>([])
  const [total, setTotal] = useState(0)
  const [loadingArticles, setLoadingArticles] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
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

  useEffect(() => { loadFeeds() }, [loadFeeds])
  useEffect(() => { loadArticles() }, [loadArticles])

  // Deep link: /a/{id} → ?article=id  (the BE redirects /a/123 to /?article=123)
  useEffect(() => {
    const u = new URL(window.location.href)
    const a = u.searchParams.get('article')
    if (a) {
      const id = parseInt(a, 10)
      if (!Number.isNaN(id)) {
        setSelectedId(id)
        setFilter('all')
        // Clean the URL
        u.searchParams.delete('article')
        window.history.replaceState({}, '', u.pathname + (u.search || ''))
      }
    }
  }, [])

  const onSelectArticle = useCallback(async (a: Article) => {
    setSelectedId(a.id)
    if (!a.is_read) {
      await api.markRead(a.id)
      setArticles(prev => prev.map(x => x.id === a.id ? { ...x, is_read: true } : x))
      loadFeeds() // unread counts
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
  }, [])

  const handleToggleRead = useCallback(async (id: number, currentlyRead: boolean) => {
    if (currentlyRead) await api.markUnread(id)
    else await api.markRead(id)
    setArticles(prev => prev.map(x => x.id === id ? { ...x, is_read: !currentlyRead } : x))
    loadFeeds()
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
      } else if (e.key === 'm' && selectedId != null) {
        e.preventDefault()
        const a = articles.find(x => x.id === selectedId)
        if (a) handleToggleRead(a.id, a.is_read)
      } else if (e.key === 'o' && selectedId != null) {
        const a = articles.find(x => x.id === selectedId)
        if (a?.link) window.open(a.link, '_blank', 'noopener,noreferrer')
      } else if (e.key === 'e') {
        e.preventDefault()
        setExportOpen(true)
      } else if (e.key === '/') {
        e.preventDefault()
        document.getElementById('search-input')?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [articles, selectedId, onSelectArticle, handleRefreshAll, handleStar, handleToggleRead])

  const selectedArticle = useMemo(
    () => articles.find(a => a.id === selectedId) || null,
    [articles, selectedId],
  )

  return (
    <div className="flex h-full w-full overflow-hidden">
      {sidebarOpen && (
        <Sidebar
          feeds={feeds}
          selection={selection}
          onSelect={(s) => { setSelection(s); setSelectedId(null) }}
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
    </div>
  )
}
