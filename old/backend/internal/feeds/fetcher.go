package feeds

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/mmcdole/gofeed"
)

type Fetcher struct {
	DB         *sql.DB
	HTTPClient *http.Client
	UserAgent  string
	parser     *gofeed.Parser

	mu       sync.Mutex
	running  bool
	lastRun  time.Time
	lastStat RefreshStat
}

type RefreshStat struct {
	StartedAt   time.Time `json:"started_at"`
	FinishedAt  time.Time `json:"finished_at"`
	Feeds       int       `json:"feeds"`
	Succeeded   int       `json:"succeeded"`
	Failed      int       `json:"failed"`
	NewArticles int       `json:"new_articles"`
}

func NewFetcher(db *sql.DB) *Fetcher {
	return &Fetcher{
		DB: db,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		UserAgent: "Feedler/1.0 (+https://github.com/feedler)",
		parser:    gofeed.NewParser(),
	}
}

func (f *Fetcher) LastStat() RefreshStat {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastStat
}

// RefreshAll fetches every feed. Concurrency-limited.
func (f *Fetcher) RefreshAll(ctx context.Context) (RefreshStat, error) {
	f.mu.Lock()
	if f.running {
		f.mu.Unlock()
		return f.lastStat, fmt.Errorf("refresh already in progress")
	}
	f.running = true
	stat := RefreshStat{StartedAt: time.Now()}
	f.mu.Unlock()

	defer func() {
		f.mu.Lock()
		f.running = false
		stat.FinishedAt = time.Now()
		f.lastStat = stat
		f.lastRun = time.Now()
		f.mu.Unlock()
	}()

	rows, err := f.DB.QueryContext(ctx, `SELECT id, xml_url, etag, last_modified FROM feeds ORDER BY id`)
	if err != nil {
		return stat, err
	}
	type job struct {
		id           int64
		url          string
		etag         string
		lastModified string
	}
	var jobs []job
	for rows.Next() {
		var j job
		var etag, lm sql.NullString
		if err := rows.Scan(&j.id, &j.url, &etag, &lm); err != nil {
			rows.Close()
			return stat, err
		}
		j.etag = etag.String
		j.lastModified = lm.String
		jobs = append(jobs, j)
	}
	rows.Close()
	stat.Feeds = len(jobs)

	sem := make(chan struct{}, 8) // concurrency
	var wg sync.WaitGroup
	var mu sync.Mutex

	for _, j := range jobs {
		wg.Add(1)
		sem <- struct{}{}
		go func(j job) {
			defer wg.Done()
			defer func() { <-sem }()
			n, err := f.refreshOne(ctx, j.id, j.url, j.etag, j.lastModified)
			mu.Lock()
			if err != nil {
				stat.Failed++
			} else {
				stat.Succeeded++
				stat.NewArticles += n
			}
			mu.Unlock()
		}(j)
	}
	wg.Wait()
	return stat, nil
}

// Probe fetches a feed URL once and returns its title and html link, without
// touching the database. Used when adding a feed via URL so we can show the
// user a real title instead of the raw URL.
func (f *Fetcher) Probe(ctx context.Context, url string) (title, htmlURL string) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", ""
	}
	req.Header.Set("User-Agent", f.UserAgent)
	req.Header.Set("Accept", "application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8")
	resp, err := f.HTTPClient.Do(req)
	if err != nil {
		return "", ""
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", ""
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024))
	if err != nil {
		return "", ""
	}
	feed, err := f.parser.ParseString(string(body))
	if err != nil {
		return "", ""
	}
	return strings.TrimSpace(feed.Title), strings.TrimSpace(feed.Link)
}

// RefreshOne refreshes a single feed by id.
func (f *Fetcher) RefreshOne(ctx context.Context, feedID int64) (int, error) {
	var url string
	var etag, lm sql.NullString
	err := f.DB.QueryRowContext(ctx, `SELECT xml_url, etag, last_modified FROM feeds WHERE id = ?`, feedID).
		Scan(&url, &etag, &lm)
	if err != nil {
		return 0, err
	}
	return f.refreshOne(ctx, feedID, url, etag.String, lm.String)
}

func (f *Fetcher) refreshOne(ctx context.Context, feedID int64, url, etag, lastModified string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		f.recordError(feedID, err.Error())
		return 0, err
	}
	req.Header.Set("User-Agent", f.UserAgent)
	req.Header.Set("Accept", "application/atom+xml, application/rss+xml, application/xml;q=0.9, */*;q=0.8")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	if lastModified != "" {
		req.Header.Set("If-Modified-Since", lastModified)
	}

	resp, err := f.HTTPClient.Do(req)
	if err != nil {
		f.recordError(feedID, err.Error())
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		_, _ = f.DB.Exec(`UPDATE feeds SET last_fetched_at = ?, last_error = NULL WHERE id = ?`, time.Now(), feedID)
		return 0, nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
		f.recordError(feedID, msg)
		return 0, fmt.Errorf("%s", msg)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 20*1024*1024)) // 20 MB cap
	if err != nil {
		f.recordError(feedID, err.Error())
		return 0, err
	}
	feed, err := f.parser.ParseString(string(body))
	if err != nil {
		f.recordError(feedID, err.Error())
		return 0, err
	}

	newEtag := resp.Header.Get("ETag")
	newLM := resp.Header.Get("Last-Modified")

	count, err := f.insertItems(feedID, feed)
	if err != nil {
		f.recordError(feedID, err.Error())
		return 0, err
	}

	_, _ = f.DB.Exec(
		`UPDATE feeds SET etag = ?, last_modified = ?, last_fetched_at = ?, last_error = NULL WHERE id = ?`,
		newEtag, newLM, time.Now(), feedID,
	)
	return count, nil
}

func (f *Fetcher) recordError(feedID int64, msg string) {
	if len(msg) > 500 {
		msg = msg[:500]
	}
	_, _ = f.DB.Exec(`UPDATE feeds SET last_fetched_at = ?, last_error = ? WHERE id = ?`, time.Now(), msg, feedID)
	log.Printf("feed %d error: %s", feedID, msg)
}

func (f *Fetcher) insertItems(feedID int64, feed *gofeed.Feed) (int, error) {
	tx, err := f.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO articles (feed_id, guid, title, link, author, summary, content, published_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(feed_id, guid) DO NOTHING
	`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	var newCount int
	for _, item := range feed.Items {
		guid := item.GUID
		if guid == "" {
			guid = item.Link
		}
		if guid == "" {
			guid = item.Title
		}
		if guid == "" {
			continue
		}
		var author string
		if item.Author != nil {
			author = item.Author.Name
		}
		var published *time.Time
		if item.PublishedParsed != nil {
			published = item.PublishedParsed
		} else if item.UpdatedParsed != nil {
			published = item.UpdatedParsed
		}
		summary := stripTags(item.Description, 800)
		content := item.Content
		if content == "" {
			content = item.Description
		}
		res, err := stmt.Exec(feedID, guid, item.Title, item.Link, author, summary, content, published)
		if err != nil {
			return newCount, err
		}
		n, _ := res.RowsAffected()
		if n > 0 {
			newCount++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return newCount, nil
}

// stripTags makes a plain-text excerpt for the article list.
func stripTags(html string, maxLen int) string {
	var b strings.Builder
	inTag := false
	for _, r := range html {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
		case !inTag:
			b.WriteRune(r)
		}
	}
	s := strings.Join(strings.Fields(b.String()), " ")
	if maxLen > 0 && len(s) > maxLen {
		s = s[:maxLen] + "…"
	}
	return s
}
