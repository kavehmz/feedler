import type {
  Article,
  ArticleListResponse,
  FeedsResponse,
  FilterKind,
  RefreshStat,
} from './types'

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`${res.status}: ${t || res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function getFeeds(): Promise<FeedsResponse> {
  return j(await fetch('/api/feeds'))
}

export interface ListArticlesParams {
  feedId?: number
  folder?: string
  filter?: FilterKind
  search?: string
  offset?: number
  limit?: number
}

export async function listArticles(p: ListArticlesParams): Promise<ArticleListResponse> {
  const qs = new URLSearchParams()
  if (p.feedId != null) qs.set('feed', String(p.feedId))
  if (p.folder) qs.set('folder', p.folder)
  if (p.filter) qs.set('filter', p.filter)
  if (p.search) qs.set('search', p.search)
  if (p.offset != null) qs.set('offset', String(p.offset))
  if (p.limit != null) qs.set('limit', String(p.limit))
  return j(await fetch('/api/articles?' + qs.toString()))
}

export async function getArticle(id: number): Promise<Article> {
  return j(await fetch(`/api/articles/${id}`))
}

export async function markRead(id: number): Promise<void> {
  await fetch(`/api/articles/${id}/read`, { method: 'POST' })
}

export async function markUnread(id: number): Promise<void> {
  await fetch(`/api/articles/${id}/unread`, { method: 'POST' })
}

export async function toggleStar(id: number): Promise<{ is_starred: boolean }> {
  return j(await fetch(`/api/articles/${id}/star`, { method: 'POST' }))
}

export async function fetchFull(id: number): Promise<{ html: string }> {
  return j(await fetch(`/api/articles/${id}/full`))
}

export async function refreshAll(): Promise<void> {
  await fetch('/api/feeds/refresh', { method: 'POST' })
}

export async function refreshOne(id: number): Promise<{ new_articles: number }> {
  return j(await fetch(`/api/feeds/${id}/refresh`, { method: 'POST' }))
}

export async function addFeed(body: { xml_url: string; folder?: string; title?: string }): Promise<{ id: number; title: string; folder: string }> {
  return j(await fetch('/api/feeds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function updateFeed(id: number, body: { title?: string; folder?: string }): Promise<void> {
  await fetch(`/api/feeds/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteFeed(id: number): Promise<void> {
  await fetch(`/api/feeds/${id}`, { method: 'DELETE' })
}

export async function refreshStatus(): Promise<RefreshStat> {
  return j(await fetch('/api/feeds/refresh-status'))
}

export async function markAllRead(body: {
  feed_id?: number
  folder?: string
}): Promise<{ marked: number }> {
  return j(await fetch('/api/articles/mark-all-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

export async function importOPML(file: File): Promise<{ inserted: number; updated: number; skipped: number }> {
  const fd = new FormData()
  fd.append('file', file)
  return j(await fetch('/api/import', { method: 'POST', body: fd }))
}

export function exportURL(opts: {
  range: string
  from?: string
  to?: string
  filter?: string
  group?: 'feed' | 'chrono'
  body?: boolean
  download?: boolean
  folder?: string
  feedId?: number
  tz?: string
}): string {
  const q = new URLSearchParams()
  q.set('range', opts.range)
  if (opts.from) q.set('from', opts.from)
  if (opts.to) q.set('to', opts.to)
  if (opts.filter) q.set('filter', opts.filter)
  if (opts.group) q.set('group', opts.group)
  if (opts.body === false) q.set('body', '0')
  if (opts.download) q.set('disposition', 'attachment')
  if (opts.folder) q.set('folder', opts.folder)
  if (opts.feedId != null) q.set('feed', String(opts.feedId))
  if (opts.tz) q.set('tz', opts.tz)
  return '/api/export?' + q.toString()
}
