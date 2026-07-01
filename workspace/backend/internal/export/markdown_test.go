package export

import (
	"context"
	"database/sql"
	"regexp"
	"strconv"
	"testing"
	"time"

	"feedler/internal/db"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(t.TempDir())
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func addFeed(t *testing.T, conn *sql.DB, id int64, title, folder string) {
	t.Helper()
	_, err := conn.Exec(`INSERT INTO feeds(id, xml_url, html_url, title, folder) VALUES(?,?,?,?,?)`,
		id, "https://x.example/"+strconv.FormatInt(id, 10), "", title, folder)
	if err != nil {
		t.Fatalf("insert feed: %v", err)
	}
}

func addArticle(t *testing.T, conn *sql.DB, id, feedID int64, title, link, summary string, pub *time.Time, fetched time.Time, starred bool) {
	t.Helper()
	_, err := conn.Exec(
		`INSERT INTO articles(id, feed_id, guid, title, link, summary, content, published_at, fetched_at, is_starred)
		 VALUES(?,?,?,?,?,?,?,?,?,?)`,
		id, feedID, "g"+strconv.FormatInt(id, 10), title, link, summary, "", pub, fetched.UTC(), starred)
	if err != nil {
		t.Fatalf("insert article: %v", err)
	}
}

// The by-feed item format is binding (export_spec §6.2): the starred ⭐ prefix,
// the escaped title, the (_date_) parenthetical (omitted when undated), and the
// dual [source] / [in reader] links.
func TestBuild_ByFeed_BindingFormat(t *testing.T) {
	conn := newTestDB(t)
	addFeed(t, conn, 12, "The Cloudflare Blog", "Engineering")
	pub := time.Date(2026, 6, 29, 14, 22, 0, 0, time.UTC)
	older := time.Date(2026, 6, 28, 0, 0, 0, 0, time.UTC) // undated item's fetched_at, older → sorts after the dated one
	addArticle(t, conn, 4501, 12, "Eliminating cold starts", "https://blog.cloudflare.com/cold-starts", "", &pub, pub, true)
	addArticle(t, conn, 4502, 12, "A note with *emphasis* in the title", "https://blog.cloudflare.com/note", "", nil, older, false)

	out, err := Build(context.Background(), conn, Options{
		GroupBy: "feed", BaseURL: "https://reader.example.com", WithBody: false,
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	want := "## Engineering\n\n### The Cloudflare Blog\n\n" +
		"- **⭐ Eliminating cold starts** (_2026-06-29 14:22_) — [source](https://blog.cloudflare.com/cold-starts) · [in reader](https://reader.example.com/a/4501)\n\n" +
		"- **A note with \\*emphasis\\* in the title** — [source](https://blog.cloudflare.com/note) · [in reader](https://reader.example.com/a/4502)\n\n"
	if !contains(out, want) {
		t.Errorf("by-feed body mismatch.\n--- got ---\n%s\n--- want substring ---\n%s", out, want)
	}
}

// The chronological item format is binding (export_spec §6.3): two lines with a
// hard break (two trailing spaces), the feed title italic, and the undated variant
// whose continuation begins directly at [source].
func TestBuild_Chrono_BindingFormat(t *testing.T) {
	conn := newTestDB(t)
	addFeed(t, conn, 12, "The Cloudflare Blog", "Engineering")
	pub := time.Date(2026, 6, 29, 14, 22, 0, 0, time.UTC)
	older := time.Date(2026, 6, 28, 0, 0, 0, 0, time.UTC)
	addArticle(t, conn, 4501, 12, "Eliminating cold starts", "https://blog.cloudflare.com/cold-starts", "", &pub, pub, false)
	addArticle(t, conn, 4502, 12, "A note", "https://blog.cloudflare.com/note", "", nil, older, false)

	out, err := Build(context.Background(), conn, Options{
		GroupBy: "chrono", BaseURL: "https://reader.example.com", WithBody: false,
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	wantDated := "- **Eliminating cold starts** — _The Cloudflare Blog_  \n  2026-06-29 14:22 · [source](https://blog.cloudflare.com/cold-starts) · [in reader](https://reader.example.com/a/4501)\n"
	wantUndated := "- **A note** — _The Cloudflare Blog_  \n  [source](https://blog.cloudflare.com/note) · [in reader](https://reader.example.com/a/4502)\n"
	if !contains(out, wantDated) {
		t.Errorf("chrono dated item mismatch.\n--- got ---\n%s", out)
	}
	if !contains(out, wantUndated) {
		t.Errorf("chrono undated item mismatch.\n--- got ---\n%s", out)
	}
}

// The Body is an indented blockquote of the Summary (export_spec §6.4).
func TestBuild_Body_Blockquote(t *testing.T) {
	conn := newTestDB(t)
	addFeed(t, conn, 12, "The Cloudflare Blog", "Engineering")
	pub := time.Date(2026, 6, 29, 14, 22, 0, 0, time.UTC)
	addArticle(t, conn, 4501, 12, "Eliminating cold starts", "https://blog.cloudflare.com/cold-starts",
		"We rebuilt the scheduler so workers start in under a millisecond.", &pub, pub, false)

	out, err := Build(context.Background(), conn, Options{GroupBy: "feed", BaseURL: "https://reader.example.com", WithBody: true})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	want := "  > We rebuilt the scheduler so workers start in under a millisecond.\n"
	if !contains(out, want) {
		t.Errorf("body blockquote missing.\n--- got ---\n%s", out)
	}
}

// The header block is binding (export_spec §6.1): the # Reads — <range label>
// heading and the italic meta line; range-label cases for the four bound shapes.
func TestBuild_Header_RangeLabels(t *testing.T) {
	conn := newTestDB(t)
	// all time
	if out, _ := Build(context.Background(), conn, Options{GroupBy: "feed"}); !contains(out, "# Reads — all time\n\n_0 articles · filter: all · generated ") {
		t.Errorf("all-time header wrong:\n%s", out)
	}
	from := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 8, 0, 0, 0, 0, time.UTC) // exclusive upper → inclusive last day 06-07
	if out, _ := Build(context.Background(), conn, Options{GroupBy: "feed", From: &from, To: &to}); !contains(out, "# Reads — 2026-06-01 → 2026-06-07\n") {
		t.Errorf("both-bounds range label wrong:\n%s", out)
	}
	if out, _ := Build(context.Background(), conn, Options{GroupBy: "feed", From: &from}); !contains(out, "# Reads — since 2026-06-01\n") {
		t.Errorf("from-only range label wrong:\n%s", out)
	}
	if out, _ := Build(context.Background(), conn, Options{GroupBy: "feed", To: &to}); !contains(out, "# Reads — until 2026-06-08\n") {
		t.Errorf("to-only range label wrong:\n%s", out)
	}
	// filter echoed in the meta line
	if out, _ := Build(context.Background(), conn, Options{GroupBy: "feed", Filter: "unread"}); !contains(out, "· filter: unread ·") {
		t.Errorf("filter not echoed:\n%s", out)
	}
}

// The §4.4 binding conclusion, end-to-end through the SQL time comparison: an
// article at 2026-06-30T23:30:00Z lands on a DIFFERENT local day for a Berlin
// operator vs a UTC operator. Validates ResolveTZ + Window + the COALESCE bound.
func TestTimezoneDayBoundary(t *testing.T) {
	conn := newTestDB(t)
	addFeed(t, conn, 1, "F", "")
	pub := time.Date(2026, 6, 30, 23, 30, 0, 0, time.UTC)
	addArticle(t, conn, 1, 1, "edge", "https://x/1", "", &pub, pub, false)

	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Skipf("no tzdata for Europe/Berlin: %v", err)
	}

	count := func(loc *time.Location, now time.Time) int {
		f, to := Window("today", "", "", loc, now)
		out, err := Build(context.Background(), conn, Options{GroupBy: "feed", From: f, To: to})
		if err != nil {
			t.Fatalf("Build: %v", err)
		}
		return headerCount(t, out)
	}

	// Berlin, "today" on 2026-07-01 → article is in Berlin's 2026-07-01.
	if got := count(berlin, time.Date(2026, 7, 1, 12, 0, 0, 0, berlin)); got != 1 {
		t.Errorf("Berlin today 2026-07-01: got %d articles, want 1", got)
	}
	// Berlin, "today" on 2026-06-30 → NOT in window (Berlin's day ended 22:00Z).
	if got := count(berlin, time.Date(2026, 6, 30, 12, 0, 0, 0, berlin)); got != 0 {
		t.Errorf("Berlin today 2026-06-30: got %d articles, want 0", got)
	}
	// UTC, "today" on 2026-06-30 → in UTC's 2026-06-30.
	if got := count(time.UTC, time.Date(2026, 6, 30, 12, 0, 0, 0, time.UTC)); got != 1 {
		t.Errorf("UTC today 2026-06-30: got %d articles, want 1", got)
	}
}

// Named-range boundaries are local midnight in the operator's zone even when a
// DST transition falls inside the window (export_spec §4.1/§4.2, invariant 5). A
// fixed N*24h offset drifts an hour off midnight across a spring-forward; AddDate
// keeps the edge on the calendar-day boundary.
func TestWindow_NamedRange_DSTMidnight(t *testing.T) {
	berlin, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		t.Skipf("no tzdata for Europe/Berlin: %v", err)
	}
	// Berlin springs forward on 2026-03-29 (02:00→03:00). A `week` export on
	// 2026-04-01 back-dates 6 days to 2026-03-26, crossing that transition.
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, berlin)
	from, to := Window("week", "", "", berlin, now)
	if from == nil || to == nil {
		t.Fatal("week returned nil bounds")
	}
	fl := from.In(berlin)
	if fl.Hour() != 0 || fl.Minute() != 0 || fl.Second() != 0 {
		t.Errorf("week lower bound not at local midnight: %s", fl)
	}
	if y, m, d := fl.Date(); y != 2026 || m != time.March || d != 26 {
		t.Errorf("week lower bound date = %04d-%02d-%02d, want 2026-03-26", y, m, d)
	}
	tl := to.In(berlin) // upper bound = start of tomorrow, also local midnight
	if tl.Hour() != 0 || tl.Minute() != 0 || tl.Second() != 0 {
		t.Errorf("week upper bound not at local midnight: %s", tl)
	}
	if y, m, d := tl.Date(); y != 2026 || m != time.April || d != 2 {
		t.Errorf("week upper bound date = %04d-%02d-%02d, want 2026-04-02", y, m, d)
	}
}

var countRe = regexp.MustCompile(`_(\d+) articles`)

func headerCount(t *testing.T, digest string) int {
	t.Helper()
	m := countRe.FindStringSubmatch(digest)
	if m == nil {
		t.Fatalf("no article count in digest header:\n%s", digest)
	}
	n, _ := strconv.Atoi(m[1])
	return n
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
