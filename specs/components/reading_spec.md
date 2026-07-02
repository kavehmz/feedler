# Feedler — Reading — list, reading pane, read/star, read-on-scroll, filter/search, selection, shortcuts, deep-link

**Status:** Component WHAT. **Read `architecture.md` (§2 glossary, §3 data model) and
`standards/api_contract.md` (§5 articles, §7 deep-link) first.**
**Scope:** the whole reading & triage experience — the middle and right panes of the three-pane
reader and the toolbar that drives them. This is the largest component spec.

This spec owns the **Selection** model (referenced by `architecture.md` §2), the **Filter**, search,
the article list, read/unread, star, read-on-scroll, mark-all-read, the reading pane (Feed-content vs
Read-full-article), the toolbar, the deep-link, and the keyboard shortcuts. It does **not** own: the
sidebar tree and feed CRUD (`feed_management_spec.md`), the export dialog (`export_spec.md`), the
import dialog (`feed_management_spec.md` / `ingestion_spec.md`), the settings dialog and the storage
of settings/theme (`settings_spec.md`), or visual styling/palette (`design/design_spec.md`).

The reader is deliberately conventional — a Reeder-style three-pane list with `j`/`k` navigation, an
unread dot, and read-on-scroll. Familiarity is the feature (`vision.md` §6). Trustworthy "already
read" is the load-bearing promise: counts must never lie and must update the moment the operator
acts (`vision.md` §5.4).

---

## 1. Glossary (this spec adds none)

All terms are `architecture.md` §2 verbatim: **Feed**, **Folder**, **Article**, **GUID**,
**Summary**, **Content**, **Full content**, **Read / Unread**, **Starred**, **Refresh**, **Scope**,
**Selection**, **Range**, **Filter**, **Deep-link**, **Meta**. Where this spec needs to name a
control or state it does so in prose; it introduces no new canonical term.

Two terms are defined in full here because `architecture.md` §2 delegates their behavior to this spec:

- **Selection** — what view the operator has chosen. Exactly one of: **All** (every article),
  **Starred** (starred articles), a **Folder** (one folder's feeds), or a **Feed** (one feed). The
  Selection is owned by the sidebar (`feed_management_spec.md`) and consumed here; this spec defines
  what changing it does to the list and pane (§2).
- **Filter** — the read-state narrowing of the list. The toolbar exposes three: **unread**, **all**,
  **starred**. The wire contract also accepts **read** (`api_contract.md` §5), but **read** is not a
  toolbar control — it is reachable only through the export (`export_spec.md`).

---

## 2. The Selection model (binding)

The Selection is the primary axis of "what am I looking at". Its four kinds and their effect on the
article list query (`api_contract.md` §5 `GET /api/articles`) are:

| Selection kind | List query effect | List header title |
|---|---|---|
| **All** | no `feed`, no `folder`; Filter governs read-state | `All articles` |
| **Starred** | forces the `starred` filter regardless of the toolbar Filter | `Starred` |
| **Folder** | `folder=<folder name>` (the empty name matches Uncategorized feeds) | the folder name |
| **Feed** | `feed=<feed id>` | the feed's title, or `Feed #<id>` if the title is unknown |

**Binding behaviors:**

1. **Switching Selection reloads the list and clears the open article.** Choosing any sidebar entry
   replaces the list with that Selection's articles and deselects whatever article was open, so the
   reading pane returns to its empty state. (The operator never lands on a stale open article that is
   not in the new list.)
2. **A Starred Selection forces the starred Filter.** While Starred is selected, the list shows
   starred articles irrespective of which Filter pill is lit; the toolbar pills still render but the
   list query sends `filter=starred`. (`api_contract.md` §5.)
3. **Folder and Feed Selections combine with the Filter.** A feed under the `unread` filter shows
   that feed's unread articles; the same feed under `all` shows all of its articles.
4. The Selection also **seeds the export Scope** (`architecture.md` §2; the mapping itself is
   `export_spec.md`'s) — this spec only passes the current Selection to the export dialog when it
   opens.

The list always requests a generous page (the largest reasonable page within the `limit ≤ 200` cap
of `api_contract.md` §5) and renders all returned rows; there is no incremental "load more" control.
The header's count (§4) reflects the returned rows against the total match, so the operator can see
when the view is larger than the page.

---

## 3. The Filter and search

### 3.1 Filter

Three pills in the toolbar, exactly one active at a time:

| Pill | Sends | Shows |
|---|---|---|
| **Unread** | `filter=unread` (read-state = unread) | unread articles in the Selection |
| **All** | no `filter` param (the list is unfiltered by read-state) | every article in the Selection |
| **Starred** | `filter=starred` | starred articles in the Selection |

- The **Unread** pill's label carries the **total unread count** in parentheses — the count from the
  feeds endpoint (`api_contract.md` §4 `total_unread`), i.e. the whole-app unread total, not the
  current Selection's. When the total is zero the parenthetical is omitted (the label is just
  `Unread`).
- **Default Filter on load** comes from settings (`settings_spec.md`, the `defaultFilter`
  preference). The reader opens with that Filter active.
- A **Starred Selection overrides the Filter** for the query (§2.2). Switching the Filter pill while
  Starred is selected has no effect on the list until the Selection changes.
- **`read` is not a toolbar Filter.** It is a valid `api_contract.md` §5 value but is surfaced only
  in the export (`export_spec.md`).

### 3.2 Search

A single live text box in the toolbar.

- Typing issues an `/api/articles` request with `search=<query>` (`api_contract.md` §5). The match is
  **server-side, case-insensitive, against the article title OR its Summary** (substring) — the
  client does no local filtering.
- Search **combines** with the current Selection and Filter (e.g. `unread` + a folder + `search=tls`
  returns unread articles in that folder whose title or Summary contains `tls`).
- An empty search box sends no `search` param (the full Selection is shown).
- The box is **focused by the `/` shortcut** (§9) and its placeholder advertises that hint.
- The box has no submit button and no debounce contract beyond "the list reflects the current query";
  clearing the box restores the unsearched list.

---

## 4. The article list (middle pane)

### 4.1 Ordering and contents

- **Ordering is newest-first by `COALESCE(published_at, fetched_at) DESC`** — the binding ordering
  invariant (`architecture.md` §3 invariant 4). Items without a publish date sort by when Feedler
  first saw them. The client renders rows in the order the endpoint returns them and does not
  re-sort.
- Each row is the **lightweight Article** shape (`api_contract.md` §1 — no `content`/`full_content`).

### 4.2 The sticky header

A header pinned to the top of the list shows, on one line:

- left: the **Selection title** (§2 table), truncated if long;
- right: an **"N of M" count** where `N` is the number of rows currently rendered and `M` is the
  `total` match for the Selection+Filter+search (`api_contract.md` §5 `total`). While the list is
  loading, the right side reads `loading…` instead.

**Binding example:** a feed with 250 matching unread articles, page size 100 → the header reads the
feed's title on the left and `100 of 250` on the right.

### 4.3 Loading and empty states

- **Loading:** the header count shows `loading…`; the previously rendered rows may remain visible
  until the new set arrives (the list does not blank to nothing on every keystroke).
- **Empty (loaded, zero rows):** a centered message — `No articles to show. Try changing the filter
  or refreshing.` — invites the operator to widen the Filter or Refresh.

### 4.4 A row

Each row shows:

- an **unread dot** at the leading edge, present only while the article is Unread (it disappears the
  moment the article becomes Read);
- the **Feed title** (small, dimmed, truncated);
- a **relative timestamp** (right-aligned) computed from `published_at` else `fetched_at` (§4.5);
- the **article title** — rendered bold/emphasized while Unread and visually **dimmed once Read**;
  an empty title renders as `(untitled)`;
- in **comfortable** density only: a **2-line Summary excerpt** (the plain-text Summary, clamped to
  two lines). In **compact** density the excerpt is **hidden**;
- a **star toggle** at the trailing edge (§6) — a filled star when Starred, an outline star
  otherwise; clicking it toggles the star without selecting/opening the row.

**Density** comes from settings (`settings_spec.md`, the `density` preference: `comfortable` |
`compact`). Comfortable shows the excerpt and roomier spacing; compact drops the excerpt and tightens
spacing. Density never changes ordering or which rows appear — only their height and whether the
excerpt is shown.

**Clicking a row body** selects and opens that article (§5, §6.1). **Clicking the star** toggles the
star only (it must not open the article).

### 4.5 Relative timestamp format (binding)

Given the row's effective time `t = published_at ?? fetched_at` and "now":

| Age of `t` | Output |
|---|---|
| `< 60s` | `now` |
| `< 60m` | `<m>m` (whole minutes) |
| `< 24h` | `<h>h` (whole hours) |
| `< 7d` | `<d>d` (whole days) |
| `≥ 7d`, same calendar year as now | short month + day in the browser locale (e.g. `Jun 3`) |
| `≥ 7d`, a different year | 2-digit year + short month + day in the browser locale (e.g. `Dec 14, 25`) |
| missing/unparseable | empty string |

**Binding examples** (now = 2026-06-30): a `t` 40 seconds ago → `now`; 5 minutes ago → `5m`; 3 hours
ago → `3h`; 2 days ago → `2d`; `2026-06-03` → `Jun 3`; `2025-12-14` → `Dec 14, 25`. The month/day
rendering follows the browser locale, so the exact separators may vary by locale; the **buckets and
their boundaries are binding**, the locale formatting is not.

### 4.6 Selected-row visibility

When an article becomes selected (by click or by `j`/`k`), its row is **scrolled into view** within
the list (nearest-edge, so an already-visible row does not jump). This keeps keyboard navigation from
walking the selection off-screen.

---

## 5. Read state

Read/Unread is the reader's primary state and must be correct, immediate, and durable
(`vision.md` §5.4). Counts are authoritative from the feeds endpoint (`api_contract.md` §4) and are
reloaded after every mutation.

### 5.1 Open marks read

Opening (selecting) an **Unread** article:

1. **selects it immediately** — the row is highlighted and the pane begins loading it (§7) at once,
   independent of the read-mark below;
2. calls `POST /api/articles/{id}/read` (`api_contract.md` §5);
3. once that call resolves, flips the row to Read in the list (the dot disappears, the title dims);
4. then **reloads the feeds endpoint** so the sidebar and the toolbar's `Unread (N)` count decrement.

The **selection** is instant; the **read-state flip and the count refresh follow the read call's
completion** (they are not applied speculatively before the server confirms). The mark covers exactly
the opened article. Opening an already-Read article does not call the endpoint and does not reload
counts (it only selects). (Read-on-scroll, by contrast, flips the row and refreshes counts
*optimistically* the instant it fires the read call — §6.3.)

### 5.2 Per-article read/unread toggle

The reading pane (§7) and the `m` shortcut (§9) toggle the selected article's read state:

- Read → Unread calls `POST /api/articles/{id}/unread`; Unread → Read calls
  `POST /api/articles/{id}/read` (`api_contract.md` §5).
- The list row updates to the new state and the feeds endpoint is reloaded so counts stay truthful.

### 5.3 Count freshness invariant

After **any** read-state change — open, toggle, read-on-scroll (§6.3), or mark-all-read (§6.4) — the
unread counts shown anywhere (sidebar, the `Unread (N)` pill) reflect the new truth. Counts are never
stale after an action (`vision.md` §5.4, §8). The client achieves this by reloading
`GET /api/feeds` after the mutation; it does not locally guess counts.

---

## 6. Star, read-on-scroll, mark-all-read

### 6.1 Star

The article's **Starred** flag (`architecture.md` §2) is toggled from two places:

- the **star toggle on each list row** (§4.4);
- the **star control in the reading pane** (§7.4).

Both call `POST /api/articles/{id}/star` (`api_contract.md` §5), which toggles server-side and returns
the new `is_starred`. The client applies the returned value to the row/pane. Starring is independent
of read state and is never auto-set.

### 6.2 (reserved)

### 6.3 Read-on-scroll (optional, tunable)

Read-on-scroll auto-marks Unread articles Read as the operator scrolls past them. It is **switchable
on/off and tunable** — on by default but fully disengageable, never forced (`vision.md` §5.4). Its two
knobs live in `settings_spec.md` §2: `autoMarkOnScroll` (the on/off, default on) and `autoMarkDelayMs`
(the delay in milliseconds, default 700).

Specified as **observable behavior** (the WHAT), not the detection mechanism:

1. **Trigger:** an **Unread** row that scrolls off the **top** of the list — its bottom edge passes
   above the top edge of the list's scroll container — becomes a candidate to be marked Read.
2. **Delay:** the candidate is actually marked Read only after the configured delay elapses while it
   remains scrolled off the top.
3. **Cancellation:** if the row scrolls **back into view** before the delay elapses, the pending mark
   is **cancelled** and the article stays Unread.
4. **At most once:** each article is auto-marked **at most once** per loaded set; once auto-marked it
   is not re-evaluated.
5. **Direction matters:** only scrolling **off the top** triggers it. A row that is below the fold
   (not yet scrolled past) or that leaves the bottom of the container is never auto-marked.
6. **Read-state only:** only **Unread** rows are candidates; already-Read rows are ignored.
7. **Reset on context change:** the at-most-once tracking and all pending timers are **reset when the
   Selection changes or the article set changes** (e.g. a Filter switch, a search, or a Refresh that
   replaces the list). After a reset, articles in the new set are eligible again.

When an article is auto-marked: it calls `POST /api/articles/{id}/read` and — *optimistically, without
waiting for that call* (unlike the open path, §5.1) — flips the row to Read and reloads the feeds
endpoint at once (§5.3). If the mark request fails, the at-most-once guard is released so a later
scroll can retry.

When read-on-scroll is **off** (`settings_spec.md`), none of the above happens — scrolling never
changes read state.

**Binding example:** read-on-scroll on, delay = 2s. The operator scrolls an Unread row off the top
and keeps scrolling → after 2s the row is marked Read and the unread count drops. If instead they
scroll back up within 2s, the row stays Unread.

### 6.4 Mark all read in scope

A toolbar action (`✓ Mark all read`) and the **Shift+M** shortcut (§9) mark every Unread article in
the **current Selection's scope** as Read.

1. The action **first asks for confirmation** (a confirm prompt). On cancel, nothing happens.
2. On confirm, it calls `POST /api/articles/mark-all-read` (`api_contract.md` §5) with the body
   mapped from the Selection:

   | Selection kind | mark-all-read body | Effect |
   |---|---|---|
   | **Feed** | `{ "feed_id": <id> }` | that feed only |
   | **Folder** | `{ "folder": "<name>" }` (`""` = Uncategorized) | that folder's feeds |
   | **All** | `{}` | every feed (whole app) |
   | **Starred** | `{}` | every feed (whole app) — see open question (§11) |

3. After it returns, the list and the feeds endpoint are **both reloaded** so the now-read articles
   leave the unread view and all counts update.

**Scope mapping is binding** (`api_contract.md` §5: `feed_id` over `folder` over `{}`); the mark
covers only Unread rows in that scope. The confirmation prompt's exact wording is implementation
detail, but a confirmation step before a bulk read-mark is **binding** (it is destructive of unread
state).

---

## 7. The reading pane (right pane)

### 7.1 Empty state

When **no article is selected**, the pane shows a centered empty state inviting the operator to pick
an article from the list and hinting that `?` opens the keyboard-shortcuts help. (The Selection
clearing on a sidebar change, §2.1, returns the pane to this state.)

### 7.2 Loading the selected article

The pane's subject is the **list row that is currently selected** — the selected article id resolved
against the loaded list. When a row is selected, the pane **refetches the full single-article record**
via `GET /api/articles/{id}` (`api_contract.md` §5), which carries the full **Content** and any cached
**Full content** (the list row only had Summary). Until that record arrives the pane renders from the
lightweight row it already has; once it arrives the fuller record is used.

**On switching to a different article**, the pane **resets to Feed-content mode** (§7.3) and
discards any previously fetched Full content / error before loading the new record.

**Selection that resolves to no loaded row keeps the pane empty (binding).** Because the pane's
subject is resolved against the loaded list, a selected article id that is **not present in the
current list page** leaves the pane in its empty state (§7.1) — the pane does not fetch a record for
an id that has no row in the list. This is the case the **Deep-link** must contend with (§10): a
deep-linked article only opens in the pane when its row is in the loaded list under the forced `all`
Filter; otherwise the pane stays empty until the operator navigates to a Selection that surfaces it.

### 7.3 The header and the two-way content toggle

The pane header shows, for the selected article:

- a **kicker** line: `Folder · Feed title` when the article has a folder, else just the Feed title;
- the **article title** (large; `(untitled)` if empty);
- a meta line with: the **author** (`by <author>`) when present; the **published date** rendered in
  the browser locale (full date-time) when present; and a **"View original ↗"** link to the
  article's `link` that **opens in a new tab** (`target="_blank"`, `rel="noopener noreferrer"`).

Below the header, two mutually-exclusive content modes:

- **Feed content** — the article's feed-provided **Content** (falling back to its Summary when
  Content is absent), rendered as sanitized HTML. This is the default mode.
- **Read full article** — the readability-extracted **Full content** of the origin page. It is
  fetched **on demand**:
  - if the article record already carries cached `full_content`, that is shown immediately;
  - otherwise the pane calls `GET /api/articles/{id}/full` (`api_contract.md` §5), which extracts and
    **caches** the Full content server-side and returns the HTML. While fetching, the toggle shows a
    **loading** affordance (e.g. `Fetching…`) and is disabled;
  - on failure (the endpoint returns `502`, `api_contract.md` §5), an **error state** is shown
    (a message that fetching the full article failed) and the mode does not switch.

The two controls are a toggle: the active mode is visually marked; switching back to **Feed content**
is instant and does not refetch.

### 7.4 Read/unread and star controls

The pane header also carries:

- a **mark read / mark unread** control reflecting and toggling the current read state (§5.2);
- a **star / unstar** control reflecting and toggling the current Starred state (§6.1).

Both update the pane and the corresponding list row and reload counts where read state changed.

### 7.5 HTML sanitization and external-link hardening (binding — `engineering_standard.md` §6)

**All rendered article HTML — both Feed-content and Read-full-article — is untrusted and MUST be
sanitized on the client before insertion into the DOM**, and **every link inside that rendered HTML
opens in a new tab with `rel="noopener noreferrer"` (and `target="_blank"`)**
(`engineering_standard.md` §6.1 / §6.2; `architecture.md` §5 principle 6). This applies to:

- the Feed-content HTML (Content or its Summary fallback);
- the Read-full-article HTML returned by `GET /api/articles/{id}/full`.

No raw feed/readability HTML is ever inserted unsanitized. A feed must never be able to run script in
the reader or hijack the SPA via a link target. This is non-negotiable and is the component's primary
risk (§10). The **"View original"** link in the header (§7.3) is likewise `target="_blank"` +
`noopener` because it points at an untrusted origin.

---

## 8. The toolbar

A single horizontal bar above the list+pane, left-to-right:

| Control | Behavior | Owning spec for details |
|---|---|---|
| **Sidebar toggle** | shows/hides the sidebar pane | this spec (toggle) / `feed_management_spec.md` (the sidebar) |
| **Refresh all** | triggers a background all-feeds Refresh, shows a spinner, polls status, then reloads (§8.1) | `ingestion_spec.md` (the refresh itself) |
| **Filter pills** | Unread / All / Starred (§3.1); Unread carries the total unread count | this spec |
| **Search box** | live title/Summary search (§3.2); `/`-focusable | this spec |
| **Mark all read** | confirm, then mark-all-read in scope (§6.4) | this spec |
| **Export** | opens the export dialog seeded from the Selection | `export_spec.md` |
| **Import** | opens the OPML import dialog | `feed_management_spec.md` / `ingestion_spec.md` |
| **Theme toggle** | flips light/dark | `settings_spec.md` (owns persistence) |
| **Settings** | opens the settings dialog | `settings_spec.md` |
| **UTC clock** | a persistent, always-visible, **non-interactive** readout of the current date-time in **UTC**, live-updating each second (§8.3) | this spec |

### 8.1 Refresh-all flow (binding observable behavior)

On clicking **Refresh all** (or pressing `r`, §9):

1. the control enters a busy state (a spinner; the label reads `Refreshing…`) and is disabled to
   prevent re-entry;
2. it calls `POST /api/feeds/refresh`, which returns immediately (`202`, the work runs in the
   background — `api_contract.md` §4);
3. it then **polls `GET /api/feeds/refresh-status`** (`api_contract.md` §4) until the most-recent run
   has finished (its `finished_at` is at/after the moment the refresh was kicked), bounded by a
   sensible overall timeout so the spinner cannot hang forever;
4. when the run finishes (or the timeout elapses), it **reloads the feeds endpoint and the article
   list** so new articles and updated counts appear, and clears the busy state.

The refresh's fetch behavior, conditional GET, dedup, and per-feed errors are `ingestion_spec.md`'s;
this spec owns only the toolbar affordance and the poll-then-reload sequence.

### 8.2 Theme toggle

The toolbar's theme button flips between light and dark. **Persistence and the system-default
behavior are owned by `settings_spec.md`** (the theme preference); this spec only states that the
toolbar exposes a toggle and that toggling takes effect immediately.

### 8.3 The UTC clock (binding)

The toolbar carries a **persistent, always-visible clock** showing the current time in **UTC** — a
non-interactive readout, never a control. It exists so the operator always has on screen the frame
Feedler stores and reports time in: article timestamps and a feed's `last_fetched_at` are stored in
UTC (`architecture.md` §3 invariant 5), and the export's `generated` stamp is the server's UTC
(`export_spec.md` §6.1). A fixed UTC anchor keeps the reader **honest about state** (`vision.md` §6)
and lets the operator reason about the export's day boundaries — which are drawn in *their own*
timezone (`export_spec.md` §4) — against a stable reference.

- **Format (binding):** the current instant rendered as the ISO-style calendar date, a single space,
  the 24-hour time to the **second**, then the literal ` UTC` suffix — `YYYY-MM-DD HH:MM:SS UTC`.
  **Worked example (binding):** at the instant `2026-07-02T14:23:45Z` the clock reads
  `2026-07-02 14:23:45 UTC`.
- **Cadence:** it updates **once per second** so the seconds tick live.
- **Source:** it is derived from the **browser clock rendered in UTC** — no server round-trip and no
  API call. It shows UTC regardless of the operator's local timezone or the active theme (a skewed
  host clock shows skewed, exactly as any client clock would; this is the browser's UTC, stated
  plainly rather than silently server-synced).
- **Placement:** it sits at the **trailing (right) end** of the toolbar, after the settings control.
  Because the toolbar is always on screen (it is never hidden — only the sidebar collapses,
  `design/design_spec.md` §3.3), the clock is always visible. Its appearance (muted, tabular figures)
  is `design/design_spec.md`'s.
- It is **always shown** — not a tunable preference (there is no settings knob for it, so
  `settings_spec.md` is unaffected) and not altered by the Selection, Filter, or search.

---

## 9. Keyboard shortcuts (binding set)

The reader is keyboard-driven (`vision.md` §6). The full binding set:

| Key | Action | Notes |
|---|---|---|
| `j` | select/open the **next** article in the list | stops at the last row; opening obeys §5.1 |
| `k` | select/open the **previous** article | stops at the first row |
| `m` | toggle Read/Unread on the selected article | §5.2; no-op if nothing selected |
| `s` | toggle Star on the selected article | §6.1; no-op if nothing selected |
| `o` | open the selected article's **original** (`link`) in a new tab | `target="_blank"`, `noopener`; no-op if no link |
| `r` | Refresh all feeds | §8.1 |
| `e` | open the **Export** dialog | `export_spec.md` |
| `/` | focus the **search** box | §3.2 |
| `?` | open the **shortcuts dialog** | §9.1 |
| `Shift+M` | **mark all read** in the current Selection's scope | §6.4 (confirmed) |
| `Esc` | close any open dialog | the open dialog handles its own dismissal |

**Binding suppression rule:** **all shortcuts are suppressed while focus is in a text input, a
textarea, or a contenteditable element** — so typing a search query or text in a dialog never fires a
shortcut. (This is why `/` focuses the search box but further typing does not trigger `s`, `m`, etc.)

`j`/`k` navigate the **current list order** (§4.1) by the selected row's index; with no current
selection, `j` opens the first row and `k` opens the first row (navigation starts at the top of the
list). Opening via `j`/`k` follows the same open-marks-read behavior as a click (§5.1) and scrolls
the new row into view (§4.6).

### 9.1 The shortcuts dialog (the operator's memory aid)

`?` opens a modal listing every binding, grouped, plus the suppression note. The dialog is dismissed
by `Esc`, by its close control, or by clicking its backdrop. Its **content is binding** (it is the
operator's reference — `vision.md` values an honest, learnable surface):

- **Navigation:** `j` Next article · `k` Previous article · `/` Focus search.
- **On the selected article:** `m` Toggle read / unread · `s` Star / unstar · `o` Open original in
  new tab.
- **In the current view (sidebar selection):** `Shift` `M` Mark all as read.
- **App:** `r` Refresh all feeds · `e` Export to Markdown · `?` Show this list · `Esc` Close any
  dialog.
- A footer note: shortcuts are disabled while typing in a text field.

---

## 10. Deep-link (binding — `api_contract.md` §7)

The backend redirects `GET /a/{id}` → `302` to `/?article={id}` (`api_contract.md` §7). On SPA load
the reader inspects the URL for an `?article=<id>` query parameter, and if present and numeric:

1. **selects that article** — sets it as the selected id so the pane resolves to it **if its row is in
   the loaded list** (§7.2; see the binding limitation below);
2. **switches the Filter to `all`** so the target is findable even if it is already Read (an
   exported, already-read article must still open);
3. **strips the `article` query parameter from the URL** (a history replace), so a reload or a copied
   URL is clean.

This is how an exported "in reader" link (`export_spec.md`) lands the operator on the right article.
A non-numeric or absent `article` param is ignored (normal load).

**Binding limitation (current behavior).** The deep-link does **not** change the Selection (it stays
the default **All**) and forces only the Filter to `all`; it does **not** fetch the target article
independently of the list. The pane therefore opens the deep-linked article **only when that article
is among the loaded `all`/All list page** (§2 — the list requests one generous page, not the whole
archive). A deep-link to an older article that falls outside the loaded page resolves to no row, so
the pane stays in its empty state (§7.2) until the operator surfaces it. This gap is recorded in §11.2;
a stricter behavior (reset the Selection to All *and* fetch the target directly) is a spec change.

**Binding example:** opening `/a/4501` → the browser is redirected to `/?article=4501` → the reader
sets the Filter to `all` and selects article `4501`; if `4501` is in the loaded All list page the pane
opens it, and the address bar is rewritten to `/`.

---

## 11. Open questions (code observations to reconcile, not silently "fixed")

These are places where the current implementation and the spine specs are in mild tension. Per
`start.md` §0 they are flagged rather than silently reconciled:

1. **Mark-all-read under a Starred Selection marks the whole app.** §6.4 maps a Starred Selection to
   the empty body `{}`, which marks **every** feed Read, not just the starred articles. There is no
   "mark all starred read" scope in `api_contract.md` §5. This is arguably surprising (the operator
   is looking at Starred and asks to mark all read). Resolution options: (a) accept it (mark-all-read
   is always whole-app from a non-feed/non-folder view), (b) add a scope to `api_contract.md` §5, or
   (c) disable mark-all-read while Starred is selected. **Spec change required to alter behavior** —
   left as documented current behavior.
2. **Deep-link target may not be in the loaded list — and then the pane stays empty.** §10 sets the
   selected id and forces the `all` Filter but does **not** change the Selection and does **not** fetch
   the target independently of the list. The pane's subject is the selected id resolved against the
   loaded list page (§7.2), so if the deep-linked article is **outside** the loaded `all`/All page
   (e.g. an older exported article past the page boundary, or one in a feed the current Selection
   excludes), it resolves to **no row** and the pane shows its **empty state** — the article does *not*
   open. `j`/`k` also behave as if nothing is selected. This is the current behavior and it is a real
   shortfall for the export's "in reader" link (`export_spec.md`), whose whole point is landing on an
   older read article. A conformant fix (reset the Selection to **All** *and* fetch the single-article
   record directly so the pane opens regardless of the list page) is a **spec change**; left as
   documented current behavior, not silently reconciled.
3. **The mark-all-read confirmation wording says "visible"** while the action marks the whole scope
   (including rows beyond the current page). The behavior (mark the scope) is the binding one; the
   wording should not imply "only what is on screen". Treated as copy to tighten, not a behavior
   change.

---

## 12. Acceptance Criteria

- Switching the Selection (All / Starred / Folder / Feed) reloads the list to that Selection and
  clears the open article; the pane returns to its empty state. (§2.1)
- A Starred Selection shows starred articles regardless of the active Filter pill. (§2.2)
- The three Filter pills map to `unread` / no-filter / `starred`; the default on load comes from
  `settings_spec.md`'s `defaultFilter`; the Unread pill shows the whole-app unread count and omits it
  when zero. (§3.1)
- Search issues a server-side `search` query matched against title or Summary, combines with
  Selection+Filter, and is focused by `/`. (§3.2, §9)
- The list is ordered `COALESCE(published_at, fetched_at) DESC`; the sticky header shows the Selection
  title and `N of M`; loading shows `loading…`; the empty state invites a filter change/refresh. (§4)
- A row shows feed title, the relative timestamp per the binding table, the title (bold unread,
  dimmed read), an unread dot only while unread, the 2-line excerpt in comfortable density (hidden in
  compact), and a per-row star toggle; clicking the star does not open the row. (§4.4, §4.5)
- The relative-timestamp worked examples (`now`, `5m`, `3h`, `2d`, `Jun 3`, `Dec 14, 25`) hold. (§4.5)
- The selected row is scrolled into view on selection (click and `j`/`k`). (§4.6)
- Opening an unread article selects it immediately, then (after the read call resolves) flips the row
  to read and reloads counts; opening a read article does neither. (§5.1)
- `m` and the pane control toggle read/unread; counts are never stale after any read-state change.
  (§5.2, §5.3)
- Read-on-scroll: an unread row scrolled off the top is marked read after the configured delay;
  scrolling it back cancels; each article auto-marks at most once; the tracking resets on Selection
  or article-set change; the whole behavior is off when disabled in settings. (§6.3)
- Mark-all-read confirms, then marks the scope mapped from the Selection (feed → folder → whole app)
  and reloads list + counts. (§6.4)
- The pane: empty state with the `?` hint when nothing is selected; on selection it fetches the full
  record, resets to Feed mode, shows the kicker/title/author/date/"View original ↗" (new tab,
  noopener), the Feed-content vs Read-full-article toggle with on-demand fetch + loading + error
  states, and read/unread + star controls. (§7)
- **Both content modes are sanitized before render and every in-content link opens in a new tab with
  `noopener` — `engineering_standard.md` §6.** (§7.5)
- The toolbar carries: sidebar toggle, refresh-all (spinner → poll status → reload), the three
  filter pills, search, mark-all-read, export, import, theme toggle, settings, and the UTC clock. (§8)
- The refresh-all flow kicks the background refresh, polls refresh-status to completion (bounded),
  then reloads feeds + articles. (§8.1)
- The toolbar shows a persistent UTC clock at its trailing end, formatted `YYYY-MM-DD HH:MM:SS UTC`,
  ticking every second from the browser clock in UTC (`2026-07-02T14:23:45Z` → `2026-07-02 14:23:45
  UTC`), always visible and non-interactive. (§8.3)
- Every shortcut in the binding set works, is suppressed in text fields, and the `?` dialog lists the
  full set with the suppression note. (§9, §9.1)
- The deep-link `?article=<id>` selects the article id, forces the `all` Filter, and strips the query
  param; the pane opens the article when its row is in the loaded All list page, and otherwise stays in
  its empty state (the documented current limitation). (§10, §11.2)

## 13. Risk & failure considerations

- **Untrusted HTML (primary risk).** Feed Content and readability Full content are third-party HTML
  rendered into the DOM. Both render paths MUST be sanitized and MUST force external-link hardening
  (§7.5; `engineering_standard.md` §6.1/§6.2; `architecture.md` §5 principle 6). A regression here is
  a security defect, not a cosmetic one. Verify the sanitizer is on **both** the Feed-content and the
  Read-full-article paths and that in-content links carry `target="_blank" rel="noopener noreferrer"`.
- **Stale unread counts.** The whole "trustworthy already-read" promise (`vision.md` §5.4) fails if a
  read-state mutation does not refresh counts. Every open, toggle, auto-mark, and mark-all-read must
  reload the feeds endpoint (§5.3); the local row-state flip must not be the only count source.
- **Bulk mark-all-read is destructive of unread state and irreversible in bulk.** It must always
  confirm first (§6.4), and its scope must match the Selection exactly (the open question §11.1 about
  the Starred case notwithstanding).
- **Read-on-scroll accidental marks.** A too-short delay or a wrong direction could silently mark
  articles read the operator did not see — which is exactly the "the reader lied about what I read"
  failure. The off-the-top-only trigger, the cancel-on-return, the tunable delay, and the global
  off-switch (§6.3; `settings_spec.md`) are the mitigations; the feature is opt-in/tunable by design.
- **Refresh-all hang.** The poll loop must be bounded so a never-finishing or failed background
  refresh cannot leave the spinner spinning forever (§8.1).

## 14. Deliverables checklist

- [ ] Selection model: All / Starred / Folder / Feed drive the list query per §2; switching reloads
      the list and clears the open article; Starred forces the `starred` filter.
- [ ] Filter pills (unread / all / starred) with default from settings; Unread shows the whole-app
      unread count; Starred Selection overrides the pill. (§3.1)
- [ ] Live server-side search against title or Summary, combinable with Selection+Filter, `/`-focused.
      (§3.2)
- [ ] Article list ordered `COALESCE(published_at, fetched_at) DESC`, sticky header with title and
      `N of M`, loading and empty states. (§4)
- [ ] Row: unread dot, feed title, relative timestamp (per the binding table), title (bold
      unread/dim read), 2-line excerpt in comfortable (hidden in compact), star toggle. (§4.4–4.5)
- [ ] Selected row scrolls into view. (§4.6)
- [ ] Open selects immediately, then marks read + reloads counts on the read call's completion;
      per-article read/unread toggle (`m` + pane). (§5)
- [ ] Star toggle from list and pane via `POST /api/articles/{id}/star`. (§6.1)
- [ ] Read-on-scroll: off-the-top trigger, configured delay, cancel-on-return, at-most-once,
      reset-on-context-change, fully off-able + tunable from settings. (§6.3)
- [ ] Mark-all-read: confirm → scope-mapped `mark-all-read` body → reload list + counts; `✓` toolbar
      button and `Shift+M`. (§6.4)
- [ ] Reading pane: empty state with `?` hint; full-record fetch on select; reset to Feed mode on
      switch; header (kicker, title, author, date, View original ↗ new-tab); Feed-content vs
      Read-full-article toggle with on-demand `…/full` fetch + loading + error; read/unread + star
      controls. (§7)
- [ ] **Both render paths sanitized; all in-content links new-tab + noopener (`engineering_standard.md`
      §6).** (§7.5)
- [ ] Toolbar: sidebar toggle, refresh-all (spinner → poll refresh-status → reload), filter pills,
      search, mark-all-read, export, import, theme toggle, settings. (§8)
- [ ] Persistent toolbar UTC clock: `YYYY-MM-DD HH:MM:SS UTC`, 1-second tick, browser-derived UTC,
      trailing end, always shown, non-interactive (worked example §8.3). (§8.3)
- [ ] Keyboard shortcuts: `j k m s o r e / ? Shift+M Esc`, suppressed in text fields. (§9)
- [ ] Shortcuts dialog content matches §9.1 (grouped bindings + suppression note).
- [ ] Deep-link `?article=<id>`: set selected id, force `all` filter, strip the param; pane opens it
      only when its row is in the loaded list page (documented limitation §11.2). (§10)
- [ ] Open questions (§11) carried as documented current behavior, not silently changed.
