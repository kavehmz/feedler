package api

import (
	"database/sql"
	"encoding/json"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"feedler/internal/feeds"
	"feedler/internal/readability"
)

type Server struct {
	DB        *sql.DB
	Fetcher   *feeds.Fetcher
	Reader    *readability.Service
	StaticFS  fs.FS
	BaseURL   string
}

func NewRouter(s *Server) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "time": time.Now().UTC()})
		})

		r.Get("/feeds", s.listFeeds)
		r.Post("/feeds", s.addFeed)
		r.Post("/feeds/refresh", s.refreshAll)
		r.Post("/feeds/{id}/refresh", s.refreshOne)
		r.Patch("/feeds/{id}", s.updateFeed)
		r.Delete("/feeds/{id}", s.deleteFeed)
		r.Get("/feeds/refresh-status", s.refreshStatus)

		r.Get("/articles", s.listArticles)
		r.Get("/articles/{id}", s.getArticle)
		r.Post("/articles/{id}/read", s.markRead)
		r.Post("/articles/{id}/unread", s.markUnread)
		r.Post("/articles/{id}/star", s.toggleStar)
		r.Get("/articles/{id}/full", s.fetchFull)
		r.Post("/articles/mark-all-read", s.markAllRead)

		r.Post("/import", s.importOPML)
		r.Get("/export", s.exportMarkdown)
	})

	// /a/{id} — short reader link. Redirect to SPA route with article id.
	r.Get("/a/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		http.Redirect(w, r, "/?article="+id, http.StatusFound)
	})

	// Static SPA + asset serving. SPA fallback for unknown paths.
	r.Handle("/*", spaHandler(s.StaticFS))
	return r
}

// spaHandler serves embedded static assets and falls back to index.html for
// unknown paths so client-side routing works.
func spaHandler(staticFS fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(staticFS))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to open the requested path; if it's a directory or missing, serve index.html.
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		f, err := staticFS.Open(p)
		if err != nil {
			// fallback to index.html
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		stat, _ := f.Stat()
		f.Close()
		if stat != nil && stat.IsDir() {
			r2 := r.Clone(r.Context())
			r2.URL.Path = "/"
			fileServer.ServeHTTP(w, r2)
			return
		}
		// Cache-control for built assets (vite hashes filenames in /assets/)
		if strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "no-cache")
		}
		fileServer.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

