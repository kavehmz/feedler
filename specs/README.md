# Feedler — Specification Suite

This `specs/` tree is the source of truth for **Feedler**, a self-hosted, single-user RSS/Atom
reader whose signature feature is exporting your reads as Markdown for any AI.

The specs — together with the operating manual (`start.md`) — are the project's durable asset. The
code under `workspace/` (the disposable implementation mirror of `specs/`) is built from them: a better AI can delete
it and rebuild it from this tree. If you change what Feedler *is*, you change it here first.

## How to use this repository

Give the AI builder the entrypoint and a command:

```
Read specs/start.md. develop feedler
Read specs/start.md. develop export
Read specs/start.md. the unread dot should be brighter in dark mode
Read specs/start.md. add a "this month" range to the export dialog
```

`specs/start.md` routes everything: fresh builds, reconciling code to changed specs, and plain
change requests (spec-first, per the change rule).

## Map

```
specs/
  start.md                       ← the AI entrypoint and operating manual (start here)
  vision.md                      ← why Feedler exists (the export-to-AI thesis)
  architecture.md                ← system shape, glossary, data model, the 10 principles, lifecycle
  standards/
    engineering_standard.md      ← stack, single-binary/single-port, build, deploy, config, security
    api_contract.md              ← the full HTTP/JSON wire contract (binding)
    develop_loop.md              ← automated spec-convergence mode (develop → review → commit loop)
  components/
    ingestion_spec.md            ← OPML seed/import, the fetcher, conditional GET, dedup, scheduler
    feed_management_spec.md      ← add / remove / rename / move feeds, errors + retry, the sidebar
    reading_spec.md              ← list, reading pane, read/star, read-on-scroll, filter/search, shortcuts
    export_spec.md               ← the AI-export (ranges, timezone, scope, grouping, Markdown format)
    settings_spec.md             ← client preferences (read-on-scroll, density, default filter) + theme
  design/
    design_spec.md               ← the visual & interaction language (three-pane, themes, density, motion)
workspace/                     ← the implementation, built from these specs (disposable; mirrors specs/)
old/                           ← archived original build (reference; runnable standalone on :8473)
```

## The shape of Feedler, in five sentences

Feedler is one Go binary that serves a JSON API and an embedded React SPA on a single port, backed by
one SQLite file, with a background scheduler that politely refreshes subscribed feeds. There is no
authentication and no user model — it is local-first and single-user by design. Articles are
de-duplicated by `(feed, guid)` and feeds by `xml_url`, so re-fetching and re-importing never destroy
read/starred state. The reading experience is a conventional, fast, keyboard-driven three-pane reader
(folders → list → pane) with read-on-scroll, stars, and full-article extraction. Its one opinionated
feature is the **export**: a clean Markdown digest scoped to your selection and a date range in your
timezone, where every item links to both the original article and back into Feedler — built to hand to
the AI of your choice, because the AI lives outside Feedler, not inside it.
