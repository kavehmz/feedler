package models

import "time"

type Feed struct {
	ID            int64      `json:"id"`
	XMLURL        string     `json:"xml_url"`
	HTMLURL       string     `json:"html_url"`
	Title         string     `json:"title"`
	Folder        string     `json:"folder"`
	LastFetchedAt *time.Time `json:"last_fetched_at,omitempty"`
	LastError     string     `json:"last_error,omitempty"`
	UnreadCount   int        `json:"unread_count"`
}

type Article struct {
	ID          int64      `json:"id"`
	FeedID      int64      `json:"feed_id"`
	FeedTitle   string     `json:"feed_title,omitempty"`
	FeedFolder  string     `json:"feed_folder"`
	GUID        string     `json:"guid"`
	Title       string     `json:"title"`
	Link        string     `json:"link"`
	Author      string     `json:"author"`
	Summary     string     `json:"summary,omitempty"`
	Content     string     `json:"content,omitempty"`
	FullContent string     `json:"full_content,omitempty"`
	PublishedAt *time.Time `json:"published_at,omitempty"`
	FetchedAt   time.Time  `json:"fetched_at"`
	IsRead      bool       `json:"is_read"`
	IsStarred   bool       `json:"is_starred"`
}

type Folder struct {
	Name        string `json:"name"`
	UnreadCount int    `json:"unread_count"`
	Feeds       []Feed `json:"feeds"`
}
