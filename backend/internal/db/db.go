package db

import (
	"database/sql"
	"fmt"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const schema = `
CREATE TABLE IF NOT EXISTS feeds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  xml_url         TEXT NOT NULL UNIQUE,
  html_url        TEXT,
  title           TEXT NOT NULL,
  folder          TEXT,
  etag            TEXT,
  last_modified   TEXT,
  last_fetched_at TIMESTAMP,
  last_error      TEXT,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id       INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  guid          TEXT NOT NULL,
  title         TEXT,
  link          TEXT,
  author        TEXT,
  summary       TEXT,
  content       TEXT,
  full_content  TEXT,
  published_at  TIMESTAMP,
  fetched_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_read       INTEGER DEFAULT 0,
  is_starred    INTEGER DEFAULT 0,
  UNIQUE(feed_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_articles_feed_pub  ON articles(feed_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_pub       ON articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_read      ON articles(is_read);
CREATE INDEX IF NOT EXISTS idx_articles_starred   ON articles(is_starred);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`

func Open(dataDir string) (*sql.DB, error) {
	path := filepath.Join(dataDir, "feedler.db")
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", path)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	conn.SetMaxOpenConns(1) // sqlite is happiest with a single writer
	if err := conn.Ping(); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	if _, err := conn.Exec(schema); err != nil {
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return conn, nil
}

func GetMeta(conn *sql.DB, key string) (string, bool, error) {
	var v string
	err := conn.QueryRow(`SELECT value FROM meta WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

func SetMeta(conn *sql.DB, key, value string) error {
	_, err := conn.Exec(`INSERT INTO meta(key,value) VALUES(?,?)
		ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}
