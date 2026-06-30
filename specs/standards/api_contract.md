# Feedler — API Contract

**Status:** Binding wire truth. **Read `architecture.md` (§3 data model) and
`standards/engineering_standard.md` (§7 HTTP conventions) first.**

This document is the contract between the frontend and the backend. Each side is built to implement
its half and nothing else couples them, so either can be regenerated independently from this file.
Endpoints, parameter names, JSON field names, and status codes here are **verbatim and binding**;
how a handler is structured internally is not.

All paths are under a single origin (one port — `engineering_standard.md` §3). All API responses are
JSON except `/api/export` (Markdown). The error shape is `{ "error": "<message>" }` (§ conventions).

## 1. Object shapes

These are the JSON representations of the data model (`architecture.md` §3). Field names are binding.

### Feed
```jsonc
{
  "id": 12,
  "xml_url": "https://blog.cloudflare.com/rss/",
  "html_url": "https://blog.cloudflare.com",   // "" if unknown
  "title": "The Cloudflare Blog",
  "folder": "Engineering",                       // "" if uncategorized
  "last_fetched_at": "2026-06-30T08:00:00Z",     // omitted if never fetched
  "last_error": "HTTP 404",                      // omitted/empty when healthy
  "unread_count": 7
}
```

### Folder
```jsonc
{
  "name": "Engineering",        // "Uncategorized" for feeds with no folder
  "unread_count": 24,
  "feeds": [ /* Feed objects, see above */ ]
}
```

### Article
```jsonc
{
  "id": 4501,
  "feed_id": 12,
  "feed_title": "The Cloudflare Blog",   // joined from the feed
  "feed_folder": "Engineering",          // joined; "" if uncategorized
  "guid": "https://…/post",              // storage identity; may be "" in responses
  "title": "…",
  "link": "https://…/post",              // the original article URL
  "author": "…",                         // "" if none
  "summary": "plain-text excerpt…",      // list + detail
  "content": "<p>feed HTML…</p>",         // DETAIL ONLY (omitted from list rows)
  "full_content": "<article>…</article>", // DETAIL ONLY, present only if readability-cached
  "published_at": "2026-06-29T14:22:00Z", // omitted if the item had no date
  "fetched_at": "2026-06-29T15:00:00Z",
  "is_read": false,
  "is_starred": true
}
```
The **list** endpoint returns the lightweight shape (no `content`/`full_content`); the **single
article** endpoint returns the full record including `content` and any cached `full_content`. All
timestamps are RFC3339 UTC.

### RefreshStat
```jsonc
{
  "started_at": "2026-06-30T08:00:00Z",
  "finished_at": "2026-06-30T08:00:07Z",   // zero value until the first run completes
  "feeds": 42, "succeeded": 40, "failed": 2, "new_articles": 13
}
```

## 2. Conventions

- Success: `200`. Created: `201`. Async job accepted: `202`. Bad input: `400`. Not found: `404`.
  Upstream/server failure: `5xx` (`502` for a failed full-text upstream fetch).
- Errors return `{ "error": "<message>" }` with the status above.
- `{id}` path params are integers; a non-integer id is `400 bad id`.

---

## 3. Health

### `GET /api/health`
Liveness. → `200 { "ok": true, "time": "<RFC3339>" }`.

## 4. Feeds

### `GET /api/feeds`
The full sidebar tree. Feeds grouped into folders, sorted folder-then-title (case-insensitive),
with unread counts.
→ `200`
```jsonc
{
  "folders": [ /* Folder objects, each with its Feed list and unread_count */ ],
  "total_unread": 137,
  "total_starred": 9          // count of starred articles (all, not just unread)
}
```
The empty-folder bucket is named `"Uncategorized"`.

### `POST /api/feeds`
Add (or upsert by `xml_url`) a feed. Body:
```jsonc
{ "xml_url": "https://…/feed.xml", "title": "optional", "folder": "optional" }
```
- `xml_url` is required (trimmed); empty → `400 "xml_url required"`. Malformed JSON → `400 "bad json"`.
- If `title` is omitted/empty, the server **probes** the feed once (fetch + parse, no DB write) to
  discover its real title and site link; if the probe fails, the title falls back to the `xml_url`.
- Upsert on `xml_url` (existing feed → update title/folder/html_url, no duplicate —
  `architecture.md` §3 invariant 1).
- Kicks an immediate background refresh of the new feed so its articles appear without waiting.
→ `201 { "id": 31, "title": "…", "folder": "…" }`

### `POST /api/feeds/refresh`
Start a refresh of **all** feeds. Returns immediately; the work runs in the background (it must not
be tied to the request's lifetime).
→ `202 { "status": "started" }`
Progress is observed via `GET /api/feeds/refresh-status`.

### `POST /api/feeds/{id}/refresh`
Refresh **one** feed synchronously.
→ `200 { "new_articles": <int> }` · upstream/parse failure → `500 {error}` (and the feed's
`last_error` is recorded).

### `GET /api/feeds/refresh-status`
The stats of the most recent (or in-progress) all-feeds refresh.
→ `200` RefreshStat.

### `PATCH /api/feeds/{id}`
Rename and/or move a feed. Body has at least one of:
```jsonc
{ "title": "New title", "folder": "New folder" }   // each optional; folder "" = uncategorize
```
Neither present → `400 "nothing to update"`. → `200 { "ok": true }`.

### `DELETE /api/feeds/{id}`
Remove a feed and (by cascade) all its articles. → `200 { "status": "deleted" }`.

## 5. Articles

### `GET /api/articles`
The article list for the current view. Query params (all optional):

| Param | Meaning |
|---|---|
| `feed` | restrict to one feed id |
| `folder` | restrict to one folder name (`""` matches uncategorized) |
| `filter` | `unread` \| `all` \| `starred` \| `read` — read-state narrowing (anything else = no filter) |
| `search` | case-insensitive substring matched against title **or** summary |
| `limit` | page size, default `50`, capped at `200` |
| `offset` | page offset, default `0` |

Ordered by `COALESCE(published_at, fetched_at) DESC` (`architecture.md` §3 invariant 4).
→ `200`
```jsonc
{ "items": [ /* lightweight Article rows */ ], "total": <int>, "limit": <int>, "offset": <int> }
```
`total` is the count matching the filter (ignoring limit/offset), for the "N of M" display.

### `GET /api/articles/{id}`
A single article's full record (includes `content` and any cached `full_content`).
→ `200` Article · not found → `404 "not found"`.

### `POST /api/articles/{id}/read`  ·  `POST /api/articles/{id}/unread`
Set the article's read state. → `200 { "ok": true }`.

### `POST /api/articles/{id}/star`
Toggle the article's starred state. → `200 { "is_starred": <bool> }` (the new value).

### `GET /api/articles/{id}/full`
Return the article's full text, extracting it from the origin page via readability and **caching**
it on the article if not already cached (`architecture.md` glossary: full content). Subsequent calls
return the cache.
→ `200 { "html": "<sanitized-on-client> extracted HTML" }` · upstream failure or empty extraction →
`502 {error}`.

### `POST /api/articles/mark-all-read`
Mark every unread article in a scope as read. Body selects the scope:
```jsonc
{ "feed_id": 12 }      // → that feed
{ "folder": "AI" }     // → that folder ("" = uncategorized)
{}                     // → everything (all feeds)
```
(`feed_id` takes precedence over `folder` if both are sent.) → `200 { "marked": <int> }`.

## 6. Import & Export

### `POST /api/import`
Import an OPML file. Two accepted encodings:
- `multipart/form-data` with a `file` field (the `.opml`), **or**
- a raw request body that is the OPML XML.

Parses and **upserts** feeds by `xml_url` (`ingestion_spec`), then kicks a background refresh of all
feeds.
→ `200 { "inserted": <int>, "updated": <int>, "skipped": <int> }` · bad/unparseable OPML →
`400 {error}` · missing `file` field on a multipart request → `400 "missing 'file' field"`.

### `GET /api/export`
Generate the Markdown digest (`export_spec.md` is the authority on the output format; this section is
the request contract). Query params:

| Param | Values | Meaning |
|---|---|---|
| `range` | `today` \| `yesterday` \| `week` \| `month` \| `all` \| `custom` | the time window; `week`=last 7 days, `month`=last 30 days, inclusive of today |
| `from`, `to` | `YYYY-MM-DD` | used when `range=custom` (or `range` empty); `to` is inclusive |
| `tz` | IANA name (e.g. `Europe/Berlin`) or `local` | timezone for drawing day boundaries; defaults to the server's location if unparseable |
| `filter` | `read` \| `unread` \| `starred` \| (omit = all) | read-state narrowing |
| `folder` | folder name | scope to one folder |
| `feed` | feed id | scope to one feed |
| `group` | `feed` \| `chrono` | grouping; default `feed` (folder→feed headings) |
| `body` | `0` to omit | include the summary excerpt per item (default: include) |
| `disposition` | `attachment` | set `Content-Disposition: attachment` (download) instead of inline |

→ `200`, `Content-Type: text/markdown; charset=utf-8`, body is the digest. With
`disposition=attachment`, a `Content-Disposition` header names the file `feedler-<YYYY-MM-DD>.md`.

## 7. Deep-link

### `GET /a/{id}`
The short "in reader" link used in exports. Redirects to the SPA focused on the article.
→ `302 Found`, `Location: /?article={id}`. The SPA reads `?article=<id>`, selects that article, and
cleans the query string from the URL (`reading_spec`).
