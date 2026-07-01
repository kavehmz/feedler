export interface Feed {
  id: number
  xml_url: string
  html_url: string
  title: string
  folder: string
  last_fetched_at?: string
  last_error?: string
  unread_count: number
}

export interface Folder {
  name: string
  unread_count: number
  feeds: Feed[]
}

export interface FeedsResponse {
  folders: Folder[]
  total_unread: number
  total_starred: number
}

export interface Article {
  id: number
  feed_id: number
  feed_title?: string
  feed_folder?: string
  guid: string
  title: string
  link: string
  author?: string
  summary?: string
  content?: string
  full_content?: string
  published_at?: string
  fetched_at: string
  is_read: boolean
  is_starred: boolean
}

export interface ArticleListResponse {
  items: Article[]
  total: number
  limit: number
  offset: number
}

export interface RefreshStat {
  started_at: string
  finished_at: string
  feeds: number
  succeeded: number
  failed: number
  new_articles: number
}

export type FilterKind = 'unread' | 'all' | 'starred'

export type Selection =
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'folder'; folder: string }
  | { kind: 'feed'; feedId: number; feedTitle?: string }
