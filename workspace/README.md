# workspace/ — the Feedler implementation (built from `../specs`)

This directory receives the **spec-driven build** of Feedler. It is the disposable implementation
mirror of `../specs/` (see `../specs/architecture.md` §4 and `../specs/start.md`). It is intentionally
empty until built.

## To build it from the specs

```
Read specs/start.md. develop feedler
```

The build authors `backend/`, `frontend/`, `Dockerfile`, and `docker-compose.yml` here from the spec
suite, then `cd workspace && docker compose up --build`.

## Build parameters for this instance (chosen so it coexists with `../old` on :8473)

- **Host port:** `8474` (old + 1). `../old` keeps `:8473`.
- **Public base URL:** `http://localhost:8474` (used for the export "in reader" deep-links).
- **Container / image names:** distinct from the original (e.g. `feedler-new`) so both can run at once.
- **Data:** a fresh `workspace/data/` (gitignored), re-seeded on first run from the canonical
  `../Feeds.opml` — a clean rebuild, independent of `../old/data/` (which holds the original read state).
- **Everything else** per `../specs/standards/engineering_standard.md`: single Go binary, single port,
  embedded SPA, CGO-free SQLite (WAL), the env-var contract, the multi-stage Docker build.

## Compare the two side-by-side

```
cd ../old       && docker compose up            # original, :8473, your existing read state
cd ../workspace && docker compose up --build     # spec-rebuild, :8474, fresh re-seed
```
