package scheduler

import (
	"context"
	"log"
	"time"

	"feedler/internal/feeds"
)

// Run kicks off a periodic refresh in a goroutine. It also runs one refresh
// immediately on startup.
func Run(ctx context.Context, f *feeds.Fetcher, interval time.Duration) {
	go func() {
		log.Printf("scheduler: initial refresh")
		stat, err := f.RefreshAll(ctx)
		if err != nil {
			log.Printf("scheduler: initial refresh: %v", err)
		} else {
			log.Printf("scheduler: initial done, feeds=%d ok=%d failed=%d new=%d",
				stat.Feeds, stat.Succeeded, stat.Failed, stat.NewArticles)
		}

		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				stat, err := f.RefreshAll(ctx)
				if err != nil {
					log.Printf("scheduler: refresh: %v", err)
					continue
				}
				log.Printf("scheduler: refresh done, feeds=%d ok=%d failed=%d new=%d",
					stat.Feeds, stat.Succeeded, stat.Failed, stat.NewArticles)
			}
		}
	}()
}
