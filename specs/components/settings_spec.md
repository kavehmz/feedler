# Feedler — Settings — client preferences (read-on-scroll, density, default filter) + theme

**Status:** Binding for the Settings surface. **Read `architecture.md` first** (glossary §2, the data
model §3, the principles §5 — especially **P3**), then `standards/engineering_standard.md` (§4
configuration, the server-config boundary this spec draws a line against).

**Scope.** This spec owns the **client-stored preferences** and the **theme**: the Settings object and
its binding field names/defaults, how those preferences persist in the browser and stay in sync across
tabs, the reset action, the Settings dialog (every section, control, hint, and interaction), the
light/dark theme choice and its boot-time resolution, and the **boundary** between what is a client
setting (here) and what is server/environment configuration (`engineering_standard.md` §4). It does not
own the *behaviors these knobs tune* — those live in the feature specs cited below.

**What this spec deliberately does not own** (cite the owner; do not restate):

| Not here | Owner |
|---|---|
| The read-on-scroll **mechanism** (how an unread Article scrolled past the top is detected and marked Read, and the delay timer behavior) | `components/reading_spec.md` |
| The list **density rendering** (what a "comfortable" vs "compact" row actually looks like) | `components/reading_spec.md` |
| The **Filter** behavior itself (how `unread` / `all` / `starred` narrows the list) and the **toolbar theme toggle** placement/affordance | `components/reading_spec.md` |
| The export **timezone** source (the export draws day boundaries in the browser's timezone; it is *not* a stored setting) | `components/export_spec.md` |
| The theme **palette / appearance** (colors, the dialog visual pattern, density visual intent) | `design/design_spec.md` |
| Server-side configuration (refresh interval, export-timezone default, public base URL — all env vars) | `standards/engineering_standard.md` §4 |

Per `architecture.md` **P3**: client preferences (theme, reading settings) live in the browser and are
explicitly **not durable server state**. Feedler stores no server-side per-operator preferences
(`architecture.md` §7). This spec is the entirety of the operator-tunable client state.

---

## 1. Local glossary (additions to `architecture.md` §2)

These terms are local to this spec; all canonical terms (Filter, Read/Unread, Selection, Article, etc.)
are used verbatim from `architecture.md` §2.

| Term | Meaning |
|---|---|
| **Settings object** | The single bundle of client-stored reading/layout/default preferences defined in §2. One object, persisted as a unit. |
| **Theme** | The operator's light/dark appearance choice, persisted **separately** from the Settings object (§6). Not a field of the Settings object. |
| **Defaults** | The built-in Settings object used when nothing is stored and as the target of Reset (§2, §4). |
| **Storage key** | The versioned browser-`localStorage` key under which the Settings object is persisted (§3). |
| **Merge-over-defaults** | The load rule: stored values are layered on top of the Defaults so any field the stored object lacks takes its default (§3). |

The Settings object and the Theme are two separate browser-local concerns with two separate storage
keys; they are specified together here because they are the operator's only client-tunable knobs.

---

## 2. The Settings object (binding field names + defaults)

The Settings object has exactly these four fields. The **field names, types, value sets, and defaults
are binding** (the persistence format and the dialog both depend on them):

| Field | Type | Default | Adjustable range | Meaning |
|---|---|---|---|---|
| `autoMarkOnScroll` | boolean | `true` | on / off | When `true`, an unread Article scrolled past the top of the list marks itself Read (the read-on-scroll behavior — `components/reading_spec.md`). When `false`, scrolling never auto-marks. |
| `autoMarkDelayMs` | number (milliseconds) | `700` | `0`–`3000`, in steps of `100` | How long to wait after an Article leaves the viewport before marking it Read. Lower = snappier; higher = more forgiving of scroll-bounce. Only meaningful when `autoMarkOnScroll` is `true`. |
| `density` | `"comfortable"` \| `"compact"` | `"comfortable"` | the two values | Article-list row density (the rendering is `components/reading_spec.md`'s). |
| `defaultFilter` | `"unread"` \| `"all"` \| `"starred"` | `"unread"` | the three values | The **Filter** applied to the article list on first page load. Uses the canonical Filter vocabulary (`architecture.md` §2); note this knob offers the three triage-relevant values and does **not** include `read`. |

**Binding worked example — the Defaults.** With nothing stored, the Settings object resolves to exactly:

```jsonc
{
  "autoMarkOnScroll": true,
  "autoMarkDelayMs": 700,
  "density": "comfortable",
  "defaultFilter": "unread"
}
```

**Application of each field (WHAT the value tunes; owners cited):**

- `autoMarkOnScroll` and `autoMarkDelayMs` are handed to the article list, which performs (or suppresses)
  read-on-scroll accordingly — `components/reading_spec.md`. This spec governs only the *values* and how
  they persist.
- `density` is handed to the article list to select its row layout — `components/reading_spec.md`.
- `defaultFilter` **seeds the article list's Filter at first load only.** It is the initial value of the
  reader's Filter; after load the operator may change the Filter from the toolbar
  (`components/reading_spec.md`) and that runtime change does **not** write back to `defaultFilter`. The
  setting is a *starting* Filter, not a live mirror of the current Filter.
  - **Interaction with the Deep-link (binding).** When the reader is opened via a **Deep-link**
    (`/a/{id}` → `/?article={id}`, `architecture.md` §2, `api_contract.md` §7), the reader overrides the
    initial Filter to `all` so the linked Article is guaranteed visible regardless of its read state —
    this override takes precedence over `defaultFilter` for that load. (The deep-link selection behavior
    is `components/reading_spec.md`'s; stated here only to define what `defaultFilter` does and does not
    govern.)

---

## 3. Persistence (binding)

The Settings object is **client-local** browser storage, never server state (`architecture.md` P3).

1. **Stored under a versioned Storage key.** The Settings object is persisted in the browser's
   `localStorage` under the binding key:

   ```
   feedler.settings.v1
   ```

   The `.v1` suffix is a version marker reserved for a future, incompatible reshaping of the stored
   object; the loader's merge-over-defaults rule (below) makes additive field changes *not* require a
   version bump.

2. **Stored value is the JSON serialization of the Settings object** (the four fields of §2).

3. **Load = merge-over-defaults.** On load, the stored JSON is parsed and **layered on top of the
   Defaults**, so the result is `{ ...Defaults, ...stored }`. Consequences (all binding):
   - A **newly added field** that the stored object predates takes its **default** automatically — no
     migration needed.
   - If nothing is stored, the result is exactly the Defaults (§2).
   - If the stored value is **absent, empty, or unparseable**, loading falls back to the Defaults rather
     than erroring (a corrupt or quota-cleared store must never break boot).

4. **Save on every change.** Any change to the Settings object (a toggle flip, a slider move, a chooser
   click, or a Reset) is immediately written back to the Storage key. There is no explicit "Save" button
   — the dialog's "Done" only closes it (§5). A write that fails (e.g. storage quota) is swallowed
   silently and must not break the UI.

5. **Cross-tab synchronization.** A change written to the Storage key in one browser tab is reflected in
   every other open Feedler tab: each tab listens for the browser's cross-tab storage-change event on the
   Storage key and, when an **incoming new value** is present, re-derives its Settings object using the
   **same merge-over-defaults rule** (`{ ...Defaults, ...incoming }`). Binding boundaries:
   - The re-merge fires only for an event carrying a **new value** for the Storage key. An event that
     **clears/removes** the key in another tab (no new value) does **not** propagate — the receiving tab
     keeps its current settings rather than resetting to the Defaults.
   - A **malformed** incoming value is ignored (the tab keeps its current settings).
   - Events for **other** keys (including the Theme key, §6) are ignored — only the Settings Storage key
     drives this sync.

   This keeps two tabs from disagreeing about read-on-scroll, density, or the default filter.

**Binding worked example — merge-over-defaults.** Stored value is
`{"density":"compact"}` (e.g. written by an older build that only knew `density`). Load result:

```jsonc
{
  "autoMarkOnScroll": true,     // from Defaults (absent in stored)
  "autoMarkDelayMs": 700,       // from Defaults (absent in stored)
  "density": "compact",         // from stored (overrides default)
  "defaultFilter": "unread"     // from Defaults (absent in stored)
}
```

---

## 4. Reset

A **"reset to defaults"** action restores the Settings object to exactly the Defaults (§2), which (per
§3.4) is then persisted.

- **Reset is behind a confirmation.** The action prompts the operator to confirm before discarding their
  settings; on confirm, the Settings object becomes the Defaults; on cancel, nothing changes.
- Reset affects only the Settings object. It does **not** change the Theme (§6) — the Theme is a separate
  concern under a separate key and is not part of "reset settings."

---

## 5. The Settings dialog (UI)

A modal dialog opened from the toolbar's settings control (the toolbar is `components/reading_spec.md`'s
surface; this spec owns the dialog's contents and behavior). The dialog is titled **"Settings"** and has
a header with a close affordance plus three labeled sections, a footer with Reset + Done controls, and an
explanatory boundary note. The visual pattern (modal scrim, panel chrome) is `design/design_spec.md`'s;
the structure and copy below are binding.

### 5.1 Sections and controls

**Section "Reading"** — tunes the read-on-scroll behavior (`components/reading_spec.md`):

- A **toggle**: "Mark articles as read when I scroll past them", bound to `autoMarkOnScroll`. It carries
  an explanatory **hint** stating that, Reeder-style, an unread Article that scrolls off the top of the
  list is marked Read automatically.
- A **delay slider** for `autoMarkDelayMs`:
  - A continuous control over the range **0–3000**, in **steps of 100**.
  - A **millisecond readout** of the current value, displayed with the literal trailing unit `ms`
    (e.g. `700ms`).
  - A hint reading, verbatim: **`Lower = snappier · Higher = more forgiving of scroll-bounce`**.
  - The entire delay control (label, readout, slider, hint) is **dimmed and non-interactive when
    `autoMarkOnScroll` is off** — the delay only matters when auto-mark is on. Turning the toggle back on
    restores it.

**Section "Layout"** — a **density chooser** for `density`, a two-option segmented selector with labels
**"Comfortable"** (→ `comfortable`) and **"Compact"** (→ `compact`). The currently-selected option is
visibly marked.

**Section "Defaults"** — a **default-filter chooser** for `defaultFilter`, a three-option segmented
selector labeled **"Unread"** (→ `unread`), **"All"** (→ `all`), **"Starred"** (→ `starred`), under the
prompt "Filter when I open Feedler". The currently-selected option is visibly marked. (Only these three
Filter values are offered here; see §2.)

Each control change updates the Settings object immediately and is persisted at once (§3.4); changes are
reflected live in the reader (e.g. flipping density re-renders the list) and across tabs (§3.5).

### 5.2 Footer controls

- **"Reset to defaults"** — triggers the Reset action behind its confirmation (§4).
- **"Done"** — closes the dialog. It is **not** a save (saving is continuous, §3.4); it only dismisses.

### 5.3 The browser-local / server-config boundary note

The dialog displays a note making the boundary explicit to the operator: **these settings are stored in
the operator's browser (`localStorage`), while server-side preferences are controlled by environment
variables** in the deployment's compose file. The note names the **refresh interval** and the **export
timezone** as examples of server/environment-controlled options that are *not* in this dialog. This is
the operator-facing statement of the boundary specified normatively in §7.

> **Open question (code vs. spec scope).** This spec's scope brief lists three server-side examples to
> name in the note — refresh interval, export-timezone default, **and the public base URL**. The current
> dialog copy names only the refresh interval and the export timezone, omitting the base URL. All three
> are genuinely server/environment-controlled (`engineering_standard.md` §4: `FEEDLER_REFRESH_INTERVAL_MINUTES`,
> `FEEDLER_PUBLIC_BASE_URL`, and the export's default timezone), so the omission is cosmetic, not a
> behavior gap. Flagged for the operator: either add the base URL to the note (matching the brief) or
> accept the shorter list. Not silently "fixed" here.

### 5.4 Dialog dismissal

The dialog closes on any of:

- **"Done"** (§5.2);
- the header **close affordance**;
- clicking the **scrim** outside the panel (clicks inside the panel do not close it);
- pressing **Esc**.

Esc-to-close is a binding interaction of this dialog.

---

## 6. Theme (light / dark)

The Theme is the operator's light/dark appearance choice. It is **browser-local** and persisted
**separately** from the Settings object, under its own binding `localStorage` key:

```
feedler.theme
```

whose value is one of the literal strings **`"light"`** or **`"dark"`**.

### 6.1 Boot-time resolution (binding precedence)

On application boot, before the reader renders, the Theme is resolved and applied to the document so the
first paint is already in the correct theme (no flash):

1. **If a stored Theme exists**, it wins: `"dark"` → dark, otherwise light.
2. **Otherwise** (nothing stored), fall back to the **OS preference** via the `prefers-color-scheme: dark`
   media query: matches → dark, else light.

The resolved theme is **applied by toggling a `dark` marker on the document root element** — its presence
means dark, its absence means light. (The actual palette swap driven by that marker is
`design/design_spec.md`'s concern; this spec owns only the resolution precedence and that a single
document-root marker carries the choice.)

**Binding worked example — theme resolution precedence:**

| Stored `feedler.theme` | OS `prefers-color-scheme` | Resolved theme |
|---|---|---|
| `"dark"` | light | **dark** (stored wins) |
| `"light"` | dark | **light** (stored wins) |
| (unset) | dark | **dark** (OS fallback) |
| (unset) | light | **light** (OS fallback) |

### 6.2 Toggling and persistence

The Theme is toggled from the **toolbar** (the affordance lives in `components/reading_spec.md`'s
toolbar). Toggling:

1. flips light↔dark,
2. updates the document-root `dark` marker to match, and
3. **persists** the new choice to the `feedler.theme` key.

Because a toggle always writes a stored value, once the operator has toggled even once, boot resolution
(§6.1 step 1) thereafter honors that explicit choice over the OS preference until the operator toggles
again.

> **Note (no live OS sync).** The OS preference is consulted **only** at boot and only when nothing is
> stored (§6.1). The reader does not subscribe to OS theme changes at runtime, and the Theme is not
> synchronized across tabs via the storage event (unlike the Settings object, §3.5) — a new tab resolves
> the Theme at its own boot. This is the observed behavior; it is recorded as an invariant, not a defect.

---

## 7. The boundary: client settings vs. server configuration (normative)

This is the line `architecture.md` P3 and `engineering_standard.md` §4 draw, restated here as the
authority for "which knob lives where."

| Knob | Where it lives | Authority |
|---|---|---|
| Read-on-scroll on/off (`autoMarkOnScroll`) | **Client setting** (this spec, §2) | here |
| Read-on-scroll delay (`autoMarkDelayMs`) | **Client setting** (this spec, §2) | here |
| List density (`density`) | **Client setting** (this spec, §2) | here |
| Default filter (`defaultFilter`) | **Client setting** (this spec, §2) | here |
| Theme (light/dark) | **Client, browser-local** (this spec, §6) | here |
| **Background refresh interval** | **Server config** — env var `FEEDLER_REFRESH_INTERVAL_MINUTES` | `engineering_standard.md` §4 |
| **Export day-boundary timezone DEFAULT** | **Browser-derived at export time**, not a stored setting; the operator may override per-export in the export dialog | `components/export_spec.md`, `api_contract.md` §6 (`tz` param) |
| **Public base URL** (for export deep-links) | **Server config** — env var `FEEDLER_PUBLIC_BASE_URL` | `engineering_standard.md` §4 |
| **Data dir / port / seed OPML** | **Server config** — env vars | `engineering_standard.md` §4 |

Two consequences are binding:

1. **Nothing in this dialog writes to the server.** Changing any client setting is a pure browser-local
   write (§3). There is no settings API endpoint (`engineering_standard.md` §4: "no config file, no admin
   settings endpoint").
2. **The export's timezone default is not a Feedler setting.** It is derived from the browser at export
   time (and the server has a fallback default per `engineering_standard.md` §4); it is intentionally
   absent from this dialog. The export dialog is where a per-export timezone is chosen
   (`components/export_spec.md`).

---

## 8. Risk & failure considerations

This component holds no untrusted data and makes no network calls, so its risk surface is narrow but real:

- **Corrupt or unavailable storage must never break boot.** A malformed `feedler.settings.v1` value, a
  disabled/quota-exhausted `localStorage`, or an unparseable Theme value must each fall back gracefully —
  Settings to the Defaults (§3.3), Theme to OS-then-light (§6.1) — never throwing during load and never
  preventing the reader from rendering. A failed *write* is swallowed (§3.4).
- **Cross-tab merge must tolerate garbage.** An incoming storage-event value that does not parse is
  ignored (§3.5); a malicious or stale value cannot crash a tab.
- **The versioned key is the migration seam.** Because load is merge-over-defaults (§3.3), additive field
  changes are safe without a version bump; only a backward-incompatible reshaping should advance past
  `.v1`. Reusing `.v1` for an incompatible shape would silently mis-merge — that is the one storage change
  that *must* be a loud, version-bumping decision.

---

## 9. Acceptance Criteria

A build conforms to this spec when all of the following hold:

1. **Object & defaults.** With nothing stored, the Settings object is exactly the Defaults of §2
   (`autoMarkOnScroll=true`, `autoMarkDelayMs=700`, `density="comfortable"`, `defaultFilter="unread"`),
   and `defaultFilter` only ever holds one of `unread` / `all` / `starred`.
2. **Persistence key.** The Settings object persists under the literal key `feedler.settings.v1` as JSON.
3. **Merge-over-defaults.** Loading a partial stored object yields stored-over-Defaults (the §3 worked
   example reproduces exactly); a missing/empty/corrupt store yields the Defaults without error.
4. **Save on change.** Every toggle/slider/chooser/Reset writes the Storage key immediately; "Done" does
   not save and "Done"/Esc/scrim/close all dismiss the dialog (§5.4).
5. **Cross-tab sync.** A settings change in one tab is reflected in another open tab via the storage
   event, re-merged over Defaults; a malformed incoming value is ignored, an event for any other key
   (including the Theme key) is ignored, and a key clear/remove (no new value) does not reset the tab.
6. **Reset.** "Reset to defaults" is confirmation-gated, restores exactly the Defaults, persists them, and
   leaves the Theme untouched.
7. **Dialog completeness.** The dialog shows the "Reading" (toggle + hint; delay slider over 0–3000 step
   100 with a `…ms` readout and the verbatim `Lower = snappier · Higher = more forgiving of scroll-bounce`
   hint, dimmed/disabled when the toggle is off), "Layout" (Comfortable/Compact), and "Defaults"
   (Unread/All/Starred) sections; the Reset + Done footer; and the browser-local-vs-env-vars boundary note
   naming the refresh interval and export timezone.
8. **Default filter seeds first load.** The article list opens under `defaultFilter`, except a Deep-link
   open forces `all` for that load (§2); a later toolbar Filter change does not write back to the setting.
9. **Theme key & precedence.** The Theme persists under `feedler.theme` as `"light"`/`"dark"`; boot
   resolution follows stored-then-OS-then-light (the §6.1 table reproduces exactly); the choice is applied
   via a single `dark` marker on the document root and is toggled+persisted from the toolbar.
10. **Boundary.** No client setting reaches the server; there is no settings endpoint; the export timezone
    default is browser-derived and absent from this dialog (§7).

## 10. Deliverables checklist

- [ ] Settings object with the four binding fields, types, value sets, and Defaults of §2.
- [ ] Persistence under `feedler.settings.v1`, JSON-serialized, written on every change (§3.4).
- [ ] Load via merge-over-defaults, with graceful fallback to Defaults on missing/corrupt store (§3.3).
- [ ] Cross-tab synchronization via the storage event, re-merged over Defaults, tolerant of garbage (§3.5).
- [ ] Confirmation-gated Reset that restores and persists the Defaults and leaves the Theme alone (§4).
- [ ] Settings dialog with the "Reading", "Layout", and "Defaults" sections and every control/hint of §5.1.
- [ ] Delay control dimmed/disabled when `autoMarkOnScroll` is off; `…ms` readout; verbatim slider hint (§5.1).
- [ ] Reset + Done footer; "Done" closes without saving; Esc / scrim-click / close affordance all dismiss (§5.4).
- [ ] Browser-local-vs-environment-variables boundary note in the dialog (§5.3) — open question on whether
      to also name the public base URL (§5.3).
- [ ] `defaultFilter` seeds the article-list Filter at first load only; Deep-link open forces `all` (§2).
- [ ] Theme persisted under `feedler.theme` (`"light"`/`"dark"`), separate from the Settings object (§6).
- [ ] Boot-time theme resolution with stored→OS→light precedence (§6.1 table), applied via the document-root
      `dark` marker, toggled and persisted from the toolbar (§6.2).
- [ ] No server settings endpoint; client settings never written to the server (§7).
