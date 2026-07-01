package feeds

import (
	"database/sql"
	"encoding/xml"
	"fmt"
	"io"
	"strings"
)

type opmlDoc struct {
	XMLName xml.Name    `xml:"opml"`
	Body    opmlBody    `xml:"body"`
}

type opmlBody struct {
	Outlines []opmlOutline `xml:"outline"`
}

type opmlOutline struct {
	Type     string        `xml:"type,attr"`
	Text     string        `xml:"text,attr"`
	Title    string        `xml:"title,attr"`
	XMLURL   string        `xml:"xmlUrl,attr"`
	HTMLURL  string        `xml:"htmlUrl,attr"`
	Children []opmlOutline `xml:"outline"`
}

type ImportedFeed struct {
	Title   string
	XMLURL  string
	HTMLURL string
	Folder  string
}

func ParseOPML(r io.Reader) ([]ImportedFeed, error) {
	dec := xml.NewDecoder(r)
	dec.Strict = false
	dec.AutoClose = xml.HTMLAutoClose
	dec.Entity = xml.HTMLEntity
	var doc opmlDoc
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("parse opml: %w", err)
	}
	var out []ImportedFeed
	for _, o := range doc.Body.Outlines {
		collectFeeds(o, "", &out)
	}
	return out, nil
}

func collectFeeds(o opmlOutline, parent string, out *[]ImportedFeed) {
	if o.XMLURL != "" {
		title := firstNonEmpty(o.Title, o.Text, o.XMLURL)
		*out = append(*out, ImportedFeed{
			Title:   strings.TrimSpace(title),
			XMLURL:  o.XMLURL,
			HTMLURL: o.HTMLURL,
			Folder:  parent,
		})
		return
	}
	// Container (folder). Trim the label so flattened paths stay clean
	// ("Tech / Cloud", never " Tech  /  Cloud") regardless of OPML whitespace.
	folder := strings.TrimSpace(firstNonEmpty(o.Title, o.Text))
	if parent != "" && folder != "" {
		folder = parent + " / " + folder
	}
	if folder == "" {
		folder = parent
	}
	for _, c := range o.Children {
		collectFeeds(c, folder, out)
	}
}

func firstNonEmpty(xs ...string) string {
	for _, s := range xs {
		if strings.TrimSpace(s) != "" {
			return s
		}
	}
	return ""
}

// ImportOPML inserts/updates feeds. Returns counts (inserted, updated, skipped).
func ImportOPML(db *sql.DB, feeds []ImportedFeed) (int, int, int, error) {
	var inserted, updated, skipped int
	tx, err := db.Begin()
	if err != nil {
		return 0, 0, 0, err
	}
	defer tx.Rollback()

	for _, f := range feeds {
		if f.XMLURL == "" {
			skipped++
			continue
		}
		// Determine insert-vs-update by an existence pre-check inside the txn.
		// SQLite's RowsAffected() reports 1 for BOTH a fresh insert and the
		// DO UPDATE branch of an upsert (the "2 rows for an update" signal is a
		// MySQL convention, not SQLite's), so it cannot distinguish the two —
		// a pre-check makes the split exact so a re-import correctly reports
		// `updated`, not `inserted` (ingestion_spec §3.2, acceptance criteria).
		var exists int
		_ = tx.QueryRow(`SELECT 1 FROM feeds WHERE xml_url = ?`, f.XMLURL).Scan(&exists)
		_, err := tx.Exec(
			`INSERT INTO feeds(xml_url, html_url, title, folder) VALUES(?,?,?,?)
			 ON CONFLICT(xml_url) DO UPDATE SET
			   html_url = excluded.html_url,
			   title    = excluded.title,
			   folder   = excluded.folder`,
			f.XMLURL, f.HTMLURL, f.Title, f.Folder,
		)
		if err != nil {
			return 0, 0, 0, err
		}
		if exists == 1 {
			updated++
		} else {
			inserted++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, 0, err
	}
	return inserted, updated, skipped, nil
}
