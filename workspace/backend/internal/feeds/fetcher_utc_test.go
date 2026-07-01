package feeds

import (
	"database/sql"
	"testing"
	"time"

	"github.com/mmcdole/gofeed"
	_ "modernc.org/sqlite"
)

// TestInsertItemsStoresUTC guards architecture §3 invariant 5 ("timestamps are
// stored in UTC") against the real insertItems path. gofeed yields offset-bearing
// times for RFC822/offset feed dates; storing them verbatim breaks COALESCE
// ordering (invariant 4) and the export's UTC-bounded window filter, because the
// modernc/sqlite driver stores time as text and SQLite string-compares it.
func TestInsertItemsStoresUTC(t *testing.T) {
	db, err := sql.Open("sqlite", "file::memory:?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	mustExec(t, db, `CREATE TABLE feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, xml_url TEXT NOT NULL UNIQUE, html_url TEXT, title TEXT NOT NULL, folder TEXT, etag TEXT, last_modified TEXT, last_fetched_at TIMESTAMP, last_error TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`)
	mustExec(t, db, `CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, guid TEXT NOT NULL, title TEXT, link TEXT, author TEXT, summary TEXT, content TEXT, full_content TEXT, published_at TIMESTAMP, fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, is_read INTEGER DEFAULT 0, is_starred INTEGER DEFAULT 0, UNIQUE(feed_id, guid))`)
	mustExec(t, db, `INSERT INTO feeds(id, xml_url, title) VALUES (1, 'https://x/feed', 'X')`)

	f := &Fetcher{DB: db}

	// A feed item published at 2026-06-30T20:00:00-07:00 (== 2026-07-01T03:00:00Z).
	pubOffset := time.Date(2026, 6, 30, 20, 0, 0, 0, time.FixedZone("PDT", -7*3600))
	feed := &gofeed.Feed{Items: []*gofeed.Item{
		{GUID: "g1", Title: "Offset item", Link: "https://x/1", PublishedParsed: &pubOffset, Description: "d"},
	}}
	n, err := f.insertItems(1, feed)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("new count = %d, want 1", n)
	}

	var stored string
	if err := db.QueryRow(`SELECT published_at FROM articles WHERE guid='g1'`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	t.Logf("stored published_at = %q", stored)

	// Read back as an instant and confirm it is the correct UTC instant.
	var got time.Time
	if err := db.QueryRow(`SELECT published_at FROM articles WHERE guid='g1'`).Scan(&got); err != nil {
		t.Fatal(err)
	}
	want := time.Date(2026, 7, 1, 3, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("instant = %v, want %v", got.UTC(), want)
	}
	// The stored TEXT must be in UTC (offset +0000 / Z), not the source -0700,
	// so it string-compares correctly against UTC-stored fetched_at/bounds.
	if loc := got.Location().String(); loc != "UTC" && got.UTC() != got {
		// got.Location() may be a fixed zone if text carried an offset.
		if _, off := got.Zone(); off != 0 {
			t.Errorf("stored time carries non-UTC offset %d; want UTC (invariant 5)", off)
		}
	}
}

func mustExec(t *testing.T, db *sql.DB, q string) {
	t.Helper()
	if _, err := db.Exec(q); err != nil {
		t.Fatalf("exec %q: %v", q, err)
	}
}
