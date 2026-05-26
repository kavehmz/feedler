package api

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"feedler/internal/export"
	"feedler/internal/feeds"
)

func (s *Server) importOPML(w http.ResponseWriter, r *http.Request) {
	defer r.Body.Close()

	var reader io.Reader = r.Body
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "multipart/form-data") {
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			writeErr(w, 400, err.Error())
			return
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			writeErr(w, 400, "missing 'file' field")
			return
		}
		defer file.Close()
		reader = file
	}

	parsed, err := feeds.ParseOPML(reader)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	ins, upd, skip, err := feeds.ImportOPML(s.DB, parsed)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"inserted": ins, "updated": upd, "skipped": skip,
	})
	go func() { _, _ = s.Fetcher.RefreshAll(r.Context()) }()
}

func (s *Server) exportMarkdown(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	rng := q.Get("range") // today | yesterday | week | all | custom
	from := q.Get("from")
	to := q.Get("to")
	filter := q.Get("filter")
	group := q.Get("group")
	if group == "" {
		group = "feed"
	}
	withBody := q.Get("body") != "0"

	opts := export.Options{
		Filter:   filter,
		GroupBy:  group,
		BaseURL:  s.BaseURL,
		WithBody: withBody,
	}

	// Scope (sidebar selection): folder= or feed=
	if v := q.Get("folder"); v != "" {
		opts.Folder = v
	}
	if v := q.Get("feed"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			opts.FeedID = &id
		}
	}

	// Timezone for "today"/"week" boundaries. Accepts IANA name (Europe/Berlin)
	// or "local". Falls back to the server's location (UTC in the container).
	loc := time.Local
	if tz := q.Get("tz"); tz != "" && tz != "local" {
		if l, err := time.LoadLocation(tz); err == nil {
			loc = l
		}
	}
	now := time.Now().In(loc)
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)

	switch rng {
	case "today":
		f := startOfToday
		t := f.Add(24 * time.Hour)
		opts.From, opts.To = &f, &t
	case "yesterday":
		t := startOfToday
		f := t.Add(-24 * time.Hour)
		opts.From, opts.To = &f, &t
	case "week":
		f := startOfToday.Add(-6 * 24 * time.Hour)
		t := startOfToday.Add(24 * time.Hour)
		opts.From, opts.To = &f, &t
	case "month":
		f := startOfToday.Add(-29 * 24 * time.Hour)
		t := startOfToday.Add(24 * time.Hour)
		opts.From, opts.To = &f, &t
	case "all":
		// no range
	case "custom", "":
		if from != "" {
			if t, err := time.Parse("2006-01-02", from); err == nil {
				opts.From = &t
			}
		}
		if to != "" {
			if t, err := time.Parse("2006-01-02", to); err == nil {
				t = t.Add(24 * time.Hour) // inclusive
				opts.To = &t
			}
		}
	}

	out, err := export.Build(r.Context(), s.DB, opts)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	filename := "feedler-" + now.Format("2006-01-02") + ".md"
	disp := r.URL.Query().Get("disposition")
	if disp == "attachment" {
		w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	_, _ = w.Write([]byte(out))
}
