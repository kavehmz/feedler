# Feedler — Ingestion — OPML import/seed, the fetcher, conditional GET, dedup, scheduler

**Status:** Component spec. **Read `architecture.md` (§2 glossary, §3 data model + invariants) and
`standards/engineering_standard.md` (§4 config, §6 security/fetch caps) first.**
**Scope:** everything that gets articles into the database. This spec owns OPML parsing, OPML import,
the first-run seed, the fetcher (conditional GET, item insertion, dedup, summary/content derivation,
size caps, error capture), refresh-all (concurrency + single-flight), refresh-one, the no-write
probe, and the background scheduler.

This spec defines **WHAT** ingestion must do. The HTTP request/response shapes that trigger and
report ingestion are owned by `standards/api_contract.md` (§4 feeds/refresh, §6 import/export) and are
cited, not restated. The add-feed flow, error-surfacing UI, sidebar tree, and retry control are
`feed_management_spec`'s; this spec owns only the **probe mechanics** the add flow calls. Readability
full-text extraction is `reading_spec`'s; Markdown export is `export_spec`'s.

---

## 1. Glossary (this spec)

All terms are reused **verbatim** from `architecture.md` §2: **Feed, Folder, Article, GUID, Summary,
Content, Refresh, Conditional GET, Seed, Meta**. No synonyms are introduced. Two local working terms,
defined only because they name mechanisms internal to ingestion:

| Term | Meaning |
|------|---------|
| **Refresh stat** | The summary record of the most recent (or in-progress) all-feeds Refresh: when it started and finished, how many feeds it touched, how many succeeded, how many failed, and how many new articles it inserted. The JSON form is `RefreshStat` (`api_contract.md` §1). |
| **Probe** | A one-shot fetch-and-parse of a feed URL that **never writes to the database**, used to discover a Feed's real title and site link before it is stored (`api_contract.md` §4 `POST /api/feeds`). |

---

## 2. OPML parsing

OPML parsing turns an OPML document (an XML tree of nested `<outline>` elements) into a flat list of
**imported feeds**, each carrying a resolved title, the feed URL, the optional site link, and a single
flattened Folder path string. Parsing **never touches the database** — it is a pure transformation
from bytes to a list. Import (§3) is the separate step that writes.

### 2.1 What an outline is

Each `<outline>` element may carry `title`, `text`, `xmlUrl`, and `htmlUrl` attributes and may contain
child `<outline>` elements. The single distinguishing rule:

- **An outline with a non-empty `xmlUrl` is a Feed.** Its children, if any, are ignored.
- **An outline without an `xmlUrl` is a folder container.** It contributes a Folder path segment and
  its children are walked.

The parser tolerates non-strict XML: it does not require a strict document, auto-closes HTML-style
tags, and resolves HTML entities, so real-world OPML exports from other readers parse. A document that
cannot be decoded at all is a parse error (surfaced as `400` by the import endpoint —
`api_contract.md` §6).

### 2.2 Title resolution

A Feed's title is the **first non-empty, whitespace-trimmed** value among, in order:

1. the outline's `title` attribute,
2. the outline's `text` attribute,
3. the outline's `xmlUrl`.

So a feed outline with neither `title` nor `text` is titled by its URL (never left blank — the
`feeds.title` column is `NOT NULL`, `architecture.md` §3). The resolved title is stored trimmed.

A folder container's label is the first non-empty of its `title` then `text` (a container has no
`xmlUrl` to fall back to); a container with neither contributes no new segment (§2.3).

### 2.3 Folder flattening (nested tree → single-level path)

Folders are single-level in the data model (`architecture.md` §2). OPML nesting is **flattened** into
one path string by joining ancestor container labels with `" / "` (space–slash–space). The rules,
applied while walking the tree depth-first with an accumulated `parent` path (initially empty):

- At a **feed** outline: its Folder is exactly the accumulated `parent` path — **the feed's own title
  is never part of its Folder**. A feed at the top level (no enclosing container) has Folder `""`,
  which the UI presents as **"Uncategorized"** (`architecture.md` §2; never stored as that literal).
- At a **container** outline: compute its label (§2.2). The new accumulated path is:
  - `parent + " / " + label` when both `parent` and `label` are non-empty;
  - `label` when `parent` is empty and `label` is non-empty;
  - `parent` unchanged when `label` is empty (an unlabeled container is transparent — it adds no
    segment but does not break the chain).
- Containers nest arbitrarily deep; each non-empty label adds one `" / "`-joined segment. The result
  is always a single string, never a tree.

#### Worked example (binding)

Input OPML (2 levels of nesting, plus a top-level feed):

```xml
<opml version="1.0">
  <body>
    <outline title="Tech">
      <outline title="Cloudflare Blog" xmlUrl="https://blog.cloudflare.com/rss/"
               htmlUrl="https://blog.cloudflare.com"/>
      <outline title="Cloud">
        <outline text="AWS News" xmlUrl="https://aws.amazon.com/blogs/aws/feed/"/>
      </outline>
    </outline>
    <outline title="Daring Fireball" xmlUrl="https://daringfireball.net/feeds/main"/>
  </body>
</opml>
```

Produced imported feeds (in document order):

| Title | xmlUrl | Folder string |
|---|---|---|
| `Cloudflare Blog` | `https://blog.cloudflare.com/rss/` | `Tech` |
| `AWS News` | `https://aws.amazon.com/blogs/aws/feed/` | `Tech / Cloud` |
| `Daring Fireball` | `https://daringfireball.net/feeds/main` | `""` (→ Uncategorized) |

This mapping — a feed directly under one container gets that container's label; a feed two containers
deep gets `"Parent / Child"`; a top-level feed gets the empty Folder — is the binding test case.

### 2.4 Feeds with no `xmlUrl` are not feeds

An outline with no `xmlUrl` is only ever a container (§2.1). It never becomes an imported feed, so it
can never reach import as a feed entry. (Import additionally guards against an empty `xml_url` as a
defensive skip — §3.2.)

---

## 3. OPML import

Import takes a list of imported feeds (from §2) and persists them, **upserting by `xml_url`**. It is
the write step; it returns counts. The HTTP entry point and its accepted encodings (multipart `file`
field or raw OPML body) and response shape are `api_contract.md` §6 (`POST /api/import`) — not
restated here. After a successful import, a background all-feeds Refresh is kicked so articles appear
without waiting for the interval (the kick is the API layer's; this spec owns only the upsert and the
counts).

### 3.1 Upsert by `xml_url` (no duplicates — invariant 1)

Each imported feed is written by inserting on `xml_url`; on a conflict with an existing Feed the row is
**updated** in place, setting `html_url`, `title`, and `folder` to the imported values. A feed is its
`xml_url` (`architecture.md` §3 invariant 1): re-importing the same `xml_url` **never creates a
duplicate** and never disturbs that feed's articles, validators, or read/starred state — only its
display fields (`title`/`folder`/`html_url`) move. The whole import runs in a single transaction:
either all rows are written or none are.

### 3.2 Returned counts `{inserted, updated, skipped}`

Import returns three counts, surfaced by the endpoint as `{ "inserted", "updated", "skipped" }`
(`api_contract.md` §6):

| Count | Meaning |
|---|---|
| `skipped` | Imported entries with an **empty `xml_url`**. Such an entry cannot identify a Feed, so it is counted and skipped (not written). |
| `inserted` | Entries that created a **new** Feed row. |
| `updated` | Entries that matched an existing `xml_url` and updated it. |

**The insert-vs-update split is a best-effort heuristic.** It is derived from SQLite's rows-affected
signal on the upsert (an update-branch reports more affected rows than a fresh insert); the
`inserted`/`updated` boundary may therefore be approximate at the margins. What is **exact and
binding** is the total and the no-duplicate guarantee: `inserted + updated` equals the number of
entries with a non-empty `xml_url`, `skipped` equals the number with an empty one, and no `xml_url`
ever yields two rows. A consumer must not treat `inserted`/`updated` as authoritative beyond "feeds
were imported".

---

## 4. First-run seed

The Seed (`architecture.md` §2) is the one-time first-run import of a bundled OPML file, gated by the
**Meta** table so it happens exactly once across restarts.

### 4.1 The `meta` table's role

`meta` is a `key`/`value` table for small bits of durable server state (`architecture.md` §2, §3). The
seed uses one key, **`seeded`**, whose value is the literal string `"1"` once the seed has run
successfully. The table is the only place this "have we seeded yet" fact lives; it persists in the
same SQLite file as everything else, so a restart (or a re-run of the binary against the same data
dir) does not re-seed.

### 4.2 The seed sequence

On startup, **before** the HTTP listener and scheduler start:

1. If `FEEDLER_SEED_OPML` (`engineering_standard.md` §4) is unset/empty, do nothing — no seed is
   configured.
2. Otherwise read the `seeded` Meta key. If its value is already `"1"`, do nothing — the seed has
   already run.
3. Otherwise check the file at `FEEDLER_SEED_OPML`:
   - **File missing:** log that the seed OPML was not found and continue without seeding. A missing
     seed file is **not** an error — the operator may simply have no bundled feeds. The `seeded` flag
     is **not** set, so a later run with the file present will still seed.
   - **File present:** parse it (§2) and import it (§3) once. On a successful import, log the
     `{inserted, updated, skipped}` counts and set the `seeded` Meta key to `"1"`. A parse error or an
     import error is logged and the run continues **without** setting `seeded` (the next start retries
     the seed).

This realizes the **First run** lifecycle story (`architecture.md` §6): on a fresh `feedler.db`, with a
seed configured and present, the bundled feeds are imported once and marked seeded, and the scheduler's
immediate refresh (§8) populates articles. The Docker image's default seed path is
`/seed/Feeds.opml` (`engineering_standard.md` §4); bare runs leave `FEEDLER_SEED_OPML` unset and skip
the seed entirely.

---

## 5. The fetcher — conditional GET

The fetcher performs a Refresh of one Feed: a polite, conditional, size-capped HTTP GET, followed by
parsing and item insertion. It upholds `architecture.md` principle 4 (politeness) and §3 invariant 6
(`last_error` is the feed's health).

### 5.1 The request

Every fetch is an HTTP `GET` of the Feed's `xml_url` carrying:

- a descriptive **`User-Agent`** identifying Feedler (`engineering_standard.md` §6.3);
- an **`Accept`** header advertising feed content types — Atom and RSS XML preferred, generic XML next,
  then a wildcard fallback — so origins that content-negotiate return feed XML. The literal header
  value used is:

  ```
  Accept: application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8
  ```

- **Conditional GET validators** (`architecture.md` §2): if the Feed has a stored `etag`, send it as
  `If-None-Match`; if it has a stored `last_modified`, send it as `If-Modified-Since`. Either, both, or
  neither may be present on a given Feed.

The HTTP client enforces a request timeout so a slow origin cannot stall a refresh indefinitely
(`engineering_standard.md` §6.3).

### 5.2 Response handling (by status)

| Outcome | Behavior |
|---|---|
| **`304 Not Modified`** | The Feed is unchanged. Set `last_fetched_at` to now and **clear `last_error`** (`NULL`). Do **not** parse, insert, or touch the validators. New-article count is **0**. This is the cheap path the conditional GET exists to produce. |
| **Any other 2xx** | Read the body (capped — §5.4), parse it, insert items (§6), then store the response's `ETag` and `Last-Modified` as the Feed's new validators, set `last_fetched_at` to now, and clear `last_error`. The new-article count is the number of newly-inserted rows. |
| **Non-2xx (and not 304)** | Record the literal string `HTTP <code>` (e.g. `HTTP 404`, `HTTP 502`) as `last_error`, set `last_fetched_at` to now. No parse, no insert; count 0; the refresh of this feed is a failure. |

The stored validators are taken from whatever the origin returns; an origin that omits `ETag` /
`Last-Modified` simply stores empty validators and the next refresh is unconditional.

### 5.3 Network and parse errors

If the request cannot be built, the HTTP call fails (DNS, connection, timeout), the body cannot be
read, or the body cannot be parsed as a feed, the error is recorded as the Feed's `last_error` and
`last_fetched_at` is set to now; the refresh of that feed is a failure with count 0. The recorded
error message is **bounded to 500** (the same stored-length bound the Summary uses — §6.2, §11), so
`last_error` always holds a bounded message, never an unbounded upstream dump. Each recorded error is
also logged operationally (`engineering_standard.md` §6.5 — logs are operational only, no PII).

### 5.4 Response size cap (binding)

The response body is read through a **limited reader** so a hostile or runaway origin cannot exhaust
memory (`architecture.md` principle 4; `engineering_standard.md` §6.3). The cap for **feed bodies is
on the order of 20 MB**; bytes beyond the cap are not read. The probe (§7) reads through its own
smaller cap. Exact byte values are an implementation detail; the **binding requirement is that a feed
fetch is always size-bounded**, never an unbounded download.

### 5.5 `last_error` is the feed's health (invariant 6)

Per `architecture.md` §3 invariant 6: `last_error` is set on any failed refresh (non-2xx, network, or
parse) and cleared (`NULL`) on **any** success — including a `304`. A Feed whose last refresh
succeeded or returned `304` therefore reads as healthy; one whose last refresh failed carries its
error for the UI to surface (`feed_management_spec`).

---

## 6. Item insertion

For a parsed feed body, the fetcher inserts each item as an Article, de-duplicated by `(feed_id, guid)`
(`architecture.md` §3 invariant 2). All inserts for one feed run in a single transaction.

### 6.1 The GUID rule (binding)

An Article's **GUID** (`architecture.md` §2) is resolved as the first non-empty of, in order:

1. the item's guid,
2. the item's link,
3. the item's title.

**An item with none of the three is skipped** (it cannot be de-duplicated, so it is not inserted and
not counted). This is the binding dedup key derivation.

### 6.2 Field derivation per item

| Article field | Derived from |
|---|---|
| `guid` | The GUID rule (§6.1). |
| `title` | The item's title (may be empty). |
| `link` | The item's link — the **original article URL** (`architecture.md` §3). |
| `author` | The item author's **name**, if the item carries an author; otherwise empty. |
| `published_at` | The item's **parsed published** date if present, else its **parsed updated** date; **may be null** if the item carried neither parseable date. (A null `published_at` sorts by `fetched_at` everywhere — `architecture.md` §3 invariant 4.) |
| `summary` | A **plain-text excerpt of the item's description** with all markup tags stripped and runs of whitespace collapsed to single spaces, **capped at 800 characters** with an ellipsis (`…`) appended when truncated. This is the **Summary** (`architecture.md` §2) shown in the list and used as the export body. The cap is by stored length; long multibyte descriptions are truncated to roughly 800 characters. |
| `content` | The item's **content**, falling back to the item's **description** when the item has no separate content. This is the **Content** (`architecture.md` §2) — feed-provided HTML, rendered (after client sanitization) in the reading pane's Feed-content mode (`reading_spec`). It is stored as-is and sanitized only at render time, never at ingest. |

`full_content` is **not** set at ingest; it is filled lazily by readability on demand (`reading_spec`,
`api_contract.md` §5 `GET /api/articles/{id}/full`). `is_read`/`is_starred` take their schema defaults
(unread, unstarred) on insert and are never overwritten by a re-fetch (§6.3).

### 6.3 Insert-or-ignore and the new-article count (binding — invariant 2)

Each item is inserted with **`ON CONFLICT(feed_id, guid) DO NOTHING`**. The new-article count for a
refresh is the number of rows the inserts **actually created** — items that conflicted with an existing
`(feed_id, guid)` add nothing to the count and change nothing in the database.

This makes re-fetch **idempotent** (`architecture.md` §3 invariant 2): an item already stored is left
exactly as it is, so its read/starred state, its cached `full_content`, and its original `fetched_at`
are **preserved** across every subsequent refresh. Refreshing a feed that has not published anything
new inserts zero rows and reports zero new articles even on a full `200` (distinct from a `304`, which
short-circuits before parsing — §5.2).

---

## 7. Probe (no-write title discovery)

The Probe fetches and parses a feed URL **once, without writing anything to the database**, returning
the feed's **title** and **site link** (its `html_url`). It exists so the add-feed flow can show the
operator a real title instead of a raw URL when `title` is omitted (`api_contract.md` §4
`POST /api/feeds`). This spec owns the probe mechanics; the add flow that calls it — and the fallback
to the `xml_url` as title when the probe yields nothing — is `feed_management_spec`'s.

Probe behavior:

- Issues a `GET` with the same `User-Agent` and `Accept` header as a refresh (§5.1), but sends **no**
  conditional validators (there is no stored Feed yet).
- Reads the body through a limited reader with its own cap (smaller than the refresh cap — §5.4).
- On **any** failure (request build, network, non-2xx status, read error, or parse error) the probe
  returns **empty** title and link — it never errors out the caller and never writes. The caller
  decides what to do with an empty result (fall back to the URL).
- On success, returns the parsed feed's title and link, both whitespace-trimmed.

---

## 8. Refresh — all, one, and the stat

### 8.1 Refresh all (concurrent, bounded, single-flight)

A **refresh-all** loads every Feed and refreshes them **concurrently** through a **bounded worker
pool** (concurrency cap of **8** simultaneous feed fetches), so a large subscription list refreshes
quickly without opening an unbounded number of connections (`architecture.md` principle 4). Feeds are
loaded with their stored validators so each fetch is a conditional GET (§5).

**Single-flight (binding):** only **one** all-feeds refresh runs at a time. A second attempt to start
one while a refresh is in progress does **not** start a parallel run; it fails fast with an
**"already in progress"** error and the in-flight run continues untouched. The HTTP refresh-all
endpoint returns immediately and runs the work in the background regardless (`api_contract.md` §4
`POST /api/feeds/refresh` → `202`); single-flight ensures that concurrent triggers (the scheduler tick
plus a manual refresh, say) collapse into one run.

Each feed's refresh is independent: one feed failing (§5.3) does not abort the others; it only
increments the failure tally.

### 8.2 The refresh stat (queryable afterward)

A refresh-all produces a **Refresh stat** (§1) recording: `started_at`, `finished_at` (set when the run
completes), the number of `feeds` walked, how many `succeeded`, how many `failed`, and the total
`new_articles` inserted across all feeds. `succeeded` counts feeds whose refresh returned without error
(including `304`s and `200`s with zero new items); `failed` counts feeds whose refresh errored;
`succeeded + failed = feeds`. The stat of the **most recent or in-progress** run is retained in memory
and is queryable afterward via `api_contract.md` §4 `GET /api/feeds/refresh-status` (shape `RefreshStat`,
§1). Before the first run ever completes, `finished_at` reads as its zero value (`api_contract.md` §1).

### 8.3 Refresh one (synchronous)

A **refresh-one** refreshes a single Feed by its id **synchronously** and returns the count of newly
inserted articles. It loads that feed's validators, runs the same conditional fetch + insert path as a
member of refresh-all (§5, §6), and records the feed's success/`304`/error exactly the same way. It is
**not** gated by the single-flight lock (it touches one feed, not the global set) and does not update
the Refresh stat. The HTTP entry point is `api_contract.md` §4 `POST /api/feeds/{id}/refresh` (→ `200
{ "new_articles": <int> }`, or `500` with the feed's `last_error` recorded on failure). If the id
matches no feed, refresh-one reports a not-found error and records nothing (there is no row to record
an error on).

---

## 9. The scheduler

The scheduler drives background refreshes on the configured cadence:

1. **Immediate refresh on startup.** As soon as the scheduler starts, it runs one refresh-all (§8.1).
   This is what populates a freshly seeded database without waiting for the first interval (the
   **First run** story, `architecture.md` §6).
2. **Then on the interval.** After the immediate run, it refreshes all feeds every
   **`FEEDLER_REFRESH_INTERVAL_MINUTES`** (`engineering_standard.md` §4; default 30, values `< 1`
   coerced to the default). Each tick triggers a refresh-all; single-flight (§8.1) means a tick that
   lands while a previous run is still going is harmlessly skipped rather than stacking.
3. **Clean stop on context cancellation.** The scheduler stops when the process context is cancelled
   (on `SIGINT`/`SIGTERM`, `engineering_standard.md` §8). It does not outlive the process or block
   shutdown.

Each scheduled run's outcome (feeds/succeeded/failed/new, or the error) is logged operationally. The
scheduler is the only thing that initiates refreshes on its own; all other refreshes are operator- or
API-initiated.

---

## 10. Risk & failure considerations

Ingestion is the component that talks to untrusted origins and writes the most rows, so it carries
real failure surface:

- **Politeness to origins (mandatory — `architecture.md` principle 4).** Conditional GET (§5) is the
  mitigation against re-downloading unchanged feeds; the size cap (§5.4) is the mitigation against a
  runaway/hostile body; the User-Agent and request timeout identify and bound each fetch. A regression
  that drops the conditional headers or the cap is a politeness defect even if functionally "working".
  The acceptance check is that unchanged feeds return `304` and cost nothing (`engineering_standard.md`
  §9, `start.md` §4 QA layer 4).
- **Memory exhaustion.** The size cap (§5.4) and the bounded worker pool (cap 8, §8.1) together bound
  peak memory during a refresh: at most a fixed number of feeds are in flight and each body is read
  through a limited reader.
- **Stored HTML is untrusted but stored raw.** `summary` is plain text (tags stripped at ingest, §6.2),
  but `content` is stored as the feed's raw HTML and is **not** sanitized at ingest. Sanitization is a
  **render-time** obligation on the client (`engineering_standard.md` §6.1, `reading_spec`); ingestion
  must never be relied on as the sanitization boundary.
- **Error message bounding.** `last_error` is bounded to 500 of stored length (§5.3) so a pathological
  upstream error cannot bloat the row or the logs.
- **Idempotence is load-bearing for trust.** The `(feed_id, guid)` insert-or-ignore (§6.3) is what
  keeps "already read" trustworthy (`vision.md` §5.4) across refreshes; any change that re-inserts or
  overwrites existing articles would silently destroy read/starred state and is forbidden by
  `architecture.md` §3 invariant 2.

## 11. Open questions / flagged friction

These are places the implementation does something the spine does not obviously dictate; flagged per
`start.md` §0 rather than silently "corrected":

- **Length bounds are by stored byte length, not character count.** Both the Summary 800-cap (§6.2)
  and the `last_error` 500-bound (§5.3) are applied to the stored byte length; text heavy in multibyte
  characters can be cut at fewer than the nominal number of visible characters (and, in principle,
  mid-character). The spine says only "length-capped" (`architecture.md` §2), so this is conformant but
  worth confirming the intended unit. *(Builder note: a character-count cap would be a behavior change
  — spec it first if desired.)*
- **Insert-vs-update counts are heuristic** (§3.2). The total and no-duplicate guarantee are exact; the
  split is approximate. The API contract (`api_contract.md` §6) presents `inserted`/`updated` as plain
  integers without promising precision, so this is consistent — flagged only so consumers do not
  over-trust the split.

---

## Acceptance Criteria

- **OPML parse — folder flattening.** The §2.3 worked example produces exactly the three feeds with
  Folder strings `Tech`, `Tech / Cloud`, and `""`. A feed's own title never appears in its Folder; a
  feed two containers deep yields `"Parent / Child"`; an unlabeled container adds no segment.
- **OPML parse — title resolution.** A feed outline with no `title`/`text` is titled by its `xmlUrl`
  (never blank). Resolved titles are trimmed.
- **OPML parse — feed vs container.** An outline with `xmlUrl` is a feed (children ignored); one
  without is a container (walked, contributes a segment).
- **Import — upsert by `xml_url`.** Importing the same OPML twice produces no duplicate feeds; the
  second import reports the same feeds as `updated`, not `inserted`, and does not disturb articles or
  read/starred state. `skipped` counts entries with an empty `xml_url`; `inserted + updated` equals the
  non-empty-`xml_url` entries.
- **Seed — once only, gated by Meta.** With a present seed file and `seeded` unset, first run imports
  once and sets `seeded` to `"1"`; a restart does not re-seed. A missing seed file logs and is skipped
  **without** setting `seeded` (so a later present file still seeds). No seed configured → no seed.
- **Fetcher — conditional GET.** A feed with stored validators sends `If-None-Match` /
  `If-Modified-Since`; an unchanged feed returns `304`, updates `last_fetched_at`, clears `last_error`,
  inserts nothing, and reports 0 new.
- **Fetcher — 2xx.** A changed feed parses, inserts only new `(feed_id, guid)` items, stores the new
  `ETag`/`Last-Modified`, and clears `last_error`.
- **Fetcher — failures.** A non-2xx records `HTTP <code>` as `last_error`; a network/parse error
  records the (≤500-char) error; both set `last_fetched_at`; both report 0 new and a failure.
- **Item insertion — GUID + dedup.** GUID = guid → link → title; an item with none is skipped.
  Re-fetch never duplicates and never overwrites read/starred state. Summary is tag-stripped plain text
  capped at 800; content falls back to description; `published_at` is published-then-updated, nullable.
- **Refresh all — concurrency, single-flight, stat.** Refreshes run concurrently bounded at 8; a second
  concurrent start returns an "already in progress" error; the resulting Refresh stat (feeds /
  succeeded / failed / new_articles, with `succeeded + failed = feeds`) is queryable afterward.
- **Refresh one.** Refreshes a single feed synchronously and returns its new-article count; an unknown
  id is a not-found error.
- **Probe.** Fetches + parses a URL once with no DB write, returns trimmed title and site link, and
  returns empty (never errors the caller) on any failure.
- **Scheduler.** Runs one refresh immediately on startup, then every
  `FEEDLER_REFRESH_INTERVAL_MINUTES`, and stops cleanly on context cancellation.

## Deliverables checklist

- [ ] OPML parser: nested `<outline>` tree → flat list; feed = has `xmlUrl`, container = no `xmlUrl`;
      title = first non-empty of title/text/xmlUrl; Folder flattened to `"Parent / Child"` with the
      feed's own title excluded (§2, worked example §2.3).
- [ ] OPML import: upsert by `xml_url` (no duplicates, invariant 1); returns `{inserted, updated,
      skipped}` with `skipped` = empty-`xml_url` entries and the documented heuristic split (§3).
- [ ] First-run seed: gated by the `seeded` Meta key; present file → import once + set `seeded`;
      missing file → log + skip without setting the flag; unset env → no seed (§4).
- [ ] Fetcher conditional GET: `User-Agent` + feed `Accept`; `If-None-Match`/`If-Modified-Since` from
      stored validators; 304 / 2xx / non-2xx / error handling per §5; `last_error` set on failure and
      cleared on any success incl. 304 (invariant 6).
- [ ] Response size cap via a limited reader (~20 MB feeds; smaller for the probe) (§5.4).
- [ ] Item insertion: GUID rule with skip; author/published/summary(≤800, tag-stripped)/content
      derivation; `ON CONFLICT(feed_id, guid) DO NOTHING`; new-article count = rows actually created;
      idempotent re-fetch preserving read/starred state (invariant 2) (§6).
- [ ] Refresh-all: concurrent, bounded (cap 8), single-flight ("already in progress" on re-entry),
      producing a queryable Refresh stat (§8.1–8.2).
- [ ] Refresh-one: synchronous single-feed refresh returning new-article count; not-found handling
      (§8.3).
- [ ] Probe: one-shot fetch+parse, no DB write, returns title + site link, empty on any failure (§7).
- [ ] Scheduler: immediate startup refresh, then interval refreshes, clean stop on context cancellation
      (§9).
- [ ] Risk mitigations present: conditional GET, size cap, bounded concurrency, 500-length error
      bound; ingestion is **not** the HTML sanitization boundary (§10).
