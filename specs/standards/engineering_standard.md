# Feedler — Engineering Standard

**Status:** Binding for every build. **Read `architecture.md` first.**
**Scope:** the stack, the single-binary/single-port rule, embedding the SPA, configuration,
persistence, the Docker build & deployment, the security posture, HTTP conventions, and the testing
floor. This is the one document that carries the whole-app Risk/Audit and Deployment concerns
(Feedler is a single deployable), so component specs do not each restate them.

The endpoints themselves are in `standards/api_contract.md`; this document governs how the service
is built, configured, and run.

## 1. Glossary

| Term | Meaning |
|------|---------|
| **The binary** | The single compiled Go program that serves the JSON API and the embedded SPA. |
| **Embedded SPA** | The built frontend (HTML/JS/CSS) compiled *into* the binary's filesystem, served by it. |
| **Data dir** | The directory holding `feedler.db` (and its WAL/SHM sidecars); a mounted volume in Docker. |
| **Seed OPML** | An OPML file imported once on first run if present and not already seeded. |

## 2. Stack (the chosen HOW — binding at this level)

The implementer owns internal structure, but the technology choices below are the spec's; changing
any of them is a spec change (`start.md` §0), because they define how the app is built and run.

- **Backend:** Go (module `feedler`). HTTP routing via a small router with middleware for request
  id, real IP, panic recovery, and a request timeout. Feed parsing via a maintained RSS/Atom parser
  (gofeed-class). Full-text extraction via a readability library (go-shiori-class). HTML→Markdown for
  export bodies via a converter library.
- **Persistence:** **SQLite**, accessed through a **pure-Go, CGO-free** driver (modernc-class) so the
  binary builds with `CGO_ENABLED=0`. One file, WAL mode (§5).
- **Frontend:** TypeScript + React (function components + hooks), built with Vite, styled with
  Tailwind CSS. HTML sanitization via DOMPurify (§6).
- **Runtime image:** a minimal static base (alpine-class) with CA certificates and tzdata (the
  export's timezone math needs the zoneinfo database).

The dependency set is small and replaceable per-library as long as the behavior the component specs
require is preserved; the *categories* (Go backend, CGO-free SQLite, React/Vite/Tailwind frontend,
sanitizer, feed parser, readability, html→md) are binding.

## 3. The single-binary, single-port rule (binding)

1. **One process serves everything.** The binary exposes exactly one HTTP listener on one port. That
   listener serves:
   - `/api/*` → the JSON API (`api_contract.md`);
   - `/a/{id}` → the deep-link redirect (to the SPA, focused on article `id`);
   - everything else → the **embedded SPA**, with an **`index.html` fallback** for any unmatched path
     so client-side routing works (a request for an unknown path that is not a real asset serves
     `index.html`, not a 404).
2. **The SPA is embedded.** The frontend is built and compiled into the binary; the binary serves it
   from its embedded filesystem. There is no separately running frontend server in production. (A
   Vite dev server proxying `/api` and `/a` to the binary is a development convenience only and is
   not part of the deployable.)
3. **Asset caching:** content-hashed built assets are served `immutable` with a long max-age;
   `index.html` and other non-hashed paths are served `no-cache` so a new build is picked up.
4. **No second exposed port, ever.** If a future feature seems to need one, that is a spec change.

## 4. Configuration (binding env-var contract)

All configuration is via environment variables, all optional with sane defaults. The **names and
defaults are binding** (the operator's compose file and the README depend on them):

| Variable | Default | Meaning |
|---|---|---|
| `FEEDLER_PORT` | `8473` | HTTP port the binary listens on inside the container. |
| `FEEDLER_DATA_DIR` | `/data` (Docker) · `./data` (bare) | Directory for `feedler.db`. Created on startup if missing. |
| `FEEDLER_PUBLIC_BASE_URL` | `http://localhost:<port>` | The externally reachable base URL; used to build the **"in reader" deep-links in exports** (`export_spec`). |
| `FEEDLER_REFRESH_INTERVAL_MINUTES` | `30` | Background refresh cadence; values `< 1` are coerced to the default. |
| `FEEDLER_SEED_OPML` | unset (Docker image sets `/seed/Feeds.opml`) | Path to an OPML file imported once on first run if present and the `seeded` meta flag is unset. |

There are **no other configuration surfaces** on the server — no config file, no admin settings
endpoint. Client preferences (theme, reading settings) are browser-local (`settings_spec`) and are
deliberately not server config.

## 5. Persistence rules (binding)

- One SQLite file, `feedler.db`, in the data dir, opened in **WAL** mode with **foreign keys on** and
  a **busy timeout** (~5s) so concurrent reads during a refresh don't error.
- **Single writer:** the DB connection pool is capped at one open connection — SQLite is happiest
  with a single writer, and the fetcher's concurrency is on the network side, not the write side.
- The schema (`architecture.md` §3) is created idempotently on startup (`CREATE TABLE IF NOT
  EXISTS …`); an existing `feedler.db` from a prior version must still open. Schema changes are
  additive and forgiving; a destructive migration is a loud spec change.
- **The DB file must be writable.** The runtime must guarantee write access to `feedler.db` even
  across container-runtime uid-mapping shifts (notably rootless Podman on macOS, where a bind-mounted
  file can appear owned by an unmapped uid). The deployable self-heals this at startup — probe the DB
  for real read-write access and, if it is not writable, take ownership by copy-replacing it and
  discarding the WAL/SHM sidecars (SQLite recreates them) — *before* the binary opens it. A reader
  that silently fails writes ("attempt to write a readonly database") is a broken reader.

## 6. Security posture (binding)

Feedler has no auth by design (single-user, local — `architecture.md` P2), so its security surface is
narrow but real:

1. **All third-party HTML is untrusted and sanitized before rendering.** Feed `content`/`summary` and
   readability `full_content` are rendered as HTML in the reading pane — they MUST be passed through a
   sanitizer (DOMPurify) on the client before insertion into the DOM. No raw `innerHTML` of feed
   data, ever.
2. **Every link inside rendered article HTML opens in a new tab** with `rel="noopener noreferrer"`
   (and `target="_blank"`), so a malicious or ordinary article link cannot navigate away from (or
   tamper with) the single-page reader.
3. **Outbound fetch limits.** Feed and article fetches set a timeout, a descriptive `User-Agent`, and
   a **response-size cap** (feed bodies and full-text pages are read through a limited reader — feeds
   on the order of tens of MB, article pages similar) so a hostile or runaway origin cannot exhaust
   memory.
4. **No secrets.** Feedler stores no credentials and holds no API keys. There is nothing to leak.
5. **No PII, no telemetry.** Logs are operational only (refresh stats, feed errors) and contain no
   tracking. There is no analytics or phone-home.

Because there is no auth, the operator is responsible for not exposing the port to a hostile network;
the README states this. Feedler does not add an auth layer to compensate — that would contradict the
vision (a non-goal).

## 7. HTTP conventions (binding shape; endpoints in `api_contract.md`)

- All API responses are JSON (`Content-Type: application/json; charset=utf-8`), except the export
  endpoint, which returns `text/markdown`.
- The **error shape** is a JSON object `{ "error": "<message>" }` with an appropriate 4xx/5xx status.
- Status-code conventions: `200` success; `201` resource created (add feed); `202` accepted for an
  async job started (refresh-all); `400` bad input; `404` not found; `5xx` server/upstream failure
  (e.g. `502` when a full-text upstream fetch fails). Specific codes per endpoint are in
  `api_contract.md`.
- A panic in a handler is recovered into a `500`, never a crash. A request has a bounded timeout.

## 8. Build & deployment (binding)

The implementation and its build inputs — the `backend/` and `frontend/` source trees, the
`Dockerfile`, the `docker-compose.yml`, and the seed OPML — live under **`workspace/`** (the
disposable implementation mirror of `specs/` — `architecture.md` §4); `docker compose` is run from
there.

- **Multi-stage Docker build**, no host tooling required beyond Docker:
  1. **Frontend stage** — install JS deps (cached) and `npm run build` the SPA to a `dist/`.
  2. **Backend stage** — copy the Go source and the built `dist/` into the location the binary embeds
     from, resolve Go deps, and `CGO_ENABLED=0 go build` a static binary.
  3. **Runtime stage** — a minimal static image with CA certs + tzdata, the binary, the entrypoint,
     and the bundled seed OPML; expose the port, declare the data volume.
- **`docker compose up --build`** is the entire bring-up and the universal acceptance gate. The
  compose file: one service, the configured port published, the data dir mounted as a volume, the
  seed OPML mounted read-only, the binding env vars set, and a **healthcheck** that hits
  `/api/health`.
- **Entrypoint** performs the DB-writability self-heal (§5) and then execs the binary.
- **Graceful shutdown:** on `SIGINT`/`SIGTERM` the binary stops accepting connections and shuts the
  HTTP server down within a bounded timeout; the scheduler stops with the process context.
- **`docker compose down -v`** deletes the data volume and therefore all Feedler state — the
  documented clean-reset path.

## 9. Risk & Audit (whole app)

- **Largest risk: silent write failure.** If the DB is not writable, refreshes and read-marks fail
  invisibly — §5's self-heal and a truthful startup log are the mitigation; verify writes succeed
  after first boot.
- **Second risk: unsanitized HTML.** A feed could carry script or hostile markup — §6.1/§6.2 are the
  mitigation and are non-negotiable; verify the sanitizer is on the render path for both content
  modes.
- **Politeness risk:** a misconfigured interval or a missing conditional-GET path could hammer
  origins — `ingestion_spec` owns the fetch behavior; verify `304`s occur on unchanged feeds.
- **Audit:** the system is auditable by inspection of the one SQLite file and the operational logs;
  there is no hidden state. Refresh outcomes are queryable (`/api/feeds/refresh-status`).

## 10. Deployment & Retirement

- **Deploy:** the operator edits `docker-compose.yml` env vars if needed and runs
  `docker compose up --build`. Upgrading is `up --build` again; the embedded SPA and binary are
  replaced atomically and the DB file persists.
- **Back up:** copy the data dir (the `feedler.db*` files) while the container is stopped, or rely on
  WAL-checkpointed copies.
- **Retire:** `docker compose down -v` removes the container and the data volume; nothing else exists
  to clean up. The operator's exports (if any) are theirs and live outside Feedler.

## 11. Testing floor

- The acceptance gate is `docker compose up --build` → the four QA layers (`start.md` §4) pass.
- Where a transformation has a defined right answer, it is unit-testable from the spec's worked
  examples — the **OPML folder-flattening** (`ingestion_spec`), the **export item format and
  timezone day boundaries** (`export_spec`), and the **conditional-GET / dedup** behavior
  (`ingestion_spec`). Those are the highest-value tests; a smoke run of the primary flows covers the
  rest.

## 12. Deliverables checklist (for `develop feedler` infrastructure)

- [ ] One Go binary serving `/api/*`, `/a/{id}`, and the embedded SPA with `index.html` fallback on a
      single configurable port (§3).
- [ ] CGO-free build (`CGO_ENABLED=0`); SQLite via a pure-Go driver; WAL + single writer + busy
      timeout + foreign keys (§5).
- [ ] All five env vars honored with the exact names and defaults (§4).
- [ ] Multi-stage Dockerfile (FE build → Go embed build → minimal runtime) and a `docker-compose.yml`
      with the published port, data volume, seed mount, env, and `/api/health` healthcheck (§8).
- [ ] Entrypoint DB-writability self-heal; graceful shutdown on signals (§5, §8).
- [ ] HTML sanitization on both render paths and external-link hardening (§6).
- [ ] Outbound fetch timeouts, User-Agent, and size caps (§6.3).
- [ ] `/api/health` truthful; error shape `{error}` consistent (§7).
- [ ] `down -v` wipes; `up --build` re-seeds (the reset lifecycle, `architecture.md` §6).
