# Feedler — Export — the AI-export crown jewel (ranges, timezone, scope, grouping, the Markdown format)

**Status:** Authoritative for the export. **Read `architecture.md` (§2 glossary, §3 data model + invariant 5), `vision.md` (§5.2), `standards/api_contract.md` (§6 the export request contract), and `standards/engineering_standard.md` (§4 config) first.**

**Scope of this spec.** The signature feature of Feedler: turning a **Scope**, a **Range**, a **Filter**, and a grouping choice into a single self-describing **Markdown digest** built to paste into any AI — request to output — plus the Export dialog the operator drives it from. This is the most carefully specified output in the suite; its literal format below is **binding**.

**Not this spec.** The export *request contract* (param names, values, status codes, content type, the download filename pattern) is owned verbatim by `api_contract.md` §6 — this spec references it and never restates the wire shape. OPML **import** belongs to `feed_management_spec` / `ingestion_spec`. The article list and reading pane belong to `reading_spec`. The dialog's pixels, colors, and motion belong to `design/design_spec.md`; this spec owns the dialog's *behavior*.

---

## 1. Why the export exists (the WHY this spec serves)

Feedler holds no API keys, makes no LLM calls, and ships no model (`vision.md` §5.2; `architecture.md` P7). The export **is** the AI seam: it produces the *input* an AI needs and lets the operator choose the AI. Two consequences are load-bearing and every rule below serves them:

1. **The digest is self-describing.** A reader (human or LLM) who is handed only the Markdown can tell what it contains: a range label, an article count, the active filter, and a generation timestamp — all in the document, not in a UI the AI never sees. (`vision.md` §6 "honest about state".)
2. **Every item carries TWO links** (`architecture.md` P8): the **original source** (the article's `link`) and the **Deep-link** "in reader" URL (`/a/{id}`). An LLM can cite either; the operator can jump from the AI's summary straight back into Feedler to triage. Losing either link defeats the feature.

The transformation has a right answer, so the worked examples in §6 are **binding test cases** (`engineering_standard.md` §11 names the export item format and timezone day boundaries as a highest-value unit test).

## 2. Glossary additions

This spec reuses the canonical terms from `architecture.md` §2 verbatim — **Scope**, **Selection**, **Range**, **Filter**, **Folder**, **Feed**, **Article**, **Summary**, **Content**, **Starred**, **Deep-link**, **Meta** — and adds only:

| Term | Meaning |
|------|---------|
| **Digest** | The single Markdown document an export produces: a header block followed by grouped item entries. The whole `text/markdown` body returned by `GET /api/export`. |
| **Range label** | The human-readable description of the active Range printed in the header (e.g. `all time`, `2026-06-01 → 2026-06-07`, `since 2026-06-01`). Derived rules in §6.1. |
| **Body** | The per-item excerpt block (an indented blockquote). The item's **Summary**, or — when the Summary is empty — the item's **Content** converted to Markdown and truncated. Included unless turned off. |

## 3. The request — what the export takes in

The export is a single `GET /api/export` call. Its parameters, values, defaults, content type, and the download filename are **the verbatim contract in `api_contract.md` §6** — do not duplicate them here. This spec specifies the **behavior** behind those parameters: Range/timezone math (§4), Scope and Filter (§5), grouping and the literal output (§6).

The dialog (§7) constructs that request from the operator's choices and never sends anything outside the §6 contract.

## 4. Range and the timezone law (binding)

### 4.1 The timezone law

**Day boundaries are drawn in the operator's timezone, not the server's** (`architecture.md` P8, invariant 5). The browser resolves its own IANA timezone and passes it as the `tz` parameter; the server uses it to decide when "today" begins and ends. Because all timestamps are **stored in UTC** (`architecture.md` §3 invariant 5), the timezone is applied **only at this boundary**: the server computes the window edges in the operator's zone, then the query compares against UTC values.

Resolution rule for `tz`:

- A valid IANA zone name (e.g. `Europe/Berlin`) → that zone.
- The literal `local` → treated as "no override": fall back to the **server's** location.
- An unparseable / unknown name → fall back to the **server's** location (in the container, the runtime carries the zoneinfo database — `engineering_standard.md` §2 — and the server location is effectively UTC).

The server's "now" and the start of the operator's today are both computed **in the resolved zone**: `now = current instant rendered in the zone`; `startOfToday = midnight (00:00:00) of now's calendar date in the zone`.

### 4.2 The six ranges

All windows are **half-open** intervals `[from, to)` — `from` inclusive, `to` exclusive — except where a custom `to` is made inclusive by extending it (§4.3). The article timestamp compared is **published-else-fetched** (`COALESCE(published_at, fetched_at)` — `architecture.md` §3 invariant 4), matching the list ordering.

| Range | `from` | `to` | Meaning |
|---|---|---|---|
| `today` | `startOfToday` | `startOfToday + 24h` | the operator's current calendar day |
| `yesterday` | `startOfToday − 24h` | `startOfToday` | the operator's previous calendar day |
| `week` | `startOfToday − 6 days` | `startOfToday + 24h` | **last 7 days including today** |
| `month` | `startOfToday − 29 days` | `startOfToday + 24h` | **last 30 days including today** |
| `all` | *(none)* | *(none)* | no time bounds; every article in Scope |
| `custom` | parsed `from` (§4.3) | parsed `to`, made inclusive (§4.3) | an explicit operator-chosen window |

`week` spans 7 calendar days and `month` spans 30 because both run from a back-dated start of day up to the end of today (`startOfToday + 24h`). An empty/absent `range` is treated as `custom` (so bare `from`/`to` still work).

### 4.3 Custom range parsing

- `from` and `to` are `YYYY-MM-DD` strings. Each is parsed independently; a string that does not parse is **ignored** (that bound is simply absent — the export degrades to one-sided or unbounded rather than failing).
- A parsed `from` becomes the inclusive lower bound at **00:00 of that date** (in the zone the date string is interpreted in — see the open question in §10).
- A parsed `to` is made **inclusive of its whole day** by advancing it **+24h**: the effective exclusive upper bound is `00:00 of (to + 1 day)`. So `to=2026-06-07` includes everything up to and including 2026-06-07 23:59:59.

### 4.4 Worked example — "today" across a timezone boundary (binding)

An article published at **2026-06-30T23:30:00Z** (UTC).

- **Operator in `Europe/Berlin`** (UTC+2 in summer): the local instant is 2026-07-01 01:30 local. `startOfToday` on 2026-07-01 Berlin is 2026-06-30T22:00:00Z. The article (23:30Z) is **≥ 22:00Z**, so it falls in **Berlin's "today" = 2026-07-01** and **appears** in a `today` export run on 2026-07-01 Berlin. It does **not** appear in a `today` run on 2026-06-30 Berlin (that window ended at 2026-06-30T22:00:00Z).
- **Operator in `UTC`**: `startOfToday` on 2026-06-30 UTC is 2026-06-30T00:00:00Z; the window ends 2026-07-01T00:00:00Z. The article (23:30Z) falls in **UTC's "today" = 2026-06-30** and appears in a `today` run on 2026-06-30 UTC.

**Binding conclusion:** the same article lands on a **different local day** for the two operators, and each `today` export honors the operator's own day boundary. This is the timezone law made concrete.

## 5. Scope and Filter

### 5.1 Scope — mirrors the Selection (`architecture.md` §2)

Scope narrows the *source set* of articles before the Range and Filter apply. It mirrors the sidebar **Selection** and seeds from it when the dialog opens (§7). Four Scopes:

| Scope | How the request expresses it | Behavior |
|---|---|---|
| **All articles** | no `folder`, no `feed` | every feed's articles |
| **Starred only** | no `folder`/`feed`; **forces `filter=starred`** | only starred articles (Filter is pinned to starred — see §5.3) |
| **One folder** | `folder=<name>` (`""` = Uncategorized) | only articles whose feed is in that folder |
| **One feed** | `feed=<id>` | only that feed's articles |

If both `folder` and `feed` are sent, **`feed` narrows further** (both conditions apply). A feed-id parameter that is not an integer is ignored (Scope degrades to All for that dimension) rather than erroring.

There is no server-side "starred" Scope value: **"Starred only" is realized purely as a Filter** (`filter=starred`) over the All source set. The dialog is responsible for that translation (§5.3, §7).

### 5.2 Filter — read-state narrowing

Filter is the same read-state narrowing used by the article list (`architecture.md` §2 Filter). Values and effect:

| Filter | Includes |
|---|---|
| `read` | only articles marked read |
| `unread` | only articles not read |
| `starred` | only starred articles |
| *(omitted / any other value)* | **all** read-states (no narrowing) |

The header prints the active filter as the literal value, or `all` when omitted (§6.1).

### 5.3 The Starred-scope / starred-filter coupling (binding)

When Scope is **Starred only**, the export must apply the **starred** Filter regardless of any read-state choice. In the dialog this is enforced by pinning and disabling the read-state control while Scope is Starred (§7). The net effect is identical to choosing All scope + `starred` filter; "Starred only" is the ergonomic shortcut.

## 6. The Markdown format (binding)

The Digest is **plain UTF-8 Markdown**. Below, every literal — every `#`, `—`, `·`, `(`, `_`, `[`, `]`, the `⭐ ` prefix, the two trailing spaces — is part of the contract. Examples are fenced and **binding test cases**.

### 6.1 The header block

Two lines, then a blank line, open every Digest:

```
# Reads — <range label>

_<n> articles · filter: <filter|all> · generated <RFC3339 timestamp>_
```

- Line 1 is a level-1 heading `# Reads — <range label>` (em-dash `—`, with single spaces around it).
- Line 2 is an *italic* meta line wrapped in single underscores. `<n>` is the count of items in the Digest. `<filter|all>` is the active Filter value, or the literal `all` when no Filter was applied. `<RFC3339 timestamp>` is the generation instant in RFC3339, rendered in the **server's** location (not the operator's `tz` — only the Range *window* math uses the operator's zone; see §6.6 and the open question §10.5).

**Range label** rules:

| Bounds present | Range label |
|---|---|
| neither (`all`) | `all time` |
| both `from` and `to` | `<from-date> → <to-date>` where `<to-date>` is the **inclusive last day** (the exclusive upper bound minus one second, formatted `YYYY-MM-DD`) |
| only `from` | `since <from-date>` |
| only `to` | `until <to-date>` (the raw exclusive bound, formatted `YYYY-MM-DD`) |

The "both bounds" case prints the inclusive last day so the label reads naturally: a window `[2026-06-01, 2026-06-08)` shows `2026-06-01 → 2026-06-07`, not `→ 2026-06-08`.

**Binding example** — `week` for an operator (in `Europe/Berlin`) whose today is 2026-06-30, no filter, 12 items, server location UTC:

```
# Reads — 2026-06-24 → 2026-06-30

_12 articles · filter: all · generated 2026-06-30T15:04:09Z_
```

Note the **range label** dates (`2026-06-24 → 2026-06-30`) are drawn in the operator's Berlin zone, but the `generated` timestamp is in the **server's** location (here UTC, so `…Z`). These can legitimately disagree on the calendar date near midnight; that is by design and flagged in §10.5.

### 6.2 Grouping: by-feed (default)

When `group=feed` (the default), items are grouped under **Folder** then **Feed** headings, both **sorted ascending, case-insensitively** (the same folder-ordering intent the sidebar uses — `api_contract.md` §4), with the items inside a feed kept in the export's source order (newest-first by `COALESCE(published_at, fetched_at)`):

```
## <folder>

### <feed title>

<item lines for that feed>

```

- A folder heading is level-2 `## <folder>`. An article whose feed has no folder is grouped under the literal `Uncategorized` (the display name — `architecture.md` §2; never the empty string).
- A feed heading is level-3 `### <feed title>`.
- A blank line follows each feed's item block.

**By-feed item line** (one Markdown list item per article):

```
- **<⭐ if starred><escaped title>** (_<YYYY-MM-DD HH:MM>_) — [source](<original link>) · [in reader](<public-base-url>/a/<id>)
```

- The title is **bold** (`**…**`), preceded by `⭐ ` (star glyph + one space) **only when the article is starred**, with the title escaped per §6.5.
- `(_<YYYY-MM-DD HH:MM>_)` is the published date/time in the operator's display form. **Omit the entire `(_…_)` parenthetical when the article has no published date.** The time shown is the stored `published_at` rendered `YYYY-MM-DD HH:MM` (see §6.6 on which zone).
- `— [source](<link>)` links to the original article URL.
- `· [in reader](<public-base-url>/a/<id>)` is the Deep-link, appended after a middle-dot `·`. The `<public-base-url>` is `FEEDLER_PUBLIC_BASE_URL` (`engineering_standard.md` §4) with any trailing slash trimmed, and `<id>` is the Article id. The whole `· [in reader](…)` segment is **omitted only if no public base URL is configured** (an empty base URL); with the default base URL it is always present.

**Binding example** — by-feed, a starred dated item and an undated item, base URL `https://reader.example.com`:

```
## Engineering

### The Cloudflare Blog

- **⭐ Eliminating cold starts** (_2026-06-29 14:22_) — [source](https://blog.cloudflare.com/cold-starts) · [in reader](https://reader.example.com/a/4501)

- **A note with \*emphasis\* in the title** — [source](https://blog.cloudflare.com/note) · [in reader](https://reader.example.com/a/4502)

```

(The second item has no published date, so its `(_…_)` is omitted; its title contained `*…*`, escaped to `\*…\*` per §6.5.)

### 6.3 Grouping: chronological

When `group=chrono`, there are **no folder/feed headings**; items are a single flat list in the export's source order (newest-first), each labelled with its feed. Each item is **two lines**:

```
- **<⭐ if starred><escaped title>** — _<feed title>_  
  <YYYY-MM-DD HH:MM> · [source](<original link>) · [in reader](<public-base-url>/a/<id>)
```

- Line 1: the bold (optionally starred) escaped title, an em-dash, then the **feed title in italics** `_<feed title>_`, followed by **two trailing spaces** (a Markdown hard line break, so the continuation renders on its own line). The two trailing spaces are part of the contract.
- Line 2 (the continuation) is indented by two spaces and carries the metadata: `<YYYY-MM-DD HH:MM> · ` then `[source](…)` then ` · [in reader](…)`.
- **When the article has no published date**, omit the `<YYYY-MM-DD HH:MM> · ` prefix on line 2; the continuation then begins (after its two-space indent) directly with `[source](…)`.
- The `· [in reader](…)` segment follows the same base-URL rule as §6.2.

**Binding example** — chrono, one dated item:

```
- **Eliminating cold starts** — _The Cloudflare Blog_  
  2026-06-29 14:22 · [source](https://blog.cloudflare.com/cold-starts) · [in reader](https://reader.example.com/a/4501)
```

**Binding example** — chrono, an undated item (note the continuation starts at the source link):

```
- **A note** — _The Cloudflare Blog_  
  [source](https://blog.cloudflare.com/note) · [in reader](https://reader.example.com/a/4502)
```

### 6.4 The Body block

The Body is included **unless explicitly turned off** (`body=0` — `api_contract.md` §6; the dialog's "Include summary excerpt" checkbox, on by default). When included, it appears immediately under the item's line(s) as an **indented blockquote**:

- The Body source is the article's **Summary** (the plain-text excerpt — `architecture.md` §2). If the Summary is empty, the Body falls back to the article's **Content** (feed HTML) **converted to Markdown** and **truncated to about 1200 characters** (a trailing `…` is appended when truncated).
- The resulting text is trimmed of surrounding whitespace. **If it is empty after that, no Body block is emitted** (the item then has no blockquote at all).
- The block is rendered as a Markdown blockquote indented under the list item: the first line is prefixed `  > ` (two spaces, `>`, space), and **every subsequent line** of a multi-line Body is likewise prefixed `  > ` so the whole block stays inside the same list item's blockquote.

**Binding example** — a by-feed item with a Body:

```
- **Eliminating cold starts** (_2026-06-29 14:22_) — [source](https://blog.cloudflare.com/cold-starts) · [in reader](https://reader.example.com/a/4501)
  > We rebuilt the scheduler so workers start in under a millisecond. This post walks through the isolate-reuse design and the benchmarks.
```

### 6.5 Title escaping (binding)

In **titles only**, the four Markdown-significant characters `*`, `_`, `[`, `]` are **backslash-escaped** (`*` → `\*`, `_` → `\_`, `[` → `\[`, `]` → `\]`) so a title like `*foo* [bar]` renders literally and cannot inject emphasis or a broken link. The `⭐ ` star prefix (when starred) is prepended **after** escaping and is itself never escaped.

**Binding example:** title `Use *async* [v2]` → `Use \*async\* \[v2\]`; starred, it becomes `⭐ Use \*async\* \[v2\]` inside the `**…**` bold wrapper.

Feed titles and Body text are **not** escaped by this rule (feed titles appear in `_…_` in chrono; Body text is the Summary/converted-Markdown as-is). Link URLs are emitted verbatim inside `(…)`.

### 6.6 Date/time rendering note

The per-item time `YYYY-MM-DD HH:MM` is the article's stored `published_at`. Only the **Range-window math** (deciding which articles fall in `today`/`week`/etc.) uses the operator's timezone (§4). The two other times in the Digest do **not**: the header `generated` timestamp is rendered in the **server's** location, and the per-item `YYYY-MM-DD HH:MM` is rendered from the stored `published_at` as the server reads it (not re-projected into the operator's zone). See §10 for the open questions on the per-item time (§10.1), the custom-range bounds (§10.2), and the header timestamp zone (§10.5).

### 6.7 Ordering invariant

Within every grouping, items follow `COALESCE(published_at, fetched_at) DESC` (`architecture.md` §3 invariant 4) — newest first — identical to the article list, so the Digest order matches what the operator saw while triaging.

## 7. The Export dialog (UI behavior)

The dialog is a modal the operator opens to build and preview a Digest. Its appearance (layout proportions, colors, type) is `design/design_spec.md`'s; its **behavior** is below. Two regions: a **controls** column and a **live preview** pane.

### 7.1 Controls

When the dialog opens its defaults are: Range = **Today**, Read state = **All**, Group by = **By folder / feed**, **Include summary excerpt** = on; Scope is seeded from the current **Selection** (so it is *not* fixed to All). The custom from/to pickers start empty and are hidden until Range = Custom.

| Control | Behavior |
|---|---|
| **Scope** select | Seeded from the current **Selection** when the dialog opens. Options, in order: **All articles**; **Starred only**; then **one option per Folder** (labelled with the folder name and its feed count); then **one option per Feed** (labelled with the feed title, visually nested under its folder). Choosing a folder sets `folder=`; choosing a feed sets `feed=`; "Starred only" sets the starred coupling (§5.3). |
| **Date range** select | The six Ranges (§4.2): Today, Yesterday, Last 7 days, Last 30 days, All time, Custom. When **Custom** is chosen, two `YYYY-MM-DD` date pickers (**from**, **to**) appear; otherwise they are hidden. A small note states which **timezone** the day boundaries use — the **browser's resolved IANA zone** — shown literally (§4.1, §7.4). |
| **Read state** select | The four Filter values (All, Read, Unread, Starred — §5.2). When Scope is **Starred only**, this control is **pinned to "starred" and disabled** (§5.3), reflecting that the export is already starred-only. |
| **Group by** select | "By folder / feed" (`group=feed`) or "Chronological" (`group=chrono`) — §6.2/§6.3. |
| **Include summary excerpt** checkbox | On by default; unchecking sends `body=0` so the Body is omitted (§6.4). |
| **Copy to clipboard** button | Copies the **current preview text** to the clipboard and briefly confirms (a transient "copied" state). Disabled while the preview is loading or empty. |
| **Download .md** link | A link to the same export URL with the **attachment disposition** added (`disposition=attachment`), so the browser downloads the file. The server names it `feedler-<YYYY-MM-DD>.md` (`api_contract.md` §6; the date is the operator's current day). |
| **Article-count note** | Reads the count from the preview's header meta line (the `<n> articles` value) and shows "N articles match this query" (singular "article" when N is 1). Before a count is available it shows a one-line reminder that each entry includes original & in-reader links. |

### 7.2 The live preview

A pane that shows the actual Digest as monospaced text. It **fetches the export as text from the same `GET /api/export` URL the controls build** and re-fetches **whenever any option changes** (Scope, Range, custom from/to, Filter, grouping, body). A stale in-flight fetch is superseded by the newest one (the latest selection wins). While a fetch is in flight the pane shows a loading state; a failed fetch shows an error message in the pane rather than silently blanking.

The preview is the **single source of truth** the Copy button and the article-count read from — what the operator sees is exactly what they copy, and exactly what the Download link would produce (the only difference is the attachment disposition).

### 7.3 Dismissal

**Esc closes** the dialog. Clicking the backdrop outside the dialog also closes it; clicking inside does not.

### 7.4 The timezone note (honesty requirement)

The dialog **must display the timezone** whose boundaries the Range uses — the browser's resolved IANA zone (e.g. `Europe/Berlin`), passed to the export as `tz` on every request (including the live-preview fetch). This satisfies `vision.md` §6 ("an export tells you … in what timezone the day boundaries were drawn"). If the browser cannot resolve a zone, the dialog falls back to the literal IANA name `UTC` — both shown in the note and sent as `tz=UTC` — rather than `local` or an omitted parameter (§4.1).

## 8. Behavioral invariants

1. **Dual links per item, always.** With a configured public base URL, every item carries both a `[source]` and an `[in reader]` link (`architecture.md` P8). The `[source]` is the article's original `link`; the `[in reader]` is `<FEEDLER_PUBLIC_BASE_URL>/a/<id>`.
2. **Self-describing header.** Every Digest opens with the `# Reads — <range label>` heading and the `_<n> articles · filter: … · generated …_` meta line. The count and filter shown are the count and filter of *this* Digest.
3. **Operator's timezone owns the day.** `today`/`yesterday`/`week`/`month` boundaries are computed in the operator's zone, never the server's (§4; `architecture.md` invariant 5, P8).
4. **Same order as triage.** Items are newest-first by `COALESCE(published_at, fetched_at)` everywhere (§6.7; `architecture.md` invariant 4).
5. **Preview == output.** The previewed text equals the copied text equals the downloaded file body (modulo the download's attachment disposition).
6. **No embedded AI.** The export reads the database and emits text; it makes no outbound model call and embeds no AI (`architecture.md` P7). The seam is the Markdown.
7. **Idempotent & read-only.** Generating an export never mutates Article state (it does not mark anything read or starred); running it twice yields the same Digest for the same inputs (the only varying field is the `generated` timestamp).

## 9. Risk & failure considerations

- **Untrusted Content in the Body.** When the Summary is empty, the Body is derived from feed-provided HTML **Content** (third-party, untrusted — `architecture.md` P6). The export converts that HTML to Markdown and truncates it; it does **not** render it as HTML, so the script-injection surface of the reading pane does not apply here. The remaining concern is *content* (a feed could pack Markdown control characters or misleading links into the Body); Body text is intentionally **not** escaped, so an operator should treat exported Body text as untrusted just like the source feed. Title text *is* escaped (§6.5) to keep titles from breaking the list/link structure.
- **Size cap on the converted Body.** The Content-derived Body is truncated to ~1200 characters with a trailing `…`, bounding Digest size when feeds carry large bodies. The Summary path is already length-capped at ingest (`architecture.md` §2). There is no global cap on the *number* of items in a Digest; a very broad Scope + `all` range produces a large document by design (the operator chose it). See §10 on the truncation being byte-based.
- **Unparseable timezone is non-fatal.** A bad `tz` degrades to the server location rather than erroring (§4.1); a bad custom date is ignored rather than erroring (§4.3). The export favors producing *some* honest Digest over failing.
- **Empty Digest is valid.** A Scope/Range/Filter combination matching nothing yields a header reporting `0 articles` and no item lines — a correct, honest result, not an error.

## 10. Open questions (flagged, not silently fixed)

These are places where the current implementation and the spine specs may diverge; they are recorded per `start.md` §0 ("note it as an open question rather than silently fixing it") rather than asserted as binding behavior:

1. **Per-item time zone.** The timezone law (§4) draws *range* boundaries in the operator's zone, but the per-item `YYYY-MM-DD HH:MM` printed on each item is rendered from the stored `published_at` **as the server reads it**, not re-projected into the operator's zone. Two operators in different zones exporting the same article see the *same* per-item time string even though they see different *range* membership. Whether the per-item display time should also follow the operator's zone is unresolved — if yes, this is a spec + implementation change.
2. **Custom-range date interpretation.** A custom `from`/`to` (`YYYY-MM-DD`) is parsed without an explicit zone, so the day boundary it produces is not necessarily the operator's local midnight the way the named ranges are. Aligning custom-range parsing with the `tz` parameter is unresolved.
3. **Body truncation is byte-based.** The ~1200-character Content truncation cuts by byte length, which can split a multi-byte UTF-8 character at the boundary. A rune-aware (or grapheme-aware) cut would be safer; flagged as a quality issue, not a format change.
4. **`group` default vs. unknown values.** `group=feed` is the default and `chrono` the only alternative; any other value is treated as by-feed (the default branch). This is lenient by design but undocumented in the wire contract beyond the two named values.
5. **Header `generated` timestamp zone.** The `generated <RFC3339 timestamp>` in the header is rendered in the **server's** location, not the operator's `tz`. Only the Range *window* math is tz-aware; the honesty-of-state intent (`vision.md` §6) is arguably better served by stamping the operator's zone here too, so two operators in different zones would see the generation instant in their own offset. The download filename `feedler-<YYYY-MM-DD>.md`, by contrast, **does** use the operator's zone (the file is named for the operator's current calendar day). Whether the header timestamp should match is unresolved — if yes, this is an implementation change with no format change.

## Acceptance Criteria

- [ ] `GET /api/export` returns `text/markdown; charset=utf-8` (`api_contract.md` §6) whose body begins with `# Reads — <range label>` and the `_<n> articles · filter: … · generated <RFC3339>_` meta line (§6.1).
- [ ] The Range label is `all time` (unbounded), `<from> → <to-1day-inclusive>` (both bounds), `since <from>` (lower only), or `until <to>` (upper only) — exactly as §6.1 (matches the binding example).
- [ ] `today`/`yesterday`/`week`/`month` windows are computed in the operator's `tz`; the §4.4 "Berlin vs UTC" worked example holds (an item at 2026-06-30T23:30:00Z lands on a different local day for the two operators).
- [ ] `week` = last 7 days incl. today; `month` = last 30 days incl. today; `all` = unbounded; `custom` `to` is inclusive of its whole day (§4.2, §4.3).
- [ ] An unparseable `tz` falls back to the server location; a bad custom date is ignored; both produce a valid Digest, never a 5xx (§4.1, §4.3, §9).
- [ ] Scope mirrors the Selection: All / Starred / one folder / one feed; "Starred only" forces the starred Filter (§5.1, §5.3).
- [ ] Filter `read`/`unread`/`starred`/all narrows correctly and is echoed in the header meta line (§5.2, §6.1).
- [ ] By-feed grouping emits sorted `## folder` → `### feed` → item lines, with `Uncategorized` for feeds with no folder, in the exact item format of §6.2 (matches the binding example).
- [ ] Chronological grouping emits the flat two-line item format of §6.3, including the two-trailing-space hard break and the undated-item variant (matches both binding examples).
- [ ] Each item carries both `[source](<link>)` and `[in reader](<base-url>/a/<id>)` with the base URL's trailing slash trimmed (§6.2, §8.1).
- [ ] The `(_date_)` (by-feed) / leading `<date> · ` (chrono) is omitted when the article has no published date (§6.2, §6.3).
- [ ] The Body is an indented `  > ` blockquote of the Summary, falling back to Content-as-Markdown truncated to ~1200 chars with `…`; omitted when `body=0` or when the resolved Body is empty (§6.4).
- [ ] Titles escape `* _ [ ]`; the `⭐ ` prefix appears only when starred and is added after escaping (§6.5; matches the binding example).
- [ ] The dialog seeds Scope from the Selection, offers All/Starred/every folder/every feed, shows custom date pickers only for `custom`, pins+disables read-state under Starred scope, and shows the browser's timezone (§7).
- [ ] The live preview re-fetches on every option change, the latest selection wins over stale fetches, Copy copies the preview text, and Download adds `disposition=attachment` yielding `feedler-<YYYY-MM-DD>.md` (§7.1, §7.2).
- [ ] The article count shown by the dialog is read from the preview header's `<n> articles` (§7.1).
- [ ] Esc (and a backdrop click) close the dialog (§7.3).
- [ ] Generating an export mutates no Article state and is idempotent apart from the `generated` timestamp (§8.7).

## Deliverables checklist

- [ ] Range/timezone engine: resolve `tz` (IANA | `local` | fallback), compute `startOfToday` in-zone, derive the six windows as half-open `[from, to)` intervals (§4).
- [ ] Custom-range parser: `YYYY-MM-DD` from/to, `to` made inclusive (+24h), bad dates ignored (§4.3).
- [ ] Query layer: apply Scope (`folder`/`feed`), Filter (read/unread/starred/all), and the published-else-fetched time bounds, ordered newest-first (§5, §6.7).
- [ ] Header writer: `# Reads — <range label>` + the meta line with count, filter, RFC3339 timestamp, and the four range-label cases (§6.1).
- [ ] By-feed writer: sorted folder → feed headings, the exact item line, undated-item handling (§6.2).
- [ ] Chrono writer: flat two-line item with feed-title italic, hard break, undated continuation (§6.3).
- [ ] Body writer: Summary-or-Content-to-Markdown, ~1200-char truncation, indented multi-line blockquote, empty-body suppression, `body=0` honored (§6.4).
- [ ] Title escaper for `* _ [ ]` and the starred `⭐ ` prefix (§6.5).
- [ ] Dual-link emitter: `[source]` + `[in reader]` using `FEEDLER_PUBLIC_BASE_URL` (trailing slash trimmed), segment omitted when no base URL (§6.2, §8.1).
- [ ] Export dialog: Scope/Range/Filter/Group/Body controls, custom pickers, Starred-scope pinning, timezone note, Copy, Download, article-count readout, live preview with latest-wins fetching, Esc/backdrop dismissal (§7).
- [ ] Open questions (§10) tracked: per-item time zone, custom-range zone, byte-vs-rune truncation, unknown `group` leniency.
