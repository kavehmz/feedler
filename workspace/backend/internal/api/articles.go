package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"feedler/internal/models"
)

func (s *Server) listArticles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	feedID := q.Get("feed")
	folder := q.Get("folder")
	filter := q.Get("filter") // unread|all|starred
	search := strings.TrimSpace(q.Get("search"))
	limit := atoiDefault(q.Get("limit"), 50)
	if limit > 200 {
		limit = 200
	}
	offset := atoiDefault(q.Get("offset"), 0)

	var conds []string
	var args []any

	if feedID != "" {
		conds = append(conds, "a.feed_id = ?")
		args = append(args, feedID)
	}
	// A PRESENT folder param — even empty — narrows to that folder; folder=""
	// matches the Uncategorized (no-folder) feeds (api_contract §5). An ABSENT
	// folder param means no folder narrowing. q.Get can't distinguish the two,
	// so key on presence via q.Has.
	if q.Has("folder") {
		conds = append(conds, "COALESCE(f.folder,'') = ?")
		args = append(args, folder)
	}
	switch filter {
	case "unread":
		conds = append(conds, "a.is_read = 0")
	case "starred":
		conds = append(conds, "a.is_starred = 1")
	case "read":
		conds = append(conds, "a.is_read = 1")
	}
	if search != "" {
		conds = append(conds, "(a.title LIKE ? OR a.summary LIKE ?)")
		args = append(args, "%"+search+"%", "%"+search+"%")
	}

	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	// Total
	var total int
	totalQ := "SELECT COUNT(*) FROM articles a JOIN feeds f ON f.id = a.feed_id " + where
	if err := s.DB.QueryRowContext(r.Context(), totalQ, args...).Scan(&total); err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	listQ := `SELECT a.id, a.feed_id, f.title, COALESCE(f.folder,''),
		COALESCE(a.guid,''), COALESCE(a.title,''), COALESCE(a.link,''), COALESCE(a.author,''),
		COALESCE(a.summary,''), a.published_at, a.fetched_at,
		a.is_read, a.is_starred
		FROM articles a JOIN feeds f ON f.id = a.feed_id
		` + where + `
		ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
		LIMIT ? OFFSET ?`
	args2 := append(append([]any{}, args...), limit, offset)
	rows, err := s.DB.QueryContext(r.Context(), listQ, args2...)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	defer rows.Close()

	items := []models.Article{}
	for rows.Next() {
		var a models.Article
		var pub sql.NullTime
		if err := rows.Scan(&a.ID, &a.FeedID, &a.FeedTitle, &a.FeedFolder,
			&a.GUID, &a.Title, &a.Link, &a.Author, &a.Summary, &pub, &a.FetchedAt,
			&a.IsRead, &a.IsStarred); err != nil {
			writeErr(w, 500, err.Error())
			return
		}
		if pub.Valid {
			t := pub.Time
			a.PublishedAt = &t
		}
		items = append(items, a)
	}
	writeJSON(w, 200, map[string]any{
		"items": items,
		"total": total,
		"limit": limit,
		"offset": offset,
	})
}

func (s *Server) getArticle(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "bad id")
		return
	}
	var a models.Article
	var pub sql.NullTime
	var fullc sql.NullString
	err = s.DB.QueryRowContext(r.Context(), `
		SELECT a.id, a.feed_id, f.title, COALESCE(f.folder,''),
		       COALESCE(a.guid,''), COALESCE(a.title,''), COALESCE(a.link,''), COALESCE(a.author,''),
		       COALESCE(a.summary,''), COALESCE(a.content,''), a.full_content,
		       a.published_at, a.fetched_at, a.is_read, a.is_starred
		FROM articles a JOIN feeds f ON f.id = a.feed_id
		WHERE a.id = ?`, id).
		Scan(&a.ID, &a.FeedID, &a.FeedTitle, &a.FeedFolder,
			&a.GUID, &a.Title, &a.Link, &a.Author, &a.Summary, &a.Content, &fullc,
			&pub, &a.FetchedAt, &a.IsRead, &a.IsStarred)
	if err == sql.ErrNoRows {
		writeErr(w, 404, "not found")
		return
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if pub.Valid {
		t := pub.Time
		a.PublishedAt = &t
	}
	if fullc.Valid {
		a.FullContent = fullc.String
	}
	writeJSON(w, 200, a)
}

// articleID parses the {id} path param; a non-integer id is 400 "bad id"
// (api_contract §2 conventions).
func articleID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeErr(w, 400, "bad id")
		return 0, false
	}
	return id, true
}

func (s *Server) markRead(w http.ResponseWriter, r *http.Request) {
	id, ok := articleID(w, r)
	if !ok {
		return
	}
	if _, err := s.DB.ExecContext(r.Context(), `UPDATE articles SET is_read = 1 WHERE id = ?`, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) markUnread(w http.ResponseWriter, r *http.Request) {
	id, ok := articleID(w, r)
	if !ok {
		return
	}
	if _, err := s.DB.ExecContext(r.Context(), `UPDATE articles SET is_read = 0 WHERE id = ?`, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) toggleStar(w http.ResponseWriter, r *http.Request) {
	id, ok := articleID(w, r)
	if !ok {
		return
	}
	if _, err := s.DB.ExecContext(r.Context(),
		`UPDATE articles SET is_starred = CASE is_starred WHEN 1 THEN 0 ELSE 1 END WHERE id = ?`, id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	var v bool
	_ = s.DB.QueryRow(`SELECT is_starred FROM articles WHERE id = ?`, id).Scan(&v)
	writeJSON(w, 200, map[string]bool{"is_starred": v})
}

func (s *Server) fetchFull(w http.ResponseWriter, r *http.Request) {
	id, ok := articleID(w, r)
	if !ok {
		return
	}
	html, err := s.Reader.Fetch(r.Context(), id)
	if err != nil {
		writeErr(w, 502, err.Error())
		return
	}
	writeJSON(w, 200, map[string]string{"html": html})
}

func (s *Server) markAllRead(w http.ResponseWriter, r *http.Request) {
	var body struct {
		FeedID *int64  `json:"feed_id"`
		Folder *string `json:"folder"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	var (
		res sql.Result
		err error
	)
	switch {
	case body.FeedID != nil:
		res, err = s.DB.ExecContext(r.Context(), `UPDATE articles SET is_read = 1 WHERE feed_id = ? AND is_read = 0`, *body.FeedID)
	case body.Folder != nil:
		res, err = s.DB.ExecContext(r.Context(),
			`UPDATE articles SET is_read = 1
			 WHERE is_read = 0 AND feed_id IN (SELECT id FROM feeds WHERE COALESCE(folder,'') = ?)`, *body.Folder)
	default:
		res, err = s.DB.ExecContext(r.Context(), `UPDATE articles SET is_read = 1 WHERE is_read = 0`)
	}
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	n, _ := res.RowsAffected()
	writeJSON(w, 200, map[string]any{"marked": n})
}

func atoiDefault(s string, d int) int {
	if s == "" {
		return d
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return d
	}
	return v
}
