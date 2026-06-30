# Feedler — Design — the visual & interaction language (three-pane, themes, density, dialogs, motion, a11y)

**Status:** Binding for appearance and shared interaction patterns. **Read `architecture.md` first**
(the glossary §2, the data model §3, the principles §5), then this.

**Scope (what this spec owns).** The *visual and interaction LANGUAGE* of Feedler, expressed as
**intent** — the three-pane layout, light/dark theming, the color and type identity, list density,
the shared dialog/menu/button/field patterns, motion, the accessibility floor, the brand mark, and
scrollbars. This document says how Feedler **looks** and the shape of its **shared interactions**.

**Out of scope (what other specs own — cite, do not restate).**
- **What any control DOES** (the behavior, the wire calls, the state machine) belongs to the feature
  specs: the list / reading pane / toolbar controls / read-on-scroll / search / Selection model /
  deep-link / keyboard shortcuts are `components/reading_spec.md`; the sidebar tree, the per-feed
  **more** menu, add/rename/move/remove and the feed-error dialog are
  `components/feed_management_spec.md`; the export dialog's controls and Markdown output are
  `components/export_spec.md`; the import dialog's behavior is covered by the import endpoint
  (`standards/api_contract.md` §6) and `components/ingestion_spec.md`.
- **Persistence of the theme choice and of the reading settings** (density, default filter,
  read-on-scroll on/off and delay), including cross-tab sync and reset, is
  `components/settings_spec.md`.
- **The wire contract** (object shapes, endpoints, status codes) is `standards/api_contract.md`; the
  **data model** is `architecture.md` §3. This spec references field names where appearance depends
  on them but never re-specifies the contract.
- **External links opening in a new tab** is a *design behavior with a security reason*; the rule is
  `standards/engineering_standard.md` §6.2 (and `architecture.md` P6). This spec records how it looks
  and feels; the security obligation is binding there.

This document is **intent, not frozen law.** The palette and type families below are *the current
identity, replaceable*: a redesign may re-skin every surface by changing the identity tokens without
touching any feature behavior, because every role is named **semantically**. Treat any pixel, hex,
or millisecond figure herein as **guidance** that records the current identity, not as a contract.
The binding parts are: the *shape* of the layout, the *roles* colors play, the *states* surfaces
have, the *shared patterns* every dialog/menu/button obeys, and the *accessibility floor*.

---

## 1. Glossary (additions; canonical terms are `architecture.md` §2)

This spec reuses the canonical terms verbatim: **Feed, Folder, Article, GUID, Summary, Content, Full
content, Read/Unread, Starred, Refresh, Conditional GET, Scope, Selection, Range, Filter, Seed, Meta,
Deep-link.** It introduces these **display-only** terms for the visual surfaces it owns:

| Term | Meaning |
|------|---------|
| **Pane** | One of the three top-level vertical regions: the **Sidebar pane**, the **List pane**, the **Reading pane**. |
| **Center column** | The Sidebar's sibling: a **Toolbar** atop a body of (List pane │ Reading pane). |
| **Surface** | Any rendered region with its own background/border treatment (a pane, a dialog card, a menu, a row, a field, a button). Every surface is designed in **both** themes. |
| **Identity token** | A named, replaceable design value: the **ink scale** (neutral surfaces/text/borders), the **accent** (the one warm hue), the **sans face** (UI), the **serif face** (reading body). Changing a token re-skins; it never changes behavior. |
| **Theme** | The active light-or-dark appearance. Applied as a **dark mode flag on the document root** (its presence selects the dark variant of every surface; its absence is light). |
| **Density** | The List pane's row spacing mode: **comfortable** or **compact** (a setting — `settings_spec`). |
| **Active-mode button** | A button that is currently the chosen one of a set (e.g. the Filter pill in force, the Feed-content/Full-article toggle) — rendered in the **accent solid** treatment. |
| **Segmented toggle** | A small inset group of mutually-exclusive buttons sharing one track, where the chosen segment is **raised** (its own surface + subtle shadow). |
| **Wordmark** | The brand "F" lockup: an accent-filled rounded tile bearing a white "F", beside the name "Feedler". |

---

## 2. The color & type identity (current, replaceable — intent)

These are the **identity tokens**. They are recorded as the *current* identity; a redesign replaces
the values, not the roles. Hex/family values below are **guidance**.

### 2.1 The ink scale (neutral)

A single cool-grey ("slate") neutral ramp, **ink**, runs from near-white to near-black and supplies
every surface background, every text color, and every border in both themes. The current ramp (light
→ dark): `#f8fafc · #f1f5f9 · #e2e8f0 · #cbd5e1 · #94a3b8 · #64748b · #475569 · #334155 · #1e293b ·
#0f172a · #020617` (eleven steps, `50…950`). **Light theme** draws surfaces from the light end and
text from the dark end; **dark theme** inverts: surfaces from the dark end (page background is the
darkest step), text from the light end. The app shell's base is **light surface / dark ink text** in
light theme and **darkest surface / light ink text** in dark theme.

### 2.2 The accent (one warm hue)

A **single warm accent** — orange — is the only chromatic color in the chrome. The current identity
is a two-step accent: a **base** (`#f97316`) and a **darker hover/press** (`#ea580c`); in dark theme
text-on-surface uses of the accent (links, active sidebar label) lighten toward `#fb923c` for
contrast. The accent is **scarce on purpose**: it marks meaning, never decoration.

The accent's **semantic roles** (binding as roles; the hue is replaceable):

| Role | Where it appears |
|------|------------------|
| **Primary action** | The confirming button of a flow — Add, Import, Retry now, the export Copy button, the settings Done button — rendered as **accent-solid with white label**, darkening on hover. |
| **Active / selected state (chrome)** | The in-force Filter pill, the active reading-mode button (Feed content / Read full article) — **accent-solid white-label**. |
| **Active Selection (sidebar)** | The chosen sidebar item (All / Starred / a Folder / a Feed) — an **accent-tinted background with accent-colored label** (a *tint*, not a solid). |
| **Active row (list)** | The selected list row — a **faint accent wash** behind the row (lighter than the sidebar tint). |
| **Unread indicator** | The small **accent dot** preceding an unread Article's title in the list. |
| **Link in article body** | Anchors inside rendered Article HTML are **accent-colored and underlined**. |
| **Focus ring** | The visible keyboard-focus ring on text inputs is an **accent ring** (§7.6). |
| **Brand** | The wordmark tile and favicon fill (§9). |

### 2.3 Non-accent semantic colors

These roles use fixed semantic hues outside the ink/accent identity:

| Role | Treatment |
|------|-----------|
| **Danger / remove** | The "Remove" menu item and the destructive affordances render in **red**; a red error glyph (⚠) marks a feed in error. |
| **Error surface** | An error message sits on a **faint red wash** with red text (e.g. the feed-error detail body, the full-article fetch-failure banner, the add-feed inline error). |
| **Success surface** | The import result sits on a **faint green wash** with green text. |

### 2.4 Typography

Two type families — both **identity tokens**, replaceable:

- **UI / sans face** — an *Inter-class* humanist sans (current stack: Inter, then the platform UI
  sans fallbacks). Used for **all chrome**: sidebar, toolbar, list rows, dialogs, buttons, fields,
  and Article **headings** inside the reading body. Inter is loaded as a webfont (current source:
  `https://rsms.me/inter/inter.css`); if it fails to load, the platform sans fallback is used with no
  layout change. *(Note: the webfont is currently loaded from an external host; see Open questions.)*
- **Reading / serif face** — a *Charter/Georgia-class* serif (current stack: Charter, Georgia,
  Cambria, Times New Roman). Used **only for the Article body text** to give the reading pane a
  book-like measure. Headings within the body switch back to the sans face for contrast.

The Article body is set at a **comfortable reading size and generous line height** (current:
~18px / 1.7) and is **constrained to a reading measure of about 70 characters** (`max-width: 70ch`)
so lines never run too long, regardless of how wide the Reading pane grows. Numeric counts (unread
counts, "N of M", the delay readout) use **tabular figures** so they don't jitter as digits change.

---

## 3. Layout — the three-pane shape (binding shape; sizes are guidance)

Feedler is a fixed-viewport, three-pane reader that **fills the window and never scrolls as a whole**
— each pane scrolls independently inside its own region. The top-level shape:

```
┌──────────┬───────────────────────────────────────────────────────┐
│          │  Toolbar (sidebar toggle · refresh · filters · search · │
│          │           mark-all · export · import · theme · settings)│
│ Sidebar  ├──────────────────────┬────────────────────────────────┤
│  pane    │   List pane          │   Reading pane                  │
│ (nav)    │  (fixed-ish width,   │  (flexes to fill remaining      │
│          │   own scroll)        │   width, own scroll)            │
│          │                      │                                 │
└──────────┴──────────────────────┴────────────────────────────────┘
   ^ collapsible          ^ List + Reading pane = the center column's body
```

**Binding layout rules:**

1. **Three panes, one row.** A horizontal flex row: the **Sidebar pane** on the left, then the
   **center column** filling the rest. The center column is a vertical stack: the **Toolbar** on top,
   the **two-pane body** (List pane │ Reading pane) below.
2. **The Sidebar pane is a fixed-width nav column** (current: ~`18rem`/`w-72`) with its own vertical
   scroll, separated from the center column by a hairline border. It does **not** flex.
3. **The Sidebar pane is collapsible.** A toolbar control toggles it; when collapsed it is **removed
   from the layout** (not merely narrowed), and the center column reclaims the full width. Default is
   **open**. This is the responsive lever: on a narrow viewport the operator collapses the Sidebar to
   give the List and Reading panes room. (The toggle's behavior is reading_spec / feed_management;
   this spec owns that collapsing reclaims width and the default-open state.)
4. **The List pane is fixed-ish width; the Reading pane flexes.** The List pane has a fixed working
   width (current: `420px`) with its own scroll and a hairline right border; the Reading pane takes
   **all remaining width** and scrolls independently. Widening the window widens the Reading pane, not
   the List pane.
5. **Independent scroll, no page scroll.** The outer shell is height-locked to the viewport with
   overflow hidden; the Sidebar, the List pane, and the Reading pane each scroll within themselves.
   The page body must **never** scroll horizontally.
6. **Sticky list header.** The List pane's header (the Selection title + the "N of M" count) is
   **sticky at the top** of the List pane's scroll with a translucent, blurred backdrop so it stays
   legible over scrolling rows.
7. **Reading pane is centered and measured.** Within the (flexing) Reading pane, the article content
   sits in a **centered column with comfortable horizontal padding** (current max column ~`48rem`/
   `max-w-3xl`) so the body honors the reading measure even on a very wide window.

**Empty states.** When **no Article is selected**, the Reading pane shows a centered placeholder: a
large book glyph, "Select an article from the list", and a hint that pressing `?` shows the keyboard
shortcuts (the shortcut set is `reading_spec`). When **the List pane has no Articles** (and is not
loading), it shows a centered, muted "No articles to show. Try changing the filter or refreshing."

**Loading states.** While the list is loading, the List pane header count reads `loading…` instead of
"N of M"; the refresh control spins while a Refresh is in flight (§8); the full-article button reads
"Fetching…" and is disabled while extraction is in flight.

---

## 4. Theming — light & dark, both first-class (intent + binding behavior)

**Both themes are first-class.** Every surface in this spec is specified in **both** light and dark;
neither is an afterthought, and a surface that looks right in only one theme is a defect.

**Binding theming rules:**

1. **The default follows the OS.** On first load, with no stored choice, Feedler adopts the operating
   system's preference (the `prefers-color-scheme` query). Dark OS → dark theme; otherwise light.
2. **Runtime-switchable.** A toolbar control toggles light↔dark **instantly**, without reload. The
   theme applies by toggling a **dark-mode flag on the document root**: its presence selects the dark
   variant of every surface; its absence is light. (The page also advertises `color-scheme: light
   dark` so native form controls and scrollbars adapt.)
3. **No theme flash.** The theme is resolved and the root flag applied **before first paint** (a
   synchronous bootstrap reads the stored choice / OS preference at startup), so the operator never
   sees a light flash before dark, or vice-versa.
4. **The choice persists; persistence is `settings_spec`.** Once the operator picks a theme it is
   remembered across reloads and tabs. The storage key, cross-tab sync, and reset semantics are owned
   by `components/settings_spec.md` — this spec only requires that the chosen theme survive a reload
   and that the OS default apply only when no explicit choice exists. *(Current implementation stores
   the choice under a browser-local key; settings_spec is authoritative on the mechanics.)*
5. **The toolbar theme control is honest about its action.** It shows the glyph for the theme it will
   switch **to**: a sun when currently dark (click → light), a moon when currently light (click →
   dark). It carries an `aria-label` (§7.5).

**Per-theme surface intent (current identity):**

| Surface | Light | Dark |
|---|---|---|
| App / Reading-pane background | white | darkest ink (`950`) |
| Sidebar pane | faint ink wash (`50` @ low opacity) | dark ink wash (`900` @ low opacity) |
| Toolbar / dialog header & body | white / light ink | dark ink (`950` / `900`) |
| Hairline borders | light ink (`100`) | dark ink (`800`) |
| Primary text | darkest ink | light ink (`100`) |
| Muted/meta text | mid ink (`400`–`500`) | mid ink (`400`–`500`) |
| Read-row title (dimmed) | ink `400` | ink `500` |
| Accent (links, active label) | `#ea580c` | `#fb923c` (lightened) |
| Code/pre block | very-dark ink (`900`) bg, light text | near-black ink (`950`) bg |
| Error wash | faint red | translucent dark red |
| Success wash | faint green | translucent dark green |

---

## 5. Typography & the Article body (intent)

The chrome uses the **sans face** at small, dense sizes (labels, rows, buttons commonly ~`13–15px`).
The **Article body** is the one place the **serif face** appears and is the typographic centerpiece.

**Article-body styling intent** (the reading surface; the rendered HTML is sanitized per
`engineering_standard.md` §6 before it reaches the DOM — the sanitization is binding there):

| Element | Intent |
|---|---|
| **Body text** | Serif face, comfortable size and line height (~18px / 1.7), constrained to ~`70ch`. Paragraphs have clear vertical rhythm. |
| **Headings (h1–h3)** | Switch to the **sans face**, semibold, with extra space above; a descending size scale (h1 largest). |
| **Links** | **Accent-colored and underlined** (thin underline, slight offset); lighten in dark theme. Every link opens in a new tab (§6 + `engineering_standard.md` §6.2). |
| **Images / video / iframes** | **Responsive**: never exceed the column width, height auto, gently rounded corners, vertical margin. |
| **Blockquotes** | A left **accent-neutral rule** (ink border), italic, muted text, indented. |
| **Code (inline)** | A faint ink-tinted chip with rounded corners, slightly smaller monospace. |
| **Pre / code blocks** | A **dark surface in both themes** (near-black) with light monospace text, padded, rounded, and **horizontally scrollable** within their own box so a long line never widens the page. |
| **Lists** | Indented with standard markers and tight item spacing. |
| The reading **header** above the body | Sans: an uppercase muted folder·feed eyebrow, a large bold title, then a meta row (author, localized publish time, a "View original ↗" accent link). |

**Binding example — long code line.** A `<pre>` containing a 400-character line MUST scroll inside
its own box; the Reading pane and the page body MUST NOT gain a horizontal scrollbar. *(binding)*

**Binding example — a hostile `<a target>` in feed HTML.** A feed anchor that tries to set
`target="_self"` (to break out of the SPA) MUST be rendered with `target="_blank"` and
`rel="noopener noreferrer"` regardless of what the source markup requested. *(binding; the rule is
`engineering_standard.md` §6.2)*

---

## 6. External links open in a new tab (design behavior; security rule cited)

Every link the operator can click that leaves Feedler — anchors **inside rendered Article HTML**, the
"View original ↗" link in the reading header, the feed `xml_url` link in the feed-error dialog, and
the "open original" keyboard action — opens in a **new browser tab** and never replaces the
single-page reader. Visually, in-body links read as accent underlined text; the reading-header source
link carries a small ↗ to signal "leaves Feedler". The **obligation** that such links carry
`target="_blank"` + `rel="noopener noreferrer"` (so untrusted article markup cannot hijack or tamper
with the reader) is binding in `standards/engineering_standard.md` §6.2 and `architecture.md` P6; this
spec records only the look and the new-tab feel.

---

## 7. Shared interaction patterns (binding patterns; appearance is intent)

These patterns are **shared vocabulary**: every dialog, menu, button, field, pill, and toggle in
Feedler — present and future — obeys the pattern here so the product feels of one piece. The *what a
control does* is the owning feature spec's; the *shape and states* are this spec's.

### 7.1 The modal dialog

Used by **export, import, settings, keyboard-shortcuts, and the feed-error detail** (the feature
specs own each dialog's contents; this spec owns the shell). A dialog is:

- A **centered card** floating above the app, over a **dimmed full-viewport backdrop** (a translucent
  black scrim) that obscures the reader behind it. The card has a rounded corner radius and a
  pronounced drop shadow, on the light/dark dialog surface (§4).
- **A header bar** with a title on the left and an **× close control** on the right (a muted glyph
  that brightens on hover), separated from the body by a hairline.
- **Closes three ways, all equivalent:** the × control, the **Esc** key, and a **click on the
  backdrop** (a click *inside* the card does not close it — the card stops click propagation). Esc
  closing every dialog is part of the keyboard floor (§7 of `reading_spec`'s shortcut set lists Esc =
  "close any dialog").
- **Width scales to the dialog's job** (intent): the shortcuts and feed-error and import dialogs are
  **small** (~`28rem`); settings is **medium** (~`32rem`); the export dialog is **large** (~`56rem`)
  and additionally **height-capped to the viewport** (~`85vh`) with its body scrolling internally so
  it never exceeds the screen.
- **A dialog with a confirming action** places that action as the **primary (accent-solid) button**,
  bottom-right, beside a quiet "Close/Cancel/Done" button.

**Binding example — backdrop vs card click.** Clicking the dim area outside the card closes the
dialog; clicking any control or whitespace inside the card does not. *(binding)*

**Within-dialog layouts (intent):** the **export** dialog is a two-column body — a fixed-width
left **controls rail** (Scope, Date range with a conditional custom from/to pair, Read state, Group
by, an "include summary excerpt" checkbox, the accent **Copy** primary and a quiet **Download .md**)
beside a **scrolling live Markdown preview** on a faint inset surface. The **settings** dialog is a
vertical stack of titled sections (each title an uppercase muted eyebrow). The **shortcuts** dialog is
grouped key/description rows. The **import** dialog is descriptive text + a file picker + a result
banner. The export/import/settings **contents and behaviors** are their own specs.

### 7.2 The row "more" menu (context menu)

Each Feed row in the Sidebar carries an icon-only **⋯ "more" control** that opens a small **popover
menu** anchored to it. Pattern:

- The ⋯ control is **revealed on row hover** and on keyboard focus (it is otherwise faded to
  invisible so the sidebar stays calm), carries an `aria-label` (§7.5), and toggles the menu.
- The menu is a small rounded card with a shadow and a hairline border, listing actions as
  full-width left-aligned items that highlight on hover; a **hairline divider** separates a
  destructive item (Remove, in **danger red**) from the rest.
- **Closes on an outside click** (a document-level click outside the menu dismisses it) and after any
  item is chosen. (The menu's *actions* — refresh-one, rename, move, copy URL, show-error, remove —
  are `feed_management_spec`.)

### 7.3 Buttons

| Button kind | Treatment |
|---|---|
| **Primary** | Accent-solid, white label, darken on hover, fade when disabled. The confirming action of a flow. |
| **Quiet / secondary** | No fill at rest; an **ink hover wash**. Used for toolbar actions (mark-all, export, import), Cancel/Close/Done-secondary, and reading-pane mark/star. |
| **Neutral filled** | A light-ink fill with a darker-ink hover (e.g. the "+ Add" control, the export "Download .md", the import file-picker button styled with the accent). Sits between primary and quiet in weight. |
| **Icon-only** | A square padded glyph button with an ink hover wash; **must** carry an `aria-label` (sidebar toggle, theme toggle, settings gear, the ⋯ more control). |

All buttons share a small rounded radius, the sans face, and a hover affordance in **both** themes.

### 7.4 Filter pills, segmented toggles, the active-mode button

- **Filter pills** (toolbar: Unread / All / Starred). A row of pill buttons; exactly one is the
  active **Filter** at a time. The **in-force pill** is the **active-mode button** (accent-solid,
  white label); the others are quiet (ink hover). The Unread pill shows the **total unread** count in
  parentheses when nonzero (tabular figures). *(The Filter's behavior is `reading_spec`.)*
- **The reading-mode buttons** (Feed content / Read full article) are a **pair of active-mode
  buttons**: the chosen mode is accent-solid; the other is a neutral filled button. The full-article
  button shows "Fetching…" and disables while extraction is in flight.
- **Segmented toggle** (used in the settings dialog for density and default filter): a small **inset
  track** holding mutually-exclusive segments; the **selected segment is raised** (its own surface +
  a subtle shadow + semibold), the rest are muted with a hover. This is the canonical "pick one of a
  few" control inside dialogs.

### 7.5 Icon-only buttons and `aria-label`s (accessibility — binding)

Every control whose visible content is **only an icon/glyph** MUST carry a text `aria-label` (and
typically a `title` tooltip) naming its action, so it is reachable and announced. This binds at least:
the **sidebar toggle**, the **theme toggle**, the **settings gear**, and each Feed row's **⋯ more
control**. The unread **accent dot** is decorative and read-state is conveyed by the title weight, so
the dot needs no separate label.

### 7.6 Form fields and the focus ring

All editable fields share one field surface: a **light-ink filled field** (dark-ink in dark theme)
with muted placeholder text. The two field kinds differ only in their focus affordance, and **both
are valid against the accessibility floor (§10) so long as focus is visibly indicated in both
themes**:

- **Text inputs** (the add-feed URL/folder fields, the toolbar search box) show, on keyboard focus,
  a **visible accent focus ring** with the native outline suppressed in favor of that ring. The
  accent ring is the **intended** focus treatment for fields.
- **Select menus and the export date pickers** currently keep the **browser-native focus outline**
  (they are filled fields but do not yet carry the accent ring). This still satisfies the floor; a
  re-skin MAY extend the accent ring to them for consistency.

Range sliders, checkboxes, and radios tint to the **accent** when active/checked. The through-line of
the floor (§10) is that focus is visible on **every** focusable control in both themes, by whichever
of these affordances applies.

---

## 8. List density & row states (intent + binding states)

### 8.1 Density (the toggle is a setting — `settings_spec`)

The List pane renders rows in one of two densities; the choice is a persisted setting owned by
`components/settings_spec.md` (this spec owns only what *visibly differs*):

| | Comfortable | Compact |
|---|---|---|
| **Row padding** | Roomier vertical/horizontal padding (current `px-4 py-3`). | Tighter padding (current `px-3 py-2`). |
| **Title size** | Slightly larger (~`15px`). | Slightly smaller (~`14px`). |
| **Summary excerpt** | **Shown** — up to two lines of the **Summary**, clamped, in muted text. | **Hidden** — title-only rows for fast scanning. |
| **Unread dot offset** | Aligned to the larger row. | Nudged up to match the tighter row. |

The **showing/hiding of the Summary excerpt** is the headline difference between the two densities and
is binding behavior of this spec's surface. (The **Summary** itself is the ingest-derived plain-text
excerpt — `architecture.md` §2; the list endpoint returns it — `api_contract.md` §5.)

### 8.2 A list row's anatomy and states

Each row shows: an optional leading **accent unread dot**, the **Feed title** (small, muted) and a
**relative time** on one line, the **Article title** below, and (comfortable only) the **Summary
excerpt**; a **star toggle** (★ filled when Starred, ☆ outline otherwise) sits at the row's trailing
edge. Long values **truncate**; the row is fully clickable to select.

**The four row states (binding as states; exact shades are intent):**

| State | Treatment |
|---|---|
| **Unread** | Title in **semibold**, preceded by the **accent dot**. |
| **Read** | Title **dimmed** (muted ink, no dot). |
| **Selected** | A **faint accent wash** behind the entire row (stronger in dark theme than light). Selected and read/unread compose: a selected unread row is bold + dotted + washed. |
| **Hover** | A **light ink wash** (dark-ink in dark theme) on the row, distinct from and lighter than the selected wash. |

Rows are separated by a **hairline bottom border** in the theme's border ink.

**Relative time (appearance only).** Each row shows a short **relative timestamp**, right-aligned,
in muted ink, in **tabular figures** so it does not jitter. The *format and its time buckets*
(`now` / `<n>m` / `<n>h` / `<n>d` / a localized month-day, with a year shown only across year
boundaries) are a **behavioral transformation owned by `components/reading_spec.md` §4.5** (which
carries the binding table and worked examples); this spec does not restate or re-own it — it only
fixes that the value reads as a compact, muted, tabular time. The reading-header publish time, by
contrast, is the **full localized date-time** (intent: the locale's long form), not the relative
form.

---

## 9. The Sidebar pane structure & brand (the "F" wordmark & favicon)

### 9.1 Sidebar navigation structure (visual shape; behavior is `feed_management_spec`)

The Sidebar pane is the navigation tree (its *behavior* — Selection, feed CRUD, the per-feed **more**
menu, error/retry — is `components/feed_management_spec.md`; this spec owns its **visual shape**):

- **A header row** (the wordmark, §9.2) atop the tree.
- **Two top-level nav items** — **All articles** and **Starred** — each a full-width item with a
  leading glyph, a label, and a right-aligned **unread count badge** (tabular figures, muted, shown
  only when nonzero). These take the **active-Selection treatment** (the accent tint, §2.2) when
  chosen.
- **A "Folders" group label** — a small uppercase muted eyebrow — above the folder list.
- **Folder rows**, each with a leading **disclosure control** (a ▸/▾ chevron that collapses/expands
  the folder's feeds) and a clickable folder label carrying its own unread count badge; an expanded
  folder shows its **feeds indented** beneath it.
- **Feed rows** (indented under their folder): a leading **health glyph** — a muted neutral dot when
  the Feed is healthy, a **red ⚠ error glyph** when the Feed has a `last_error` (clicking it opens the
  feed-error dialog) — then the Feed title (truncated), a right-aligned unread count badge, and the
  hover/focus-revealed **⋯ more control** (§7.2).
- **The inline "add feed" form** (toggled from the header's **+ Add** control, §9.2) appears as a
  small bordered card *within* the Sidebar — not a modal — carrying the field treatment of §7.6 and an
  inline **error surface** (red, §2.3) on failure. (Its behavior is `feed_management_spec`.)

A selected folder/feed/top-item carries the accent-tinted active-Selection treatment (§2.2); the
rest take the quiet ink hover.

### 9.2 Brand — wordmark & favicon

- **Wordmark.** Top of the Sidebar pane: a small **accent-filled rounded tile** bearing a **white
  bold "F"**, immediately followed by the name **"Feedler"** in semibold sans, then (right-aligned) a
  neutral **+ Add** control that **toggles** the inline add-feed form (§9.1) — its glyph flips to a
  **×** while the form is open. The tile uses the accent base hue.
- **Favicon.** A square **accent-filled rounded-corner tile** (current fill `#f97316`) bearing a
  white "broadcast/RSS-style" mark — three concentric quarter-arcs rising from a dot — delivered as a
  scalable vector icon. The page title is **"Feedler"**. The favicon's accent fill MUST track the
  brand accent if the identity is re-skinned.

The wordmark and favicon share the **same accent + white** treatment so the browser tab and the app
header read as the same brand.

---

## 10. Accessibility floor (binding)

These are minimums every build must meet; they are intent only in *how* they look, binding in *that*
they exist.

1. **A full keyboard path for every mouse action.** Anything the mouse can do, the keyboard can do.
   The reader exposes a single-key shortcut set — navigate the list (`j`/`k`), toggle read (`m`),
   star (`s`), open original in a new tab (`o`), refresh (`r`), mark-all-read (`Shift+M`), export
   (`e`), focus search (`/`), show the shortcuts list (`?`), and **Esc closes any dialog**. **The
   shortcut set and its behavior are owned by `components/reading_spec.md`** (and surfaced to the
   operator by the shortcuts dialog, §7.1); this spec only requires the keyboard path exist and that
   shortcuts are **suppressed while a text field is focused** so typing is never hijacked.
2. **Visible focus states.** Every focusable control shows a visible focus indicator (the accent
   focus ring on fields, §7.6; a clear focus affordance on buttons) in **both** themes. The Feed-row
   ⋯ control becomes visible on focus, not only on hover, so keyboard users can reach it.
3. **`aria-label`s on icon-only controls** (§7.5) — binding for the sidebar toggle, theme toggle,
   settings gear, and the more control.
4. **Adequate contrast in both themes.** Text-on-surface and the accent-on-surface (white label on
   accent-solid; accent text on the page) must meet a comfortable contrast in light **and** dark —
   which is why the accent **lightens** for text uses in dark theme (§2.2). Muted/meta text stays
   legible (mid-ink against the theme surface). A re-skin must preserve this contrast floor.
5. **Decorative vs meaningful.** Purely decorative glyphs (the unread dot, the placeholder book) are
   not relied on alone to convey state — read/unread is also carried by **title weight**, errors by
   **text**, the active filter by the accent **and** position.

---

## 11. Motion (intent — minimal and purposeful)

Motion is **sparse and functional**; Feedler is a fast tool, not an animated one.

| Motion | Intent |
|---|---|
| **Refresh spinner** | The toolbar refresh glyph (and a Feed row's title opacity while its one-off refresh runs) indicates work: the glyph **spins continuously** (~0.9s/turn, linear) only while a Refresh is in flight, then stops. It is the primary "something is happening" signal. |
| **Selected-row scroll-into-view** | When the selection changes (e.g. via `j`/`k`), the newly selected List row is **smoothly scrolled** to the nearest visible position so keyboard navigation never strands the cursor off-screen. |
| **Hover / state transitions** | Background washes on hover/selection change crisply; transitions, if any, are short and unobtrusive. |
| **Copied confirmation** | The export Copy button briefly swaps its label to a "✓ Copied" confirmation, then reverts. |

**Reduced motion is an accessibility intent (target, not yet implemented).** Where the operating
system signals a preference for reduced motion (`prefers-reduced-motion`), Feedler SHOULD honor it:
the smooth scroll-into-view should become an instant jump and the spinner should present as a
static/stepped busy indicator rather than continuous rotation. The *meaning* (work in progress, where
the selection went) must survive without the animation. **Honesty note (per `start.md` §0):** the
current build does **not** yet honor this preference (it always smooth-scrolls and always spins); this
is recorded as the intended floor and as an open question (§ Open questions), not as current
behavior.

---

## 12. Scrollbars (intent)

Feedler styles **subtle custom scrollbars** on its scroll regions in **both** themes: a thin track
(current ~`10px`), a **transparent track**, and a **translucent rounded thumb** in a neutral ink tone
— slightly more muted in dark theme than light — so the scrollbars are present and usable but never
visually loud. The page advertises a light/dark color scheme so native scrollbars (where custom
styling is unavailable) still adapt to the theme.

---

## Risk & failure considerations

This spec governs appearance, but two visual decisions carry real risk and are therefore bound to the
standards rather than left to taste:

1. **Rendering untrusted HTML in the Reading pane.** The Article body, blockquotes, images, and link
   styling here all describe rendering of **third-party HTML** (feed `content`/`summary` and
   readability `full_content`). That HTML is untrusted and MUST be sanitized before it reaches the DOM
   — the obligation, and "no raw insertion of feed data", is binding in
   `standards/engineering_standard.md` §6.1. A pretty article body that renders unsanitized markup is
   a security defect, not a design choice.
2. **External-link escape.** Styling in-body links is harmless; letting them navigate the SPA away is
   not. Every external link opening in a new tab with `noopener noreferrer` (§6) is the mitigation and
   is binding in `engineering_standard.md` §6.2.

No other surface here has size caps or sanitization concerns of its own; the whole-app Risk/Audit and
Deployment concerns are carried once by `engineering_standard.md` §9–§10.

---

## Acceptance Criteria

A build conforms to this spec when:

1. **Three-pane shape.** The app fills the viewport as a Sidebar pane + a center column (Toolbar over
   List pane │ Reading pane); the Sidebar is a fixed-width collapsible nav, the List pane is
   fixed-ish width, the Reading pane flexes; each region scrolls independently and the page never
   scrolls horizontally; the List header is sticky. (§3)
2. **Sidebar collapse reclaims width.** Toggling the sidebar removes it from layout and the center
   column expands to full width; default is open. (§3.3)
3. **Both themes, OS default, runtime switch, persists, no flash.** Light and dark are both complete;
   first load follows the OS preference; the toolbar control switches instantly via the document-root
   dark flag; the choice survives reload (mechanics per `settings_spec`); no light/dark flash on
   load. (§4)
4. **Color roles.** The accent marks exactly the roles in §2.2 (primary action, chrome
   active/selected, sidebar active Selection tint, selected-row wash, unread dot, body links, focus
   ring, brand) and nothing decorative; danger=red, error=red wash, success=green wash. (§2)
5. **Typography.** Chrome is sans; the Article body is serif at ~70ch with a comfortable size/line
   height; body headings revert to sans; links are accent + underline; images are responsive;
   blockquotes, inline code, and dark scrollable pre blocks render per §5. Counts use tabular figures.
6. **Density.** Comfortable vs compact differ in row padding and title size, and **comfortable shows
   the two-line Summary excerpt while compact hides it**; the toggle is the `settings_spec` setting.
   (§8.1)
7. **Row states.** Unread = bold + accent dot; read = dimmed title; selected = faint accent wash;
   hover = ink wash; states compose; hairline row separators; the relative timestamp reads as a
   compact, muted, tabular value (its format is `reading_spec.md` §4.5's, not re-owned here). (§8.2)
8. **Modal dialog pattern.** Export/import/settings/shortcuts/feed-error are centered cards over a
   dimmed backdrop with an × close, **and each closes on ×, on Esc, and on a backdrop click while a
   click inside the card does not close it**; the export dialog is large and viewport-height-capped
   with an internal scroll. (§7.1, binding example)
9. **More menu.** The Feed-row ⋯ control is hover/focus-revealed, opens an anchored popover, and
   **closes on outside click** and after a choice; the Remove item is danger-red below a divider.
   (§7.2)
10. **Buttons / pills / segmented toggles / active-mode.** Primary=accent-solid, quiet=ink-hover,
    icon-only=labeled; the in-force Filter pill and the chosen reading-mode button render as
    accent-solid active-mode buttons; settings density/default-filter use a raised-segment toggle.
    (§7.3–7.4)
11. **Fields & focus.** Inputs/selects share the filled-field treatment; text inputs show a visible
    accent focus ring (selects/date-pickers use the native focus outline — both keep focus visible);
    checkboxes/radios/sliders tint to the accent. (§7.6)
12. **Accessibility floor.** A keyboard path exists for every mouse action with shortcuts suppressed
    in text fields (set owned by `reading_spec`); icon-only controls carry `aria-label`s; focus is
    visible in both themes; contrast holds in both themes (accent lightens for dark-theme text uses).
    (§10)
13. **Sidebar structure & brand.** The Sidebar pane renders the nav tree per §9.1 — All/Starred top
    items with count badges, a "Folders" group, folder rows with a disclosure chevron and indented
    feed rows, each feed row carrying a health glyph (muted dot / red ⚠), count badge, and the
    hover/focus-revealed ⋯ control; the accent "F" wordmark tops it (the + Add control toggling the
    inline add-feed form); the favicon is the accent tile with the white broadcast mark; the tab title
    is "Feedler". (§9)
14. **Motion.** The refresh glyph spins only during a Refresh; the selected row smoothly scrolls into
    view; reduced-motion is honored as an intent. (§11)
15. **Scrollbars.** Subtle custom scrollbars (translucent thumb, transparent track) in both themes.
    (§12)
16. **Empty/loading states.** No-selection and no-articles placeholders render per §3; the list count
    reads `loading…` while loading and the full-article button reads "Fetching…" while extracting.

---

## Deliverables checklist

- [ ] Three-pane layout: collapsible fixed-width Sidebar + center column (Toolbar over fixed-ish List
      pane │ flexing Reading pane); per-pane scroll; no horizontal page scroll; sticky List header. (§3)
- [ ] Sidebar collapse removes the pane and reclaims width; default open. (§3.3)
- [ ] Light **and** dark themes complete for every surface; OS default on first load; instant runtime
      toggle via the document-root dark flag; persists (per `settings_spec`); no theme flash. (§4)
- [ ] Ink scale + single accent as the identity; accent confined to the §2.2 semantic roles; red
      danger/error and green success washes. (§2)
- [ ] Sans chrome + serif Article body at ~70ch; sans body-headings; accent underlined links;
      responsive images; blockquote/inline-code/dark-pre styling; tabular numeric figures. (§2.4, §5)
- [ ] Density toggle: comfortable vs compact padding/size **and Summary excerpt shown vs hidden**
      (setting per `settings_spec`). (§8.1)
- [ ] List row states: unread (bold + accent dot), read (dimmed), selected (accent wash), hover (ink
      wash), composing; hairline separators; relative timestamp rendered compact/muted/tabular (format
      owned by `reading_spec.md` §4.5). (§8)
- [ ] Modal dialog pattern (centered card, dim backdrop, × close, close on Esc and backdrop click,
      inside-click does not close) for export/import/settings/shortcuts/feed-error; export large +
      height-capped + internally scrolling. (§7.1)
- [ ] Feed-row ⋯ more menu: hover/focus-revealed, anchored popover, closes on outside click and on
      choice, danger Remove below a divider. (§7.2)
- [ ] Button system (primary / quiet / neutral / icon-only), Filter pills, reading-mode buttons,
      and the raised-segment toggle; the active-mode (accent-solid) treatment. (§7.3–7.4)
- [ ] Filled form fields; text inputs carry the visible accent focus ring (selects/date-pickers keep
      the native focus outline); accent-tinted checkboxes/radios/sliders; focus visible on every field. (§7.6)
- [ ] `aria-label`s on icon-only controls (sidebar toggle, theme toggle, settings gear, ⋯ more);
      full keyboard path; shortcuts suppressed in text fields; visible focus + adequate contrast in
      both themes. (§7.5, §10)
- [ ] Sidebar nav-tree visual shape: All/Starred items + count badges, "Folders" group, folder rows
      with disclosure chevron + indented feed rows, per-feed health glyph (muted dot / red ⚠) + count
      badge + hover/focus ⋯ control, inline add-feed card (not modal). (§9.1)
- [ ] "F" wordmark in the sidebar header (the + Add control toggles the inline add-feed form);
      accent broadcast-mark favicon; "Feedler" tab title. (§9.2)
- [ ] Refresh spinner during Refresh; smooth selected-row scroll-into-view; reduced-motion honored;
      Copy → "✓ Copied" confirmation. (§11)
- [ ] Subtle custom scrollbars (translucent thumb, transparent track) in both themes. (§12)
- [ ] Empty/loading states: no-selection placeholder (with the `?` hint), no-articles message,
      `loading…` count, "Fetching…" full-article button. (§3)

---

## Open questions / process friction

1. **Webfont loaded from an external host.** The UI font (Inter) is currently pulled from a remote
   stylesheet at `https://rsms.me/inter/inter.css`. This is the only outbound asset request the SPA
   makes, and it sits uneasily beside the vision's local-first, no-phone-home posture (`vision.md` §9,
   `engineering_standard.md` §6.5) and the single-binary self-contained-deployable goal
   (`architecture.md` §5 P1). The page degrades gracefully to the platform sans fallback if the font
   fails, so behavior is unaffected — but a self-hosted/embedded font (or accepting the system sans)
   would better match the WHY. **Flagging per `start.md` §0 "never silently fix"**: this is recorded
   as an open question rather than changed, since the fix touches the build, not just this spec.
2. **Per-feed "more" actions use native browser prompts.** Rename and Move currently use the
   browser's native `prompt()`/`confirm()` dialogs rather than the in-app modal-dialog pattern (§7.1),
   and Remove uses a native `confirm()`. This is a behavioral choice owned by
   `feed_management_spec.md`; noted here only because it is the one place the shared dialog pattern is
   **not** used, which a future redesign may want to reconcile.
3. **Reduced-motion not yet honored.** §11 records honoring `prefers-reduced-motion` as the
   accessibility floor's intent, but the current build does not implement it (the selected-row scroll
   always animates and the refresh glyph always spins continuously). Flagged per `start.md` §0 rather
   than presented as done; the fix is a small, behavior-preserving addition (gate the smooth-scroll and
   the spin animation on the media query).
4. **The accent focus ring is not on every field.** §7.6 records the accent focus ring as the intended
   field-focus treatment, but it is currently applied only to the text inputs (add-feed fields, search
   box); select menus and the export date pickers keep the browser-native focus outline. Both satisfy
   the accessibility floor (focus is visible); the inconsistency is the open item a re-skin may close.
