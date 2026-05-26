import { useEffect, useState } from 'react'
import * as api from '../api'

interface Props {
  onClose: () => void
  onImported: () => void
}

export function ImportDialog({ onClose, onImported }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ inserted: number; updated: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async () => {
    if (!file) return
    setBusy(true); setError(null); setResult(null)
    try {
      const r = await api.importOPML(file)
      setResult(r)
      onImported()
    } catch (e: any) {
      setError(e?.message || 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-ink-900 rounded-lg shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-ink-100 dark:border-ink-800 flex items-center justify-between">
          <h3 className="font-semibold">Import OPML</h3>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200 text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Upload an OPML file (e.g. exported from Reeder, Feedly, NetNewsWire).
            Existing feeds with the same URL will be updated, not duplicated.
          </p>
          <input
            type="file"
            accept=".opml,.xml,text/xml,application/xml"
            onChange={e => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-accent-500 file:text-white file:hover:bg-accent-600"
          />
          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          {result && (
            <div className="text-sm bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 rounded p-3">
              Imported. Inserted {result.inserted}, updated {result.updated}, skipped {result.skipped}.
              Refresh starting in background…
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-3 py-2 rounded-md text-sm hover:bg-ink-100 dark:hover:bg-ink-800">Close</button>
            <button
              onClick={submit}
              disabled={!file || busy}
              className="px-3 py-2 rounded-md text-sm font-medium bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50"
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
