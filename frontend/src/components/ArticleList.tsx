import { useEffect, useRef } from 'react'
import type { Article, Selection } from '../types'

interface Props {
  articles: Article[]
  total: number
  loading: boolean
  selectedId: number | null
  onSelect: (a: Article) => void
  onToggleStar: (id: number) => void
  selection: Selection
}

export function ArticleList({ articles, total, loading, selectedId, onSelect, onToggleStar, selection }: Props) {
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({})

  // Scroll selected into view
  useEffect(() => {
    if (selectedId == null) return
    const el = rowRefs.current[selectedId]
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const title = selectionTitle(selection)

  return (
    <div className="w-[420px] shrink-0 h-full overflow-y-auto border-r border-ink-100 dark:border-ink-800">
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
            className={`list-row px-4 py-3 cursor-pointer ${a.is_read ? 'read' : 'unread'} ${selected ? 'selected' : ''}`}
            onClick={() => onSelect(a)}
          >
            <div className="flex items-start gap-2">
              {!a.is_read && (
                <span className="mt-1.5 w-2 h-2 rounded-full bg-accent-500 shrink-0" />
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
                <div className="row-title text-[15px] leading-snug mt-0.5">
                  {a.title || '(untitled)'}
                </div>
                {a.summary && (
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
