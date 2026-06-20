#!/bin/sh
set -e

# Rootless Podman (esp. on macOS via virtiofs) can shift the uid mapping
# between container runs. When that happens, files in the bind-mounted
# /data appear to the new container as owned by uid 65534 ("nobody",
# the overflow uid) with mode 644, so SQLite can read but not write —
# refreshes silently fail with "attempt to write a readonly database".
#
# Heal it by copy-replacing any DB file we can't write: read it (read
# perm we have), write a new copy (the new file is owned by us), then
# move it back into place. WAL/SHM are deleted; SQLite recreates them.

DBFILE=/data/feedler.db
SHM=${DBFILE}-shm
WAL=${DBFILE}-wal

# `test -w` lies under rootless Podman (busybox checks mode but ignores that
# CAP_DAC_OVERRIDE doesn't apply to unmapped uids), so do a real open-for-RW
# probe with shell redirection. If it fails, copy-replace to take ownership.
if [ -f "$DBFILE" ] && ! ( : 3<>"$DBFILE" ) 2>/dev/null; then
  echo "entrypoint: $DBFILE not writable — normalizing ownership"
  cp "$DBFILE" "${DBFILE}.tmp"
  mv -f "${DBFILE}.tmp" "$DBFILE"
  rm -f "$SHM" "$WAL"
fi

exec /usr/local/bin/feedler "$@"
