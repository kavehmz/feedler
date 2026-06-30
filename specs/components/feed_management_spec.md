# Feedler — Feed management — add/remove/rename/move, errors + retry, the sidebar tree, OPML import UI

**Status:** Binding for the feed-management UI. **Read `architecture.md` first** (the glossary §2, the
data model §3, the principles §5). This spec owns the operator's control of **Feed**s and **Folder**s
*from the UI*: the sidebar navigation tree, adding a feed by URL, the per-feed action menu
(refresh/rename/move/copy/show-error/remove), surfacing a feed's error with a retry, the OPML import
dialog, and where the sidebar's unread counts come from.

It does **not** own: the **Selection** model itself and the article list / reading pane
(`components/reading_spec.md`); the OPML parse/import/seed mechanics, the fetcher, probing, conditional
GET and dedup (`components/ingestion_spec.md`); the visual styling — color, type, spacing, motion
(`design/design_spec.md`). It cites those rather than restating them.

The wire contract for every endpoint named here is `standards/api_contract.md` §4 (feeds) and §6
(import); it is quoted, never duplicated.

---

## 0. Scope & local glossary

All canonical terms — **Feed**, **Folder**, **Article**, **Read/Unread**, **Starred**, **Refresh**,
**Selection**, **Uncategorized**, **Seed**, **Meta** — are `architecture.md` §2 and are used here
verbatim. This component introduces a small number of UI-only terms; everything else is canonical.

| Local term | Meaning |
|---|---|
| **Sidebar** | The fixed-width navigation column (the leftmost of the three panes) that lists All/Starred and the Folder→Feed tree, sets the **Selection**, and hosts feed management. |
| **Add form** | The inline form, toggled from the sidebar header, that adds a **Feed** by URL. |
| **Feed row** | One **Feed**'s line in the tree: its health indicator, title, unread count, and a "more" menu. |
| **Feed actions menu** | The per-**Feed-row** overflow ("⋯") menu: Refresh now, Rename, Move to folder, Copy feed URL, Show error, Remove. |
| **Error-details view** | The modal opened from a feed's warning indicator showing its last error and a retry. |
| **Import dialog** | The modal that uploads an OPML file to `POST /api/import` and reports the result. |
| **Collapse state** | Which **Folder**s are visually collapsed in the tree. **Client-only and ephemeral** (§1.4). |

---

## 1. The sidebar tree

The sidebar is the leftmost pane: a fixed-width, vertically self-scrolling navigation column (the
window never scrolls as a whole — `design/design_spec.md` §3). Its appearance (width, position,
color, density, the active-row treatment) and its **collapsibility** — a toolbar control hides it and
reclaims its width, default open (`design/design_spec.md` §3.3, owned there, not here) — are the design
spec's; its **structure, contents, and behavior** are below. Its entire data source is one
`GET /api/feeds` response (`api_contract.md` §4): a list of **Folder** objects (each with its **Feed**s
and an `unread_count`), plus `total_unread` and `total_starred`.

### 1.1 Header

The top of the sidebar carries the **Feedler wordmark** and a single **Add** toggle control. The
toggle opens and closes the inline **Add form** (§2); its label reflects state — it reads **"+ Add"**
when closed and a close affordance (**"×"**) when open. There is no other control in the header.

### 1.2 Top entries — "All articles" and "Starred"

Two fixed entries sit above the Folders section, each rendered with a label and a count:

| Entry | Label | Count shown | **Selection** it sets |
|---|---|---|---|
| All | **"All articles"** | `total_unread` (total unread across all feeds) | `{ kind: "all" }` |
| Starred | **"Starred"** | `total_starred` | `{ kind: "starred" }` |

A count is shown only when it is greater than zero. **Binding:** the Starred entry's count is
`total_starred` — the count of **all** starred **Article**s regardless of read state, not just unread
starred ones (`api_contract.md` §4 defines `total_starred` this way; do not show a starred-and-unread
subset here). The two counts come straight from the `GET /api/feeds` envelope and are not recomputed
client-side.

### 1.3 The Folders section

Below the top entries, a **"Folders"** section heading precedes the tree. For each **Folder** in the
`GET /api/feeds` response, in the order the response gives them, the sidebar renders a **folder row**;
under it (when expanded) the folder's **Feed**s as **Feed rows** (§1.5).

Folder rows:

- A **collapse/expand toggle** (a disclosure caret) precedes the folder. Toggling it flips that one
  folder's **Collapse state** (§1.4); it does not change the **Selection**.
- The **folder name** is clickable and sets the **Selection** to `{ kind: "folder", folder: <name> }`.
- A **per-folder unread count** is shown when greater than zero. It equals the **sum of the unread
  counts of the feeds in that folder** (the server computes `Folder.unread_count` this way —
  `api_contract.md` §4); the UI displays it as given.
- The empty **Folder** (feeds with no folder) appears under the name **"Uncategorized"** — a display
  name the server substitutes for the empty `folder`, never stored (`architecture.md` §2). The UI shows
  whatever folder names the server returns and does not itself invent "Uncategorized".

**Folder order** is the server's: `GET /api/feeds` returns folders already sorted (the sort is owned by
`api_contract.md` §4), and **"Uncategorized"** sorts among the names like any other (it is not pinned to
top or bottom). The UI renders the folders in the order the response gives them and must not re-sort.

### 1.4 Collapse state (client-only, ephemeral)

Folder collapse is **purely client-side and ephemeral**: it lives only in the running view, is **not**
sent to the server, is **not** persisted to `localStorage`, and is reset on reload. Every folder
defaults to **expanded**. This is the one piece of sidebar state that is neither server state nor a
durable client preference — contrast the durable client preferences in `components/settings_spec.md`,
which this is deliberately *not* part of.

### 1.5 Feed rows

Each **Feed row** within an expanded folder shows, left to right:

1. A **health indicator** (§4): a warning indicator when the feed's `last_error` is set, otherwise a
   neutral, non-interactive marker.
2. The **feed title** (`title`), truncated if long; if a feed has no title, its `xml_url` is shown in
   its place.
3. The **per-feed unread count** (`unread_count`), shown only when greater than zero.
4. A **"more" affordance** that opens the **Feed actions menu** (§3). It is revealed on row hover or
   keyboard focus (it need not occupy space when idle) and must be reachable by keyboard.

Clicking the feed row's body sets the **Selection** to
`{ kind: "feed", feedId: <id>, feedTitle: <title> }`. Clicking the warning indicator instead opens the
**Error-details view** (§4) and does **not** change the Selection.

While a per-feed refresh started from this row is in flight, the row's title is shown in a muted/busy
state until the reload completes (§3.1).

### 1.6 Selection & active highlight

The sidebar is the surface that **sets** the **Selection** (the model is defined in
`components/reading_spec.md`; the four kinds are `all`, `starred`, `folder`, `feed` —
`architecture.md` §2). Selecting any entry calls back to the app, which updates the Selection and
re-renders the article list per `reading_spec`. The currently selected entry is rendered in an
**active** style so the operator always sees where they are. Active matching is by kind and identity: a
folder entry is active when the Selection is that folder by name; a feed entry is active when the
Selection is that feed by id; All and Starred match by kind alone.

### 1.7 Reload after a change

Any feed-management action that mutates server state (add, rename, move, remove, refresh-one, import)
triggers a **reload of the sidebar tree** (`GET /api/feeds`) so titles, folder membership, health, and
unread counts reflect the change. The sidebar does not optimistically mutate its own tree; it re-reads
the authoritative envelope. (The owning view performs the reload; the sidebar requests it via its
"changed" callback.)

---

## 2. Add a feed by URL

### 2.1 The form

Toggling **Add** (§1.1) reveals an **inline Add form** within the sidebar (not a modal). Fields:

| Field | Required | Behavior |
|---|---|---|
| **Feed URL** | Yes | The feed's `xml_url`. A URL-type input, autofocused when the form opens. Submit is disabled while it is empty (after trimming). |
| **Folder** | No | A free-text folder name with **autocomplete** offering the operator's **existing folder names** (the names from `GET /api/feeds`, excluding the display-only **"Uncategorized"**). The operator may also type a new folder name. |

The form has **Cancel** (closes it, no request) and **Add** (submits) controls, and a place to show an
inline submit error (§2.3).

### 2.2 Submit → `POST /api/feeds`

On submit, the form sends `POST /api/feeds` (`api_contract.md` §4) with the trimmed `xml_url` and, when
non-empty, the trimmed `folder`; **`title` is omitted** so the server probes for the real title. Per
the contract and `components/ingestion_spec.md`:

- The server **probes** the URL once (fetch + parse, no DB write) to discover the feed's real **title**
  and site link (`html_url`) when no title was supplied; if the probe fails, the title falls back to
  the `xml_url`.
- The feed is **upserted by `xml_url`** — adding an already-subscribed URL updates the existing **Feed**
  (title/folder/html_url) and never creates a duplicate (`architecture.md` §3 invariant 1).
- The server **kicks an immediate background refresh** of the new feed so its **Article**s appear
  without waiting for the scheduler interval (`ingestion_spec`).

On success (`201`) the form clears its fields, closes itself, and the sidebar reloads (§1.7). The new
feed appears in its folder, and its articles populate shortly after as the background refresh lands —
the operator may need a manual or scheduled reload to see the count climb (the refresh is asynchronous;
the `201` returns before it completes).

While the request is in flight, the **Add** control shows a busy state and is disabled.

### 2.3 Submit errors (shown inline)

A failed `POST /api/feeds` shows its message **inline within the form** (the form stays open with the
operator's input intact so they can correct and retry); it is not a modal or a toast. The message is
the server's error text (the `{ "error": "<message>" }` body — `engineering_standard.md` §7), e.g. an
empty URL yields **"xml_url required"** and malformed input yields **"bad json"** (`api_contract.md`
§4). If the client cannot reach the server at all, a generic add-failure message is shown.

### 2.4 Worked example — the add flow end to end (binding)

1. Operator opens **Add**, types `https://blog.cloudflare.com/rss/` in **Feed URL**, leaves **Folder**
   empty, presses **Add**.
2. Client sends `POST /api/feeds` with body `{ "xml_url": "https://blog.cloudflare.com/rss/" }` (no
   `title`, no `folder`).
3. Server probes the URL, discovers the title `"The Cloudflare Blog"` and `html_url`
   `"https://blog.cloudflare.com"`, upserts the row, returns
   `201 { "id": 31, "title": "The Cloudflare Blog", "folder": "" }`, and starts a background refresh of
   feed 31.
4. Client clears and closes the form and reloads `GET /api/feeds`. Feed 31 now appears under
   **"Uncategorized"** titled **"The Cloudflare Blog"**. Moments later its articles arrive; the next
   tree reload shows its unread count.
5. **Re-adding the same URL** with `Folder` = `News` sends
   `{ "xml_url": "https://blog.cloudflare.com/rss/", "folder": "News" }`; the server **updates** feed 31
   (now in **"News"**) and returns `201` — no second Cloudflare feed exists (invariant 1).

---

## 3. Per-feed actions (the "more" menu)

The **Feed actions menu** opens from a **Feed row**'s "more" affordance and offers the actions below.
The menu closes when the operator picks an item or clicks outside it. Each action operates on **that
one feed**.

| Action | What it does | Endpoint (per `api_contract.md` §4) |
|---|---|---|
| **Refresh now** | Refreshes just this feed (§3.1). | `POST /api/feeds/{id}/refresh` |
| **Rename** | Prompts for a new title and PATCHes it (§3.2). | `PATCH /api/feeds/{id}` `{ "title": … }` |
| **Move to folder** | Prompts for a folder name and PATCHes it; empty uncategorizes (§3.3). | `PATCH /api/feeds/{id}` `{ "folder": … }` |
| **Copy feed URL** | Copies the feed's `xml_url` to the clipboard (§3.4). | none (client only) |
| **Show error** | Opens the **Error-details view** (§4). Shown **only when the feed has a `last_error`**. | none (opens §4) |
| **Remove** | Confirms, then deletes the feed and its articles (§3.5). | `DELETE /api/feeds/{id}` |

**Remove** is visually separated and styled as a destructive action; **Show error** appears only for an
errored feed. After any action that mutates server state, the sidebar reloads (§1.7).

### 3.1 Refresh now

Refreshes only this feed via `POST /api/feeds/{id}/refresh` (synchronous on the server — it returns
`200 { "new_articles": <int> }` after the fetch, or `500 {error}` on upstream/parse failure, recording
the feed's `last_error` — `api_contract.md` §4; the fetch mechanics are `ingestion_spec`'s). During the
request the row shows a busy state (§1.5); afterward the sidebar reloads, so a now-healthy feed loses
its warning indicator and a now-errored feed gains one. The client does not surface the
`new_articles` count from this action (the new articles simply appear in the list on the next list
fetch / tree reload).

### 3.2 Rename

Prompts the operator for a new **title**, pre-filled with the current title. The operator may **cancel**
(no request). If the entered title, trimmed, is empty **or unchanged** from the current title, no
request is sent. Otherwise the client sends `PATCH /api/feeds/{id}` with `{ "title": "<new title>" }`
(the server trims it — `api_contract.md` §4). The sidebar reloads and shows the new title.

### 3.3 Move to folder

Prompts the operator for a folder name, **pre-filled with the feed's current `folder`** and showing the
list of **existing folder names** (the names from `GET /api/feeds`, excluding **"Uncategorized"**) for
reference. The operator may **cancel** (no request). Otherwise the client sends `PATCH /api/feeds/{id}`
with `{ "folder": "<trimmed input>" }`.

**Binding — uncategorize on empty:** submitting an **empty** folder (the operator clears the field and
confirms) sends `{ "folder": "" }`, which moves the feed to the empty folder — i.e. it appears under
**"Uncategorized"** thereafter (`architecture.md` §2; `api_contract.md` §4: `folder ""` = uncategorize).
Cancelling the prompt is distinct from clearing it: cancel sends nothing; clear-and-confirm
uncategorizes. Typing a folder name that does not yet exist creates that grouping (a **Folder** is just
a label on the feed — `architecture.md` §2); the new folder appears in the tree after reload.

### 3.4 Copy feed URL

Copies the feed's `xml_url` to the system clipboard. No server request; nothing else changes.

### 3.5 Remove

Asks for **confirmation** that warns the feed's **stored articles will be deleted**, then sends
`DELETE /api/feeds/{id}`. Deletion **cascades**: removing the feed deletes all of its **Article**s
(`architecture.md` §3 invariant 3, `ON DELETE CASCADE`), leaving no orphan rows. On success
(`200 { "status": "deleted" }`) the sidebar reloads and the feed is gone. If the removed feed was the
current **Selection**, the resulting empty/redirected view is handled per `components/reading_spec.md`.

The confirmation text must state that the feed's stored articles for this feed will be deleted, so the
operator understands removal is destructive (not merely an unsubscribe that keeps history). See §7 for
an open question about the article-count wording in the current implementation.

---

## 4. Feed error surfacing + retry

A feed's health is its **`last_error`** field: set on a failed refresh, cleared (`NULL`/empty) on any
success or `304` (`architecture.md` §3 invariant 6; the fetcher sets/clears it — `ingestion_spec`). The
UI surfaces this so the operator's "a feed 404'd — let me see why and retry it" loop is one or two
clicks.

### 4.1 Inline indicator

A **Feed row** for a feed whose `last_error` is non-empty shows a **warning indicator** in place of the
neutral marker (§1.5). The indicator is the affordance to open the **Error-details view**; clicking it
opens that view and does not change the **Selection**. (A summary of the error is also available on
hover of the feed row, but the canonical detail is the Error-details view.)

### 4.2 Error-details view

Opened from the warning indicator or the menu's **Show error** item, this is a modal dialog presenting:

| Element | Source | Notes |
|---|---|---|
| **Feed title** | `title` | identifies the feed. |
| **Feed URL** | `xml_url` | rendered as an external link that opens in a new tab with `rel="noopener noreferrer"` (`architecture.md` §5 P6). |
| **Last error** | `last_error` | the full error text, shown verbatim (it may be multi-line). |
| **Last fetched** | `last_fetched_at` | the time of the last fetch attempt, shown in the operator's local time; omitted when the feed has never been fetched. |
| **Retry now** | — | re-refreshes just this feed (§4.3). |
| **Close** | — | dismisses the dialog; `Escape` and clicking the backdrop also close it. |

### 4.3 Retry now

**Retry now** re-runs the same single-feed refresh as §3.1 (`POST /api/feeds/{id}/refresh`) and then
closes the dialog. On a successful retry the server clears `last_error`; the operator confirms the fix
by observing that the feed's warning indicator is gone after the tree reflects the change. See §7 — in
the current implementation the retry from this dialog does not itself force a sidebar reload, so the
indicator may not update until the next tree reload (an open question to reconcile).

---

## 5. OPML import dialog (UI)

This component owns the **dialog UX**; the OPML parse/import/upsert/seed mechanics are
`components/ingestion_spec.md`'s and the request contract is `api_contract.md` §6.

The **Import dialog** is a modal that lets the operator bring in feeds from an OPML file:

- **File picker** accepting an `.opml` or `.xml` file (the dialog should also note, or the operator
  should know, that the server additionally accepts a **raw OPML body** as the request — `api_contract.md`
  §6 — though the dialog itself uploads a file).
- **Explanatory copy** stating that **same-URL feeds are updated, not duplicated** (upsert by `xml_url`
  — `architecture.md` §3 invariant 1) — e.g. an OPML exported from Reeder, Feedly, or NetNewsWire can
  be re-imported safely.
- **Import** and **Close** controls; `Escape` and the backdrop close the dialog.

On import the dialog sends `POST /api/import` as `multipart/form-data` with a **`file`** field
(`api_contract.md` §6). On success (`200`) it shows the **result counts** — **inserted**, **updated**,
**skipped** — and states that a **background refresh of all feeds is starting** (the server kicks it
after responding — `ingestion_spec`). The owning view reloads the sidebar so imported feeds appear.

**Errors:** a bad/unparseable OPML returns `400 {error}` and a missing file field returns
`400 "missing 'file' field"` (`api_contract.md` §6); the dialog shows the server's error message and
stays open for a retry. While importing, the **Import** control shows a busy state and is disabled.

**Result message — worked example (binding):** for `200 { "inserted": 12, "updated": 3, "skipped": 1 }`
the dialog reports that the import inserted 12, updated 3, and skipped 1, and that a refresh is starting
in the background.

---

## 6. Unread counts

The sidebar's counts all originate from the **single `GET /api/feeds` envelope** (`api_contract.md` §4):

| Count | Source field | Meaning |
|---|---|---|
| **All articles** | `total_unread` | total unread across all feeds. |
| **Starred** | `total_starred` | count of all starred articles (read or unread). |
| **Per-folder** | `Folder.unread_count` | sum of the folder's feeds' unread counts. |
| **Per-feed** | `Feed.unread_count` | that feed's unread article count. |

The UI **does not compute** these; it renders what the server returns. They become stale only until the
next tree reload, which happens after every refresh and after every feed-management mutation (§1.7), and
which the owning view also triggers after **read/unread/mark-all-read** and **refresh** actions so the
counts stay truthful (the read/star actions themselves and their reload triggers are
`components/reading_spec.md`'s). Honest, never-stale-after-an-action counts are a product promise
(`vision.md` §5.4, §6).

---

## 7. Risk & failure considerations / open questions

- **Remove is destructive and irreversible.** Deleting a feed cascades its **Article**s away
  (`architecture.md` §3 invariant 3); there is no undo. The confirmation prompt is the only guard, so it
  must clearly say the stored articles will be deleted. **Open question:** the current implementation's
  confirmation message states a count based on the feed's **unread** count (phrased as "N+ stored
  articles"), which under-reports the true number of articles deleted (read articles are not counted).
  This is honest-about-state-adjacent (`vision.md` §6) and should be reconciled — either count all
  stored articles for the feed or word the warning so it does not imply a precise total.
- **Retry from the Error-details view may not refresh the indicator.** §4.3 — in the current
  implementation, retrying from the dialog refreshes the feed and closes the dialog but does not itself
  force a sidebar tree reload, so a now-healthy feed can keep showing its warning indicator until the
  next reload. The intended behavior is that a successful retry visibly clears the indicator; reconcile
  so the retry triggers the same reload that the menu's **Refresh now** does (§1.7, §3.1).
- **Collapse state is intentionally non-durable.** §1.4 — losing it on reload is by design, not a bug;
  do not "fix" it by persisting it (that would make it a setting, which `settings_spec` does not claim).
- **Clipboard access may be denied.** §3.4 — **Copy feed URL** depends on the browser clipboard API,
  which can fail in insecure contexts; the action should fail visibly rather than silently if the
  platform refuses (honesty — `start.md` §0).
- **Add and import kick background refreshes.** The `201`/`200` returns before articles land; the UI
  must not imply the feed is fully populated at that instant (§2.2, §5). Politeness and the actual fetch
  bounds are `ingestion_spec`'s / `engineering_standard.md` §6's concern.

---

## 8. Acceptance Criteria

1. The sidebar renders, from one `GET /api/feeds`: the **Feedler** wordmark + an **Add** toggle; **"All
   articles"** (count = `total_unread`) and **"Starred"** (count = `total_starred`); a **"Folders"**
   section listing each folder in server order, each collapsible with a per-folder unread count, and
   under each its feeds with per-feed unread counts; the empty folder shown as **"Uncategorized"**.
   Counts ≤ 0 are not shown.
2. Selecting All / Starred / a folder / a feed sets the corresponding **Selection** and the chosen entry
   is shown active. Collapse/expand toggles a folder without changing the Selection and is **ephemeral**
   (lost on reload; never persisted).
3. The **Add form** adds a feed by URL: required URL, optional folder with autocomplete from existing
   folder names; submit sends `POST /api/feeds` with no `title`; the server probes the title and starts
   a background refresh; success clears+closes the form and reloads the tree; errors show inline and the
   form stays open. The worked example in §2.4 holds, including idempotent re-add (no duplicate).
4. The per-feed menu offers **Refresh now**, **Rename**, **Move to folder**, **Copy feed URL**, **Show
   error** (only when errored), and **Remove**, each acting on that one feed via the §3 endpoints.
   Rename pre-fills and no-ops on empty/unchanged; Move pre-fills the current folder and **uncategorizes
   on empty input** while **cancel sends nothing**; Remove confirms (warning of article deletion),
   DELETEs, cascades, and reloads.
5. A feed with a non-empty `last_error` shows a **warning indicator** inline; opening it shows the
   **Error-details view** with the title, the `xml_url` as a safe external link, the `last_error` text,
   the `last_fetched_at` time, and a **Retry now** that re-refreshes just that feed. A healthy feed shows
   no warning.
6. The **Import dialog** uploads an `.opml`/`.xml` file to `POST /api/import` (multipart `file`), states
   that same-URL feeds are updated not duplicated, shows the **inserted/updated/skipped** result and that
   a background refresh starts, and surfaces import errors inline. §5's worked result message holds.
7. All sidebar counts come from `GET /api/feeds` and are refreshed after refresh, read, and
   feed-management actions; the UI never recomputes them.
8. Every external link in the error view opens in a new tab with `rel="noopener noreferrer"`
   (`architecture.md` §5 P6).

## 9. Deliverables checklist

- [ ] Sidebar (leftmost fixed-width pane, self-scrolling): **Feedler** wordmark + **Add** toggle
      ("+ Add" / close) (§1.1).
- [ ] **"All articles"** (count `total_unread`) and **"Starred"** (count `total_starred`) entries that
      set the `all` / `starred` **Selection** (§1.2).
- [ ] **"Folders"** section: server-ordered folders, each collapsible with a per-folder unread count,
      feeds nested under each with per-feed counts; empty folder shown as **"Uncategorized"** (§1.3).
- [ ] Folder **Collapse state** that is client-only, ephemeral, default-expanded, never persisted (§1.4).
- [ ] **Feed rows**: health indicator, title (or `xml_url` fallback), unread count, "more" affordance;
      body click sets the `feed` **Selection**; busy state during single-feed refresh (§1.5).
- [ ] Active-entry highlight by kind+identity; selecting sets the **Selection** per `reading_spec` (§1.6).
- [ ] Tree reload after every mutating action (add/rename/move/remove/refresh-one/import) (§1.7).
- [ ] **Add form**: required URL, optional folder with existing-folder autocomplete, `POST /api/feeds`
      without `title`, success clears+closes+reloads, inline errors, busy state (§2).
- [ ] **Feed actions menu**: Refresh now, Rename, Move to folder, Copy feed URL, Show error (errored
      only), Remove (destructive, separated); closes on pick/outside-click (§3).
- [ ] **Rename** (pre-fill, no-op on empty/unchanged → `PATCH title`) (§3.2).
- [ ] **Move to folder** (pre-fill current folder, list existing; empty → uncategorize, cancel → no-op →
      `PATCH folder`) (§3.3).
- [ ] **Copy feed URL** to clipboard (§3.4).
- [ ] **Remove** with destructive confirmation → `DELETE`, cascading articles (§3.5).
- [ ] **Inline warning indicator** on errored feeds; **Error-details view** with title, `xml_url` link,
      `last_error`, `last_fetched_at`, **Retry now**, Close/Escape/backdrop (§4).
- [ ] **Import dialog**: `.opml`/`.xml` file picker, upsert-not-duplicate copy, `POST /api/import`
      multipart, inserted/updated/skipped result + background-refresh note, inline errors, busy state (§5).
- [ ] Unread counts sourced from `GET /api/feeds`, refreshed after refresh/read/management actions (§6).
- [ ] §7 open questions tracked (remove-confirmation article count; retry-from-dialog reload).
