package export

import "time"

// ResolveTZ resolves the export `tz` parameter to a location (export_spec §4.1):
//   - a valid IANA name (e.g. "Europe/Berlin") → that zone;
//   - the literal "local" → no override, i.e. the server's location;
//   - anything unparseable → the server's location.
//
// In the container the server location is effectively UTC (engineering_standard §2
// ships tzdata, but FEEDLER sets no TZ), so an unknown zone degrades to UTC.
func ResolveTZ(tz string) *time.Location {
	if tz != "" && tz != "local" {
		if l, err := time.LoadLocation(tz); err == nil {
			return l
		}
	}
	return time.Local
}

// Window computes the half-open [from, to) time window for a Range (export_spec
// §4.2/§4.3), in the operator's location `loc`, relative to `now`. A nil bound
// means "unbounded on that side". Day boundaries are drawn in `loc`; the caller
// compares the returned instants against the UTC-stored article timestamps.
//
//   - today      → [startOfToday, startOfToday+24h)
//   - yesterday  → [startOfToday-24h, startOfToday)
//   - week       → [startOfToday-6d, startOfToday+24h)   (last 7 days incl. today)
//   - month      → [startOfToday-29d, startOfToday+24h)  (last 30 days incl. today)
//   - all        → (nil, nil)
//   - custom, "" → parsed from/to; a bad date is ignored (that bound stays nil);
//                  `to` is made inclusive of its whole day by advancing +24h.
func Window(rng, from, to string, loc *time.Location, now time.Time) (fromT, toT *time.Time) {
	nowLoc := now.In(loc)
	startOfToday := time.Date(nowLoc.Year(), nowLoc.Month(), nowLoc.Day(), 0, 0, 0, 0, loc)

	// Every named-range edge is a calendar-day boundary in the operator's zone.
	// AddDate on an in-loc time.Date value re-normalizes to the correct wall-clock
	// midnight across any intervening DST transition (export_spec §4.1/§4.2, invariant
	// 5); a fixed N*24h offset would drift off local midnight twice a year.
	switch rng {
	case "today":
		f := startOfToday
		t := startOfToday.AddDate(0, 0, 1)
		return &f, &t
	case "yesterday":
		f := startOfToday.AddDate(0, 0, -1)
		t := startOfToday
		return &f, &t
	case "week":
		f := startOfToday.AddDate(0, 0, -6)
		t := startOfToday.AddDate(0, 0, 1)
		return &f, &t
	case "month":
		f := startOfToday.AddDate(0, 0, -29)
		t := startOfToday.AddDate(0, 0, 1)
		return &f, &t
	case "all":
		return nil, nil
	default: // "custom" or empty — bare from/to still work
		if from != "" {
			if t, err := time.Parse("2006-01-02", from); err == nil {
				fromT = &t
			}
		}
		if to != "" {
			if t, err := time.Parse("2006-01-02", to); err == nil {
				t = t.Add(24 * time.Hour) // make `to` inclusive of its whole day
				toT = &t
			}
		}
		return fromT, toT
	}
}
