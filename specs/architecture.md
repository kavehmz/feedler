# Feedler — System Architecture

**Status:** Authoritative. Every spec in this suite must be consistent with this document.
**Audience:** the AI that builds Feedler from these specs, and the human who directs it.

This document defines the *shape* of the system: the one deployable, its data, the contracts that
let the frontend and backend be rebuilt independently, and the principles no change may violate. It
deliberately does not describe implementations — see each component spec for its WHAT, and trust the
implementing AI for the HOW.

---

## 1. The system in one picture

```
   ┌──────────────────────────── the operator's browser ────────────────────────────┐
   │  Feedler SPA (React): three-pane reader — Sidebar │ Article list │ Reading pane │
   │  client-only state: theme, settings (localStorage)                              │
   └───────────────────────────────────┬─────────────────────────────────────────────┘
                                        │ HTTP/JSON on ONE port (default 8473)
                                        │  /api/*  ·  /a/{id}  ·  /* (the SPA itself)
                                        ▼
   ┌──────────────────────────  the Feedler binary (Go)  ──────────────────────────┐
   │  HTTP server: JSON API  +  embedded SPA (static files compiled into the binary) │
   │  ┌───────────┐ ┌───────────┐ ┌─────────────┐ ┌───────────┐ ┌───────────────┐   │
   │  │ scheduler │ │  fetcher  │ │ readability │ │  export   │ │ OPML import   │   │
   │  │ (interval)│ │ (gofeed)  │ │ (full text) │ │ (markdown)│ │ + seed        │   │
   │  └─────┬─────┘ └─────┬─────┘ └──────┬──────┘ └─────┬─────┘ └───────┬───────┘   │
   │        └─────────────┴──────────────┴──────────────┴───────────────┘           │
   │                                   │ database/sql (single writer)                │
   └───────────────────────────────────┼─────────────────────────────────────────────┘
                                        ▼
                            ┌───────────────────────┐         outbound HTTP (polite,
                            │  SQLite file (1 file)  │         conditional, size-capped):
                            │  feeds · articles ·    │   ───▶  • feed origins (RSS/Atom XML)
                            │  meta      (WAL mode)  │         • article origins (full-text HTML)
                            └───────────────────────┘
```

One process. One port. One file. The only network egress is fetching the feeds and articles the
operator subscribed to. There is no second service, no message broker, no cache server, no auth
provider.

## 2. Glossary (canonical terms — used verbatim across all specs)

| Term | Meaning |
|------|---------|
| **Feed** | A subscribed RSS/Atom source, identified by its `xml_url` (unique). Has a title, optional site link (`html_url`), and an optional folder. |
| **Folder** | A single-level grouping label on a feed (the `feeds.folder` string). Not a table; a feed has zero or one folder. OPML nesting is flattened into a `"Parent / Child"` path string (`ingestion_spec`). The empty folder is presented as **"Uncategorized"** (a display name, never stored). |
| **Article** | One item fetched from a feed, identified within its feed by **GUID** (unique per `(feed_id, guid)`). Carries title, link, author, summary, content, optional cached full text, timestamps, and read/starred state. |
| **GUID** | The stable per-item identifier used for de-duplication. Taken from the feed item's guid, falling back to its link, then its title (`ingestion_spec`). |
| **Summary** | A short **plain-text** excerpt of an item, derived at ingest from its description/content (tags stripped, length-capped). Shown in the list and used as the export body. |
| **Content** | The item's feed-provided HTML body (content, falling back to description). Shown in the reading pane's "Feed content" mode. |
| **Full content** | The article's body extracted from the **origin page** by readability, cached on the article. Shown in "Read full article" mode. |
| **Read / Unread** | Per-article boolean (`is_read`). The reader's primary state. |
| **Starred** | Per-article boolean (`is_starred`); a manual flag independent of read state. |
| **Refresh** | Fetching one feed (or all feeds) and inserting any new articles. |
| **Conditional GET** | A refresh that sends `If-None-Match` / `If-Modified-Since` from the feed's stored `etag` / `last_modified`, so unchanged feeds return `304` and cost nothing. |
| **Scope** | An export's source narrowing: all articles, starred only, one folder, or one feed. Mirrors the sidebar **Selection**. |
| **Selection** | What the sidebar has chosen as the current view: All, Starred, a Folder, or a Feed. Drives the article list and seeds the export Scope. |
| **Range** | An export's time window: today, yesterday, last 7 days, last 30 days, all time, or a custom from/to — with day boundaries drawn in the **operator's timezone**. |
| **Filter** | The read-state narrowing of the article list or export: unread / all / starred / read. |
| **Seed** | The one-time first-run import of the bundled OPML file. |
| **Meta** | The `meta` key/value table for small bits of server state (e.g. the `seeded` flag). |
| **Deep-link** | The short URL `/a/{id}` that opens the reader focused on article `id`; used in exports as the "in reader" link. |

## 3. The data model (binding)

Feedler persists everything in a single SQLite database file (`feedler.db`) in the data directory,
opened in **WAL** mode with foreign keys on and a single writer connection. Three tables:

```sql
feeds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  xml_url         TEXT NOT NULL UNIQUE,    -- identity of a feed
  html_url        TEXT,                    -- the site link, for display
  title           TEXT NOT NULL,
  folder          TEXT,                    -- single-level label; "" → Uncategorized in the UI
  etag            TEXT,                    -- conditional-GET validators
  last_modified   TEXT,
  last_fetched_at TIMESTAMP,
  last_error      TEXT,                    -- last refresh error, or NULL when healthy
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id       INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid          TEXT NOT NULL,
  title         TEXT,
  link          TEXT,                      -- the original article URL
  author        TEXT,
  summary       TEXT,                      -- plain-text excerpt (ingest-derived)
  content       TEXT,                      -- feed-provided HTML body
  full_content  TEXT,                      -- readability-extracted body, cached lazily
  published_at  TIMESTAMP,
  fetched_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_read       INTEGER DEFAULT 0,
  is_starred    INTEGER DEFAULT 0,
  UNIQUE(feed_id, guid)                    -- de-duplication key
)

meta ( key TEXT PRIMARY KEY, value TEXT )
```

**Binding invariants** (every spec and build must keep these true):

1. **A feed is its `xml_url`.** Importing or adding the same `xml_url` again updates the existing
   row (title/folder/html_url), never creates a duplicate.
2. **An article is `(feed_id, guid)`.** Re-fetching a feed never duplicates an item; a conflicting
   insert is ignored. Existing read/starred state is therefore preserved across refreshes.
3. **Deleting a feed deletes its articles** (`ON DELETE CASCADE`). Removing a feed leaves no orphan
   rows and no residue beyond what the operator exported.
4. **Article ordering is by `COALESCE(published_at, fetched_at) DESC`** everywhere a list or export
   is produced — items without a publish date sort by when Feedler first saw them.
5. **Timestamps are stored in UTC**; timezone conversion happens only at the export boundary
   (`export_spec`) and in the browser for display.
6. **`last_error` is the feed's health.** It is set on a failed refresh and cleared (`NULL`) on any
   success or `304`.

The SQL schema above is the storage truth; the JSON shapes the API returns are the **wire truth**
and live in `standards/api_contract.md`. They overlap but are specified once each.

## 4. The components

Feedler is one deployable, but its behavior decomposes into the areas below. Each area has a spec
that owns its WHAT; this table is the map. The implementation is built into **`workspace/`**
(mirroring `specs/`) and is disposable (`vision.md` §5.5): the `backend/` and `frontend/` source
trees, the `Dockerfile`, and the `docker-compose.yml` all live under `workspace/`, not at the repo
root.

| Area | Owns | Spec |
|------|------|------|
| **Engineering standard** | The stack, the single-binary/single-port rule, embedding the SPA, the build (multi-stage Docker), deployment & compose, configuration (env vars), persistence rules, security posture, and the testing floor. | `standards/engineering_standard.md` |
| **API contract** | Every HTTP endpoint, its parameters, request/response JSON shapes, status codes, and the error shape. The frontend and backend each implement their side of this; it is the verbatim wire truth. | `standards/api_contract.md` |
| **Ingestion** | Getting articles into the database: OPML parse / import / first-run seed, the fetcher (conditional GET, dedup, GUID rule, summary/content derivation, size caps, error capture, concurrency, single-flight), feed probing, and the background scheduler. | `components/ingestion_spec.md` |
| **Feed management** | Operator control of feeds from the UI: add by URL, remove, rename, move to a folder; surfacing per-feed errors with a retry; the sidebar's folder→feed tree and unread counts. | `components/feed_management_spec.md` |
| **Reading** | The reading experience: the article list (ordering, density, time display, empty/loading states), the reading pane (Feed-content vs Read-full-article, HTML sanitization, links open externally), read/unread/star actions, read-on-scroll, the filter/search controls, the Selection model, the deep-link, and the keyboard shortcuts. | `components/reading_spec.md` |
| **Export** | The signature feature: the Markdown export — ranges and timezone law, scope, filter, grouping, the exact item format with dual links, the live preview, and copy/download. | `components/export_spec.md` |
| **Settings** | Client-stored preferences (read-on-scroll on/off and delay, list density, default filter), their persistence and cross-tab sync, reset, and the theme preference; plus the boundary with server-side (env) configuration. | `components/settings_spec.md` |
| **Design** | The visual and interaction language: the three-pane layout, light/dark theming, density, dialog/menu patterns, typography and color *intent*, motion intent, accessibility floor, and responsiveness. Behavior lives in the feature specs; appearance lives here. | `design/design_spec.md` |

The frontend and backend are independently buildable and replaceable: each implements its side of
`api_contract.md` and nothing else couples them.

## 5. The principles (non-negotiable)

Any proposed change that violates one of these must be rejected or escalated to the operator.

1. **One binary, one port, one command.** A single Go binary serves both the JSON API and the
   embedded SPA on a single configurable port; `docker compose up --build` is the entire bring-up.
   No separate frontend server in production, no second exposed port, no host tooling beyond Docker.
2. **Local-first, single-user, no auth.** There is no authentication and no user model. All state is
   the one operator's. Nothing in the system may assume a `user_id` or a login.
3. **Your data is one portable file.** All durable state lives in one SQLite file the operator can
   copy, back up, or delete. No state hides in another store; client preferences (theme, settings)
   live in the browser and are explicitly *not* durable server state.
4. **Politeness to origins is mandatory.** Refreshes use conditional GET, cap response sizes, set a
   User-Agent, and run on an interval — never a tight loop, never an unbounded download.
5. **Identity → de-duplication.** A feed is its `xml_url`; an article is its `(feed_id, guid)`.
   Re-import and re-fetch are idempotent and never destroy read/starred state. (§3 invariants 1–2.)
6. **All third-party HTML is untrusted.** Feed content and readability output are sanitized before
   rendering, and every link in rendered article HTML opens in a new tab with `noopener`. Feedler
   renders other people's HTML; it must never let that HTML hijack the reader or run script.
7. **No embedded AI; the export is the seam.** The backend makes no LLM calls and holds no model or
   API key. AI integration is achieved by producing a clean Markdown digest the operator pastes into
   the AI of their choice. (vision §5.2.)
8. **Exports carry dual links and honor the operator's timezone.** Every exported item links to both
   the original article and its Feedler deep-link; date ranges ("today", "this week") are computed in
   the operator's timezone, not the server's. (`export_spec`.)
9. **Specs define WHAT; the implementer decides HOW.** Wire contracts (api_contract), the data model
   (§3), the export format, named config keys, and behaviors a user relies on are verbatim and
   binding. Stack choices, file layout, and internal structure are the implementer's — but the stack
   named in `engineering_standard.md` is the chosen one and changing it is a spec change. Transcribed
   implementation in a spec is a defect; **omitted WHAT is equally a defect** (`start.md` §0).
10. **CGO-free, statically buildable.** The binary builds with `CGO_ENABLED=0` (a pure-Go SQLite
    driver) so the runtime image is a minimal static deployable. No native toolchain at runtime.

## 6. Lifecycle stories

These stories are the architecture's acceptance tests. Every relevant spec must keep them true.

**First run.** `docker compose up --build` builds the SPA, embeds it into the Go binary, and starts
the container. The binary creates `feedler.db`, and if a seed OPML is configured and the `seeded`
meta flag is unset, it imports those feeds once and marks `seeded`. The scheduler runs an immediate
refresh, then on the configured interval. Opening the port shows the three-pane reader populating
with articles.

**A feed is added / managed.** The operator adds a feed by URL; Feedler probes it for a real title,
upserts the row, and kicks an immediate refresh so articles appear without waiting for the interval.
Rename, move-to-folder, and remove operate on that one feed; remove cascades its articles away. A
feed that errors shows its error in the sidebar with a one-click retry. (`feed_management_spec`.)

**A refresh cycle.** On the interval (or on demand), the fetcher walks every feed concurrently
(bounded), sends conditional requests, parses changed feeds, inserts only new `(feed_id, guid)`
items, and records per-feed success or error. A single global refresh runs at a time; its summary
(feeds / succeeded / failed / new) is queryable. (`ingestion_spec`.)

**Reading & triage.** The operator picks a Selection (All / Starred / folder / feed), filters
(unread by default), and walks the list with `j`/`k`. Opening an item marks it read; scrolling an
unread item off the top marks it read after a tunable delay (if enabled). Stars, mark-all-read, and
a Feed-vs-Full-article toggle are one keystroke or click away. Unread counts update immediately.
(`reading_spec`.)

**Export to an AI.** The operator opens Export, which seeds its Scope from the current Selection,
picks a Range and grouping, sees a live Markdown preview, and copies or downloads it. Each item
carries a source link and an in-reader deep-link; day boundaries use the browser's timezone.
Pasted into any LLM, the digest is self-describing. (`export_spec`.)

**Reset / rebuild.** `docker compose down -v` deletes the data volume — Feedler is gone with no
residue. `docker compose up --build` rebuilds it from scratch and re-seeds. Deleting the *code* and
rebuilding it from this spec suite (`start.md`) must yield the same system: same data model, same
wire contract, same export format, same behaviors.

## 7. What this architecture deliberately does not have

- No authentication, sessions, accounts, or multi-tenancy.
- No second datastore (no Redis, no external cache), no message queue, no background-job service
  beyond the in-process scheduler.
- No server-side LLM/AI calls, no API keys, no outbound calls except fetching subscribed feeds and
  on-demand article full-text.
- No separately deployed frontend; the SPA is embedded in the one binary.
- No server-stored per-operator preferences; theme and reading settings live in the browser.
- No telemetry, analytics, or phone-home.
