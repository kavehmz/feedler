package readability

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"time"

	readability "github.com/go-shiori/go-readability"
)

type Service struct {
	DB         *sql.DB
	HTTPClient *http.Client
	UserAgent  string
}

func New(db *sql.DB) *Service {
	return &Service{
		DB: db,
		HTTPClient: &http.Client{
			Timeout: 25 * time.Second,
		},
		UserAgent: "Feedler/1.0 (+full-article-reader)",
	}
}

// Fetch returns cached full HTML if present; otherwise downloads & extracts.
func (s *Service) Fetch(ctx context.Context, articleID int64) (string, error) {
	var link, cached string
	err := s.DB.QueryRowContext(ctx,
		`SELECT link, COALESCE(full_content,'') FROM articles WHERE id = ?`, articleID).
		Scan(&link, &cached)
	if err != nil {
		return "", err
	}
	if cached != "" {
		return cached, nil
	}
	if link == "" {
		return "", fmt.Errorf("article has no link")
	}

	u, err := url.Parse(link)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "GET", link, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", s.UserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")

	resp, err := s.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("upstream HTTP %d", resp.StatusCode)
	}

	article, err := readability.FromReader(resp.Body, u)
	if err != nil {
		return "", err
	}
	html := article.Content
	if html == "" {
		return "", fmt.Errorf("readability returned empty content")
	}

	_, _ = s.DB.ExecContext(ctx, `UPDATE articles SET full_content = ? WHERE id = ?`, html, articleID)
	return html, nil
}
