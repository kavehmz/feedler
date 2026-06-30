package export

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	md "github.com/JohannesKaufmann/html-to-markdown"
)

type Options struct {
	From     *time.Time
	To       *time.Time
	Filter   string // "all" | "read" | "unread" | "starred"
	GroupBy  string // "feed" | "chrono"
	BaseURL  string // e.g. http://localhost:8473  (used for "in reader" links)
	WithBody bool   // include summary excerpt
	FeedID   *int64 // narrow to one feed
	Folder   string // narrow to one folder
}

type row struct {
	ID         int64
	FeedTitle  string
	Folder     string
	Title      string
	Link       string
	Summary    string
	Content    string
	Author     string
	Published  *time.Time
	IsRead     bool
	IsStarred  bool
}

func Build(ctx context.Context, db *sql.DB, opts Options) (string, error) {
	q := strings.Builder{}
	q.WriteString(`SELECT a.id, COALESCE(f.title,''), COALESCE(f.folder,''),
		COALESCE(a.title,''), COALESCE(a.link,''), COALESCE(a.summary,''),
		COALESCE(a.content,''), COALESCE(a.author,''),
		a.published_at, a.is_read, a.is_starred
	FROM articles a JOIN feeds f ON f.id = a.feed_id
	WHERE 1=1`)
	var args []any

	if opts.From != nil {
		q.WriteString(` AND COALESCE(a.published_at, a.fetched_at) >= ?`)
		args = append(args, opts.From.UTC())
	}
	if opts.To != nil {
		q.WriteString(` AND COALESCE(a.published_at, a.fetched_at) < ?`)
		args = append(args, opts.To.UTC())
	}
	switch opts.Filter {
	case "read":
		q.WriteString(` AND a.is_read = 1`)
	case "unread":
		q.WriteString(` AND a.is_read = 0`)
	case "starred":
		q.WriteString(` AND a.is_starred = 1`)
	}
	if opts.FeedID != nil {
		q.WriteString(` AND a.feed_id = ?`)
		args = append(args, *opts.FeedID)
	}
	if opts.Folder != "" {
		q.WriteString(` AND COALESCE(f.folder,'') = ?`)
		args = append(args, opts.Folder)
	}
	q.WriteString(` ORDER BY COALESCE(a.published_at, a.fetched_at) DESC`)

	rows, err := db.QueryContext(ctx, q.String(), args...)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	var items []row
	for rows.Next() {
		var r row
		var pub sql.NullTime
		if err := rows.Scan(&r.ID, &r.FeedTitle, &r.Folder, &r.Title, &r.Link,
			&r.Summary, &r.Content, &r.Author, &pub, &r.IsRead, &r.IsStarred); err != nil {
			return "", err
		}
		if pub.Valid {
			t := pub.Time
			r.Published = &t
		}
		items = append(items, r)
	}

	var out strings.Builder
	header(&out, opts, len(items))

	switch opts.GroupBy {
	case "chrono":
		writeChrono(&out, items, opts)
	default:
		writeByFeed(&out, items, opts)
	}
	return out.String(), nil
}

func header(out *strings.Builder, opts Options, n int) {
	rangeLabel := "all time"
	if opts.From != nil && opts.To != nil {
		rangeLabel = fmt.Sprintf("%s → %s", opts.From.Format("2006-01-02"), opts.To.Add(-time.Second).Format("2006-01-02"))
	} else if opts.From != nil {
		rangeLabel = fmt.Sprintf("since %s", opts.From.Format("2006-01-02"))
	} else if opts.To != nil {
		rangeLabel = fmt.Sprintf("until %s", opts.To.Format("2006-01-02"))
	}
	fmt.Fprintf(out, "# Reads — %s\n\n", rangeLabel)
	fmt.Fprintf(out, "_%d articles · filter: %s · generated %s_\n\n",
		n, defaultStr(opts.Filter, "all"), time.Now().Format(time.RFC3339))
}

func writeByFeed(out *strings.Builder, items []row, opts Options) {
	// folder -> feed -> []row
	byFolder := map[string]map[string][]row{}
	for _, r := range items {
		folder := r.Folder
		if folder == "" {
			folder = "Uncategorized"
		}
		if _, ok := byFolder[folder]; !ok {
			byFolder[folder] = map[string][]row{}
		}
		byFolder[folder][r.FeedTitle] = append(byFolder[folder][r.FeedTitle], r)
	}
	folders := keys(byFolder)
	sort.Strings(folders)
	for _, folder := range folders {
		fmt.Fprintf(out, "## %s\n\n", folder)
		feedNames := keys(byFolder[folder])
		sort.Strings(feedNames)
		for _, fn := range feedNames {
			fmt.Fprintf(out, "### %s\n\n", fn)
			for _, r := range byFolder[folder][fn] {
				writeItem(out, r, opts)
			}
			out.WriteString("\n")
		}
	}
}

func writeChrono(out *strings.Builder, items []row, opts Options) {
	for _, r := range items {
		writeItem(out, r, opts)
	}
}

func writeItem(out *strings.Builder, r row, opts Options) {
	when := ""
	if r.Published != nil {
		when = r.Published.Format("2006-01-02 15:04")
	}
	star := ""
	if r.IsStarred {
		star = "⭐ "
	}
	readerLink := ""
	if opts.BaseURL != "" {
		readerLink = fmt.Sprintf(" · [in reader](%s/a/%d)", strings.TrimRight(opts.BaseURL, "/"), r.ID)
	}
	if opts.GroupBy == "chrono" {
		fmt.Fprintf(out, "- **%s%s** — _%s_  \n", star, escapeMD(r.Title), r.FeedTitle)
		if when != "" {
			fmt.Fprintf(out, "  %s · ", when)
		} else {
			out.WriteString("  ")
		}
		fmt.Fprintf(out, "[source](%s)%s\n", r.Link, readerLink)
	} else {
		fmt.Fprintf(out, "- **%s%s**", star, escapeMD(r.Title))
		if when != "" {
			fmt.Fprintf(out, " (_%s_)", when)
		}
		fmt.Fprintf(out, " — [source](%s)%s\n", r.Link, readerLink)
	}
	if opts.WithBody {
		body := r.Summary
		if body == "" {
			body = htmlToMD(r.Content, 1200)
		}
		body = strings.TrimSpace(body)
		if body != "" {
			fmt.Fprintf(out, "  > %s\n", indentBlock(body))
		}
	}
	out.WriteString("\n")
}

func escapeMD(s string) string {
	replacer := strings.NewReplacer(
		"*", "\\*",
		"_", "\\_",
		"[", "\\[",
		"]", "\\]",
	)
	return replacer.Replace(s)
}

func htmlToMD(html string, maxLen int) string {
	if html == "" {
		return ""
	}
	conv := md.NewConverter("", true, nil)
	m, err := conv.ConvertString(html)
	if err != nil {
		return ""
	}
	m = strings.TrimSpace(m)
	if maxLen > 0 && len(m) > maxLen {
		m = m[:maxLen] + "…"
	}
	return m
}

func indentBlock(s string) string {
	lines := strings.Split(s, "\n")
	for i, l := range lines {
		if i == 0 {
			continue
		}
		lines[i] = "  > " + l
	}
	return strings.Join(lines, "\n")
}

func defaultStr(v, d string) string {
	if v == "" {
		return d
	}
	return v
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
