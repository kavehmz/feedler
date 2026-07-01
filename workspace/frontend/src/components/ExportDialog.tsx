import { useEffect, useMemo, useState } from 'react'
import * as api from '../api'
import type { FeedsResponse, Selection } from '../types'

interface Props {
  onClose: () => void
  feeds: FeedsResponse | null
  selection: Selection
}

type RangeKey = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'
type ScopeKey =
  | { kind: 'all' }
  | { kind: 'starred' }
  | { kind: 'folder'; folder: string }
  | { kind: 'feed'; feedId: number }

function scopeFromSelection(s: Selection): ScopeKey {
  switch (s.kind) {
    case 'feed': return { kind: 'feed', feedId: s.feedId }
    case 'folder': return { kind: 'folder', folder: s.folder }
    case 'starred': return { kind: 'starred' }
    case 'all':
    default: return { kind: 'all' }
  }
}

function scopeId(s: ScopeKey): string {
  switch (s.kind) {
    case 'all': return 'all'
    case 'starred': return 'starred'
    case 'folder': return `folder:${s.folder}`
    case 'feed': return `feed:${s.feedId}`
  }
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export function ExportDialog({ onClose, feeds, selection }: Props) {
  const [range, setRange] = useState<RangeKey>('today')
  const [filter, setFilter] = useState('all')
  const [group, setGroup] = useState<'feed' | 'chrono'>('feed')
  const [withBody, setWithBody] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [scope, setScope] = useState<ScopeKey>(() => scopeFromSelection(selection))
  const [preview, setPreview] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  // Build scope options from feeds tree
  const scopeOptions = useMemo<{ id: string; label: string; scope: ScopeKey }[]>(() => {
    const opts: { id: string; label: string; scope: ScopeKey }[] = [
      { id: 'all', label: 'All articles', scope: { kind: 'all' } },
      { id: 'starred', label: 'Starred only', scope: { kind: 'starred' } },
    ]
    if (feeds) {
      for (const f of feeds.folders) {
        opts.push({ id: `folder:${f.name}`, label: `📁 ${f.name} (${f.feeds.length} feeds)`, scope: { kind: 'folder', folder: f.name } })
      }
      for (const f of feeds.folders) {
        for (const feed of f.feeds) {
          opts.push({ id: `feed:${feed.id}`, label: `   · ${feed.title}`, scope: { kind: 'feed', feedId: feed.id } })
        }
      }
    }
    return opts
  }, [feeds])

  const exportOpts = useMemo(() => {
    const o: Parameters<typeof api.exportURL>[0] = {
      range,
      filter: filter === 'all' ? undefined : filter,
      group,
      body: withBody,
      tz: TZ,
    }
    if (range === 'custom') {
      o.from = from || undefined
      o.to = to || undefined
    }
    if (scope.kind === 'folder') o.folder = scope.folder
    else if (scope.kind === 'feed') o.feedId = scope.feedId
    else if (scope.kind === 'starred') o.filter = 'starred'
    return o
  }, [range, filter, group, withBody, from, to, scope])

  const url = useMemo(() => api.exportURL(exportOpts), [exportOpts])
  const downloadURL = useMemo(() => api.exportURL({ ...exportOpts, download: true }), [exportOpts])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(url).then(r => r.text()).then(t => {
      if (!cancelled) setPreview(t)
    }).catch(() => {
      if (!cancelled) setPreview('Error generating preview')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    await navigator.clipboard.writeText(preview)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Article count from the preview header (best-effort)
  const articleCount = useMemo(() => {
    const m = preview.match(/_(\d+) articles/)
    return m ? parseInt(m[1], 10) : null
  }, [preview])

  const currentScopeId = scopeId(scope)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-ink-900 rounded-lg shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-ink-100 dark:border-ink-800 flex items-center justify-between">
          <h3 className="font-semibold">Export to Markdown</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 text-xl leading-none">×</button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Controls */}
          <div className="w-80 shrink-0 p-4 border-r border-ink-100 dark:border-ink-800 overflow-y-auto space-y-4">
            <Field label="Scope">
              <select
                value={currentScopeId}
                onChange={e => {
                  const found = scopeOptions.find(o => o.id === e.target.value)
                  if (found) setScope(found.scope)
                }}
                className="w-full px-2 py-1.5 rounded bg-ink-100 dark:bg-ink-800 text-sm"
              >
                {scopeOptions.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </Field>

            <Field label="Date range">
              <Select value={range} onChange={v => setRange(v as RangeKey)}>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="week">Last 7 days</option>
                <option value="month">Last 30 days</option>
                <option value="all">All time</option>
                <option value="custom">Custom…</option>
              </Select>
              {range === 'custom' && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-2 py-1.5 rounded bg-ink-100 dark:bg-ink-800 text-sm" />
                  <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-2 py-1.5 rounded bg-ink-100 dark:bg-ink-800 text-sm" />
                </div>
              )}
              <div className="mt-1 text-[11px] text-ink-400 dark:text-ink-500">
                Day boundaries use your timezone: <code>{TZ}</code>
              </div>
            </Field>

            <Field label="Read state">
              <Select
                value={scope.kind === 'starred' ? 'starred' : filter}
                onChange={setFilter}
                disabled={scope.kind === 'starred'}
              >
                <option value="all">All</option>
                <option value="read">Read</option>
                <option value="unread">Unread</option>
                <option value="starred">Starred</option>
              </Select>
            </Field>

            <Field label="Group by">
              <Select value={group} onChange={v => setGroup(v as 'feed' | 'chrono')}>
                <option value="feed">By folder / feed</option>
                <option value="chrono">Chronological</option>
              </Select>
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={withBody} onChange={e => setWithBody(e.target.checked)} />
              Include summary excerpt
            </label>

            <div className="pt-2 space-y-2">
              <button
                onClick={copy}
                disabled={loading || !preview}
                className="w-full px-3 py-2 rounded-md text-sm font-medium bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
              >
                {copied ? '✓ Copied' : 'Copy to clipboard'}
              </button>
              <a
                href={downloadURL}
                className="block text-center w-full px-3 py-2 rounded-md text-sm font-medium bg-ink-100 dark:bg-ink-800 hover:bg-ink-200 dark:hover:bg-ink-700"
              >
                Download .md
              </a>
            </div>

            <div className="text-xs text-ink-400 dark:text-ink-500 leading-relaxed pt-2">
              {articleCount != null
                ? <><strong>{articleCount}</strong> article{articleCount === 1 ? '' : 's'} match this query.</>
                : 'Each entry includes original & in-reader links.'}
            </div>
          </div>

          {/* Preview */}
          <div className="flex-1 min-w-0 overflow-y-auto bg-ink-50 dark:bg-ink-950">
            <pre className="p-4 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words">
              {loading ? 'Loading…' : preview}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-ink-400 dark:text-ink-500 mb-1">{label}</div>
      {children}
    </div>
  )
}

function Select({ value, onChange, children, disabled }: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-2 py-1.5 rounded bg-ink-100 dark:bg-ink-800 text-sm disabled:opacity-60"
    >
      {children}
    </select>
  )
}
