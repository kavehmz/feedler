package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"feedler/internal/api"
	"feedler/internal/db"
	"feedler/internal/feeds"
	"feedler/internal/readability"
	"feedler/internal/scheduler"
)

//go:embed all:static
var embeddedStatic embed.FS

func main() {
	dataDir := envOr("FEEDLER_DATA_DIR", "./data")
	seedOPML := envOr("FEEDLER_SEED_OPML", "")
	port := envOr("FEEDLER_PORT", "8080")
	baseURL := envOr("FEEDLER_PUBLIC_BASE_URL", "http://localhost:"+port)
	refreshMin, _ := strconv.Atoi(envOr("FEEDLER_REFRESH_INTERVAL_MINUTES", "30"))
	if refreshMin < 1 {
		refreshMin = 30
	}

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatalf("mkdir data: %v", err)
	}

	conn, err := db.Open(dataDir)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer conn.Close()

	// First-run OPML seed
	if seedOPML != "" {
		seeded, _, _ := db.GetMeta(conn, "seeded")
		if seeded != "1" {
			if _, err := os.Stat(seedOPML); err == nil {
				log.Printf("seeding feeds from %s", seedOPML)
				f, err := os.Open(seedOPML)
				if err == nil {
					parsed, err := feeds.ParseOPML(f)
					f.Close()
					if err != nil {
						log.Printf("seed parse: %v", err)
					} else {
						ins, upd, skip, err := feeds.ImportOPML(conn, parsed)
						if err != nil {
							log.Printf("seed import: %v", err)
						} else {
							log.Printf("seed: inserted=%d updated=%d skipped=%d", ins, upd, skip)
							_ = db.SetMeta(conn, "seeded", "1")
						}
					}
				}
			} else {
				log.Printf("seed opml not found: %s", seedOPML)
			}
		}
	}

	staticFS, err := fs.Sub(embeddedStatic, "static")
	if err != nil {
		log.Fatalf("static sub: %v", err)
	}
	// Sanity check: does index.html exist? (If not, the dev didn't build the FE.)
	if _, err := staticFS.Open("index.html"); err != nil {
		log.Printf("warning: embedded static/index.html missing — frontend may not have been built")
	}

	fetcher := feeds.NewFetcher(conn)
	reader := readability.New(conn)

	srv := &api.Server{
		DB:       conn,
		Fetcher:  fetcher,
		Reader:   reader,
		StaticFS: staticFS,
		BaseURL:  baseURL,
	}

	router := api.NewRouter(srv)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	scheduler.Run(ctx, fetcher, time.Duration(refreshMin)*time.Minute)

	httpSrv := &http.Server{
		Addr:              ":" + port,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Printf("feedler: listening on :%s (data=%s, base=%s)", port, filepath.Clean(dataDir), baseURL)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	<-ctx.Done()
	log.Printf("shutting down")
	shutCtx, c2 := context.WithTimeout(context.Background(), 10*time.Second)
	defer c2()
	_ = httpSrv.Shutdown(shutCtx)
}

func envOr(k, def string) string {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	return v
}
