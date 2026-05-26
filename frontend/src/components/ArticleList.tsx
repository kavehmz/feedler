import { useCallback, useEffect, useRef } from 'react'
import * as api from '../api'
import type { Article, Selection } from '../types'

interface Props {
  articles: Article[]
  total: number
  loading: boolean
  selectedId: number | null
  onSelect: (a: Article) => void
  onToggleStar: (id: number) => void
  selection: Selection
  density: 'comfortable' | 'compact'
  autoMarkOnScroll: boolean
  autoMarkDelayMs: number
  /** Called when an article was auto-marked-as-read via scroll. The parent
   *  updates the local state and refreshes unread counts. */
  onAutoRead: (id: number) => void
}

export function ArticleList({
  articles, total, loading, selectedId, onSelect, onToggleStar, selection,
  density, autoMarkOnScroll, autoMarkDelayMs, onAutoRead,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // Track articles whose top has crossed above the scroll container's top.
  // After `autoMarkDelayMs`, fire the mark-as-read.
  const pendingTimers = useRef<Record<number, number>>({})
  const alreadyMarked = useRef<Set<number>>(new Set())

  // Reset markers when the article set changes (filter/feed switch)
  useEffect(() => {
    alreadyMarked.current = new Set()
    Object.values(pendingTimers.current).forEach(t => clearTimeout(t))
    pendingTimers.current = {}
  }, [selection, articles.length])

  // Scroll selected row into view
  useEffect(() => {
    if (selectedId == null) return
    const el = rowRefs.current[selectedId]
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const handleAutoRead = useCallback((id: number) => {
    if (alreadyMarked.current.has(id)) return
    alreadyMarked.current.add(id)
    api.markRead(id).catch(() => alreadyMarked.current.delete(id))
    onAutoRead(id)
  }, [onAutoRead])

  // IntersectionObserver — scoped to the list's scroll container.
  // A row "intersects" while any part of it is in the viewport. When it
  // leaves AND its bottom is above the container's top (i.e. scrolled past
  // upward, not downward), schedule a mark-as-read.
  useEffect(() => {
    if (!autoMarkOnScroll) return
    const root = scrollRef.current
    if (!root) return

    const io = new IntersectionObserver((entries) => {
      const rootTop = root.getBoundingClientRect().top
      for (const entry of entries) {
        const idAttr = (entry.target as HTMLElement).dataset.articleId
        if (!idAttr) continue
        const id = parseInt(idAttr, 10)
        const isUnread = (entry.target as HTMLElement).dataset.unread === '1'

        // Cancel any pending timer for this row
        if (pendingTimers.current[id]) {
          clearTimeout(pendingTimers.current[id])
          delete pendingTimers.current[id]
        }

        if (!isUnread || alreadyMarked.current.has(id)) continue

        // Scrolled OFF the top: the row's bottom is above the container's top.
        if (!entry.isIntersecting && entry.boundingClientRect.bottom <= rootTop + 1) {
          pendingTimers.current[id] = window.setTimeout(() => {
            handleAutoRead(id)
            delete pendingTimers.current[id]
          }, autoMarkDelayMs)
        }
      }
    }, {
      root,
      threshold: 0,
      // No rootMargin — we want the natural boundary to be the visible area.
    })

    Object.values(rowRefs.current).forEach(el => { if (el) io.observe(el) })
    return () => {
      io.disconnect()
      Object.values(pendingTimers.current).forEach(t => clearTimeout(t))
      pendingTimers.current = {}
    }
  }, [autoMarkOnScroll, autoMarkDelayMs, articles, handleAutoRead])

  const title = selectionTitle(selection)
  const compact = density === 'compact'

  return (
    <div
      ref={scrollRef}
      className="w-[420px] shrink-0 h-full overflow-y-auto border-r border-ink-100 dark:border-ink-800"
    >
      <div className="sticky top-0 bg-white/90 dark:bg-ink-950/90 backdrop-blur z-10 px-4 py-3 border-b border-ink-100 dark:border-ink-800 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold truncate">{title}</h2>
        <span className="text-xs text-ink-400 tabular-nums">{loading ? 'loading…' : `${articles.length} of ${total}`}</span>
      </div>
      {articles.length === 0 && !loading && (
        <div className="p-8 text-center text-sm text-ink-400">No articles to show. Try changing the filter or refreshing.</div>
      )}
      {articles.map(a => {
        const selected = a.id === selectedId
        return (
          <div
            key={a.id}
            ref={el => { rowRefs.current[a.id] = el }}
            data-article-id={a.id}
            data-unread={a.is_read ? '0' : '1'}
            className={`list-row ${compact ? 'px-3 py-2' : 'px-4 py-3'} cursor-pointer ${a.is_read ? 'read' : 'unread'} ${selected ? 'selected' : ''}`}
            onClick={() => onSelect(a)}
          >
            <div className="flex items-start gap-2">
              {!a.is_read && (
                <span className={`${compact ? 'mt-1' : 'mt-1.5'} w-2 h-2 rounded-full bg-accent-500 shrink-0`} />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs text-ink-500 dark:text-ink-400 truncate">
                    {a.feed_title}
                  </div>
                  <div className="text-xs text-ink-400 dark:text-ink-500 tabular-nums shrink-0">
                    {formatTime(a.published_at || a.fetched_at)}
                  </div>
                </div>
                <div className={`row-title ${compact ? 'text-sm' : 'text-[15px]'} leading-snug mt-0.5`}>
                  {a.title || '(untitled)'}
                </div>
                {!compact && a.summary && (
                  <div className="text-sm text-ink-500 dark:text-ink-400 mt-1 line-clamp-2">
                    {a.summary}
                  </div>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleStar(a.id) }}
                className="text-lg leading-none mt-0.5"
                title={a.is_starred ? 'Unstar' : 'Star'}
              >
                {a.is_starred ? '⭐' : '☆'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function selectionTitle(s: Selection): string {
  switch (s.kind) {
    case 'all': return 'All articles'
    case 'starred': return 'Starred'
    case 'folder': return s.folder
    case 'feed': return s.feedTitle || `Feed #${s.feedId}`
  }
}

function formatTime(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d`
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return d.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: 'numeric' })
}
