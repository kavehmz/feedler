package api

import (
	"context"
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
	go func() { _, _ = s.Fetcher.RefreshAll(context.Background()) }()
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

	// Scope (sidebar selection): folder= or feed=. A PRESENT folder param —
	// even empty — is a folder scope; folder="" selects the Uncategorized
	// (no-folder) bucket (export_spec §5.1, api_contract §6). An ABSENT folder
	// param means no folder narrowing.
	if q.Has("folder") {
		v := q.Get("folder")
		opts.Folder = &v
	}
	if v := q.Get("feed"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			opts.FeedID = &id
		}
	}

	// Range/timezone window: day boundaries are drawn in the operator's timezone
	// (export_spec §4; architecture P8/invariant 5). The pure math lives in the
	// export package so it is unit-testable (engineering_standard §11).
	loc := export.ResolveTZ(q.Get("tz"))
	now := time.Now()
	opts.From, opts.To = export.Window(rng, from, to, loc, now)

	out, err := export.Build(r.Context(), s.DB, opts)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}

	// Download filename is named for the operator's current calendar day (export_spec §10.5).
	filename := "feedler-" + now.In(loc).Format("2006-01-02") + ".md"
	disp := r.URL.Query().Get("disposition")
	if disp == "attachment" {
		w.Header().Set("Content-Disposition", "attachment; filename=\""+filename+"\"")
	}
	w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	_, _ = w.Write([]byte(out))
}
