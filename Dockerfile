# syntax=docker/dockerfile:1.6

# ─── Stage 1: build the React frontend ───────────────────────────────────────
FROM node:20-alpine AS fe
WORKDIR /fe
COPY frontend/package.json frontend/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: build the Go backend with embedded FE ──────────────────────────
FROM golang:1.22-alpine AS be
WORKDIR /src
RUN apk add --no-cache git ca-certificates

# Source + embedded static. We copy everything before `go mod tidy` because
# tidy needs to see the import graph to compute the dependency set / sums.
COPY backend/ ./
COPY --from=fe /fe/dist ./static

# `go mod tidy` resolves deps and writes go.sum so the subsequent build can
# run in the default -mod=readonly. The cache mounts keep this fast on
# rebuilds. On hosts without BuildKit (e.g. podman-compose without buildkit)
# the mounts are ignored but the build still works.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build \
        -ldflags="-s -w" \
        -trimpath \
        -o /out/feedler .

# ─── Stage 3: minimal runtime ────────────────────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata wget && mkdir -p /data

COPY --from=be /out/feedler /usr/local/bin/feedler
COPY Feeds.opml /seed/Feeds.opml

ENV FEEDLER_DATA_DIR=/data \
    FEEDLER_SEED_OPML=/seed/Feeds.opml \
    FEEDLER_PORT=8080 \
    FEEDLER_PUBLIC_BASE_URL=http://localhost:8080 \
    FEEDLER_REFRESH_INTERVAL_MINUTES=30

# Run as root inside the container. Under rootless Podman the in-container
# root maps to the host invoking user, so this still produces host-owned
# files in ./data with no perms gymnastics. Under Docker on Linux you can
# override with `user:` in docker-compose.yml if you prefer.
VOLUME /data
EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/feedler"]
