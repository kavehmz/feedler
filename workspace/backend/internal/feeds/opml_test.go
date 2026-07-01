package feeds

import (
	"strings"
	"testing"
)

// The binding worked example from ingestion_spec §2.3: nested folders flatten to
// a single "Parent / Child" path; a feed's own title is never part of its Folder;
// a top-level feed has the empty Folder.
func TestParseOPML_FolderFlattening(t *testing.T) {
	const doc = `<opml version="1.0">
  <body>
    <outline title="Tech">
      <outline title="Cloudflare Blog" xmlUrl="https://blog.cloudflare.com/rss/"
               htmlUrl="https://blog.cloudflare.com"/>
      <outline title="Cloud">
        <outline text="AWS News" xmlUrl="https://aws.amazon.com/blogs/aws/feed/"/>
      </outline>
    </outline>
    <outline title="Daring Fireball" xmlUrl="https://daringfireball.net/feeds/main"/>
  </body>
</opml>`

	got, err := ParseOPML(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("ParseOPML: %v", err)
	}
	want := []ImportedFeed{
		{Title: "Cloudflare Blog", XMLURL: "https://blog.cloudflare.com/rss/", HTMLURL: "https://blog.cloudflare.com", Folder: "Tech"},
		{Title: "AWS News", XMLURL: "https://aws.amazon.com/blogs/aws/feed/", Folder: "Tech / Cloud"},
		{Title: "Daring Fireball", XMLURL: "https://daringfireball.net/feeds/main", Folder: ""},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d feeds, want %d: %+v", len(got), len(want), got)
	}
	for i := range want {
		if got[i].Title != want[i].Title || got[i].XMLURL != want[i].XMLURL || got[i].Folder != want[i].Folder {
			t.Errorf("feed %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}

// Title resolution (§2.2): first non-empty of title, text, then xmlUrl — a feed
// outline with neither title nor text is titled by its URL (never blank).
func TestParseOPML_TitleResolution(t *testing.T) {
	const doc = `<opml><body>
      <outline text="Only Text" xmlUrl="https://a.example/feed"/>
      <outline xmlUrl="https://b.example/feed"/>
    </body></opml>`
	got, err := ParseOPML(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("ParseOPML: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d feeds, want 2", len(got))
	}
	if got[0].Title != "Only Text" {
		t.Errorf("title from text = %q, want %q", got[0].Title, "Only Text")
	}
	if got[1].Title != "https://b.example/feed" {
		t.Errorf("title fallback = %q, want the xmlUrl", got[1].Title)
	}
}

// An unlabeled container is transparent: it adds no segment but does not break the
// chain (§2.3). A container outline (no xmlUrl) never becomes a feed (§2.1/§2.4).
func TestParseOPML_TransparentContainer(t *testing.T) {
	const doc = `<opml><body>
      <outline title="Outer">
        <outline>
          <outline title="Inner Feed" xmlUrl="https://c.example/feed"/>
        </outline>
      </outline>
    </body></opml>`
	got, err := ParseOPML(strings.NewReader(doc))
	if err != nil {
		t.Fatalf("ParseOPML: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d feeds, want 1 (containers are not feeds)", len(got))
	}
	if got[0].Folder != "Outer" {
		t.Errorf("folder = %q, want %q (unlabeled container adds no segment)", got[0].Folder, "Outer")
	}
}

// stripTags makes a tag-free, whitespace-collapsed excerpt, capped with an
// ellipsis when truncated (ingestion_spec §6.2).
func TestStripTags(t *testing.T) {
	out := stripTags("<p>Hello   <b>world</b></p>\n<p>again</p>", 800)
	if out != "Hello world again" {
		t.Errorf("stripTags = %q, want %q", out, "Hello world again")
	}
	long := stripTags(strings.Repeat("x", 1000), 800)
	if !strings.HasSuffix(long, "…") {
		t.Errorf("expected truncated excerpt to end with ellipsis, got len %d", len(long))
	}
}
