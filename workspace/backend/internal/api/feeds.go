package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"feedler/internal/models"
)

func (s *Server) listFeeds(w http.ResponseWriter, r *http.Request) {
	rows, err := s.DB.QueryContext(r.Context(), `
		SELECT f.id, f.xml_url, COALESCE(f.html_url,''), f.title, COALESCE(f.folder,''),
		       f.last_fetched_at, COALESCE(f.last_error,''),
		       (SELECT COUNT(*) FROM articles a WHERE a.feed_id = f.id AND a.is_read = 0) AS unread
		FROM feeds f
		ORDER BY f.folder COLLATE NOCASE, f.title COLLATE NOCASE
	`)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()

	folderMap := map[string]*models.Folder{}
	var folderOrder []string
	totalUnread := 0

	for rows.Next() {
		var f models.Feed
		var last sql.NullTime
		if err := rows.Scan(&f.ID, &f.XMLURL, &f.HTMLURL, &f.Title, &f.Folder, &last, &f.LastError, &f.UnreadCount); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if last.Valid {
			t := last.Time
			f.LastFetchedAt = &t
		}
		totalUnread += f.UnreadCount
		key := f.Folder
		if key == "" {
			key = "Uncategorized"
		}
		fol, ok := folderMap[key]
		if !ok {
			fol = &models.Folder{Name: key}
			folderMap[key] = fol
			folderOrder = append(folderOrder, key)
		}
		fol.UnreadCount += f.UnreadCount
		fol.Feeds = append(fol.Feeds, f)
	}

	// total_starred = count of ALL starred articles, read or unread (api_contract §4).
	var totalStarred int
	_ = s.DB.QueryRow(`SELECT COUNT(*) FROM articles WHERE is_starred=1`).Scan(&totalStarred)

	// Folders sorted case-insensitively (api_contract §4: "folder-then-title,
	// case-insensitive"); the display name "Uncategorized" sorts among the rest.
	sort.SliceStable(folderOrder, func(i, j int) bool {
		return strings.ToLower(folderOrder[i]) < strings.ToLower(folderOrder[j])
	})
	folders := make([]models.Folder, 0, len(folderOrder))
	for _, k := range folderOrder {
		folders = append(folders, *folderMap[k])
	}
	writeJSON(w, 200, map[string]any{
		"folders":       folders,
		"total_unread":  totalUnread,
		"total_starred": totalStarred,
	})
}

func (s *Server) refreshAll(w http.ResponseWriter, r *http.Request) {
	// Use a fresh background context — r.Context() is cancelled the moment we
	// return the 202, which would kill the goroutine before it does any work.
	go func() {
		_, _ = s.Fetcher.RefreshAll(context.Background())
	}()
	writeJSON(w, 202, map[string]string{"status": "started"})
}

func (s *Server) refreshOne(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	n, err := s.Fetcher.RefreshOne(r.Context(), id)
	if err != nil {
		// An unknown feed id has no row to record an error on (ingestion_spec §8.3).
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, 404, "not found")
			return
		}
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"new_articles": n})
}

func (s *Server) refreshStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.Fetcher.LastStat())
}

func (s *Server) deleteFeed(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	if _, err := s.DB.ExecContext(r.Context(), `DELETE FROM feeds WHERE id = ?`, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"status": "deleted"})
}

func (s *Server) addFeed(w http.ResponseWriter, r *http.Request) {
	var body struct {
		XMLURL string `json:"xml_url"`
		Title  string `json:"title"`
		Folder string `json:"folder"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	body.XMLURL = strings.TrimSpace(body.XMLURL)
	body.Title = strings.TrimSpace(body.Title)
	body.Folder = strings.TrimSpace(body.Folder)
	if body.XMLURL == "" {
		writeErr(w, 400, "xml_url required")
		return
	}
	// When no title is supplied, probe the feed once (fetch + parse, no DB write)
	// to discover its real title and site link; fall back to the URL on failure
	// (ingestion_spec §7, api_contract §4).
	htmlURL := ""
	if body.Title == "" {
		title, hu := s.Fetcher.Probe(r.Context(), body.XMLURL)
		if title != "" {
			body.Title = title
		} else {
			body.Title = body.XMLURL
		}
		htmlURL = hu
	}

	// Upsert by xml_url (architecture §3 invariant 1: never a duplicate). On an
	// existing feed, move its title/folder; overwrite html_url only when we have a
	// non-empty one (a failed probe or a title-only add must not wipe a good link).
	if _, err := s.DB.ExecContext(r.Context(),
		`INSERT INTO feeds(xml_url, html_url, title, folder) VALUES(?,?,?,?)
		 ON CONFLICT(xml_url) DO UPDATE SET
		   html_url = CASE WHEN excluded.html_url <> '' THEN excluded.html_url ELSE feeds.html_url END,
		   title    = excluded.title,
		   folder   = excluded.folder`,
		body.XMLURL, htmlURL, body.Title, body.Folder); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	// Resolve the id by xml_url — robust against last_insert_rowid() being stale on
	// an ON CONFLICT update path.
	var id int64
	if err := s.DB.QueryRowContext(r.Context(), `SELECT id FROM feeds WHERE xml_url = ?`, body.XMLURL).Scan(&id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	// Kick an immediate background refresh so articles appear without waiting for
	// the scheduler interval. Fresh context — r.Context() dies with the response.
	go func(fid int64) { _, _ = s.Fetcher.RefreshOne(context.Background(), fid) }(id)
	writeJSON(w, 201, map[string]any{"id": id, "title": body.Title, "folder": body.Folder})
}

func (s *Server) updateFeed(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	var body struct {
		Title  *string `json:"title"`
		Folder *string `json:"folder"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	if body.Title == nil && body.Folder == nil {
		writeErr(w, 400, "nothing to update")
		return
	}
	parts := []string{}
	args := []any{}
	if body.Title != nil {
		parts = append(parts, "title = ?")
		args = append(args, strings.TrimSpace(*body.Title))
	}
	if body.Folder != nil {
		parts = append(parts, "folder = ?")
		args = append(args, strings.TrimSpace(*body.Folder))
	}
	args = append(args, id)
	q := "UPDATE feeds SET " + strings.Join(parts, ", ") + " WHERE id = ?"
	if _, err := s.DB.ExecContext(r.Context(), q, args...); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
