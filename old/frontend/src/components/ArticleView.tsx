import { useEffect, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import * as api from '../api'
import type { Article } from '../types'

// Force every <a> in sanitized article HTML to open in a new tab.
// Without this, "Article URL", "Comments URL", "Read more at Slashdot",
// etc. navigate away from Feedler and replace the SPA.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if ((node as Element).tagName === 'A') {
    const a = node as HTMLAnchorElement
    a.setAttribute('target', '_blank')
    a.setAttribute('rel', 'noopener noreferrer')
  }
})

interface Props {
  article: Article | null
  onToggleStar: (id: number) => void
  onToggleRead: (id: number, currentlyRead: boolean) => void
}

export function ArticleView({ article, onToggleStar, onToggleRead }: Props) {
  const [mode, setMode] = useState<'feed' | 'full'>('feed')
  const [fullHtml, setFullHtml] = useState<string | null>(null)
  const [fullLoading, setFullLoading] = useState(false)
  const [fullError, setFullError] = useState<string | null>(null)
  const [serverArticle, setServerArticle] = useState<Article | null>(null)

  // When article changes, reset toggle to feed mode and fetch the full record
  // (which may have content even when summary alone was loaded for the list).
  useEffect(() => {
    setMode('feed')
    setFullHtml(null)
    setFullError(null)
    setServerArticle(null)
    if (article) {
      api.getArticle(article.id).then(setServerArticle).catch(() => {})
    }
  }, [article?.id])

  const a = serverArticle ?? article

  const feedHtml = useMemo(() => {
    if (!a) return ''
    const raw = a.content || a.summary || ''
    return DOMPurify.sanitize(raw, {
      ADD_ATTR: ['target', 'rel'],
    })
  }, [a])

  const fullSanitized = useMemo(() => {
    return fullHtml ? DOMPurify.sanitize(fullHtml, { ADD_ATTR: ['target', 'rel'] }) : ''
  }, [fullHtml])

  const requestFull = async () => {
    if (!a) return
    if (a.full_content) {
      setFullHtml(a.full_content)
      setMode('full')
      return
    }
    setFullLoading(true)
    setFullError(null)
    try {
      const r = await api.fetchFull(a.id)
      setFullHtml(r.html)
      setMode('full')
    } catch (e: any) {
      setFullError(e?.message || 'Failed to fetch')
    } finally {
      setFullLoading(false)
    }
  }

  if (!a) {
    return (
      <div className="flex-1 h-full flex items-center justify-center text-ink-400">
        <div className="text-center">
          <div className="text-5xl mb-2">📖</div>
          <div className="text-sm">Select an article from the list</div>
          <div className="text-xs mt-3 text-ink-400">
            Press <kbd className="px-1 py-0.5 rounded border border-ink-300 dark:border-ink-700">?</kbd> for keyboard shortcuts
          </div>
        </div>
      </div>
    )
  }

  const html = mode === 'full' ? fullSanitized : feedHtml

  return (
    <div className="flex-1 h-full overflow-y-auto bg-white dark:bg-ink-950">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="mb-4 text-xs uppercase tracking-wide text-ink-400 dark:text-ink-500">
          {a.feed_folder ? `${a.feed_folder} · ` : ''}{a.feed_title}
        </div>
        <h1 className="text-3xl font-bold leading-tight mb-3">{a.title || '(untitled)'}</h1>
        <div className="text-sm text-ink-500 dark:text-ink-400 mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
          {a.author && <span>by {a.author}</span>}
          {a.published_at && (
            <span>{new Date(a.published_at).toLocaleString()}</span>
          )}
          {a.link && (
            <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-accent-600 hover:underline">
              View original ↗
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-ink-100 dark:border-ink-800">
          <ModeButton active={mode === 'feed'} onClick={() => setMode('feed')}>Feed content</ModeButton>
          <ModeButton
            active={mode === 'full'}
            onClick={requestFull}
            loading={fullLoading}
          >
            {fullLoading ? 'Fetching…' : 'Read full article'}
          </ModeButton>
          <span className="flex-1" />
          <button
            className="px-2.5 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
            onClick={() => onToggleRead(a.id, a.is_read)}
            title="Toggle read state (m)"
          >
            {a.is_read ? '◐ Mark unread' : '● Mark read'}
          </button>
          <button
            className="px-2.5 py-1.5 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
            onClick={() => onToggleStar(a.id)}
            title="Toggle star (s)"
          >
            {a.is_starred ? '⭐ Starred' : '☆ Star'}
          </button>
        </div>

        {fullError && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
            Failed to fetch full article: {fullError}
          </div>
        )}

        <article
          className="article-body text-ink-800 dark:text-ink-200"
          dangerouslySetInnerHTML={{ __html: html || '<em>No content.</em>' }}
        />
      </div>
    </div>
  )
}

function ModeButton({ active, onClick, loading, children }: {
  active: boolean
  onClick: () => void
  loading?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`px-3 py-1.5 rounded-md text-sm font-medium disabled:opacity-60 ${
        active
          ? 'bg-accent-500 text-white'
          : 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-200 hover:bg-ink-200 dark:hover:bg-ink-700'
      }`}
    >
      {children}
    </button>
  )
}
