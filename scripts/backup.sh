#!/usr/bin/env bash
# Daily backup: run from cron, e.g.  0 3 * * *  /path/to/scripts/backup.sh
# Keeps the last 14 dumps. Copy the backups folder off the server too.
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
DIR="$(dirname "$0")/../backups"
mkdir -p "$DIR"
FILE="$DIR/kingdom-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner "$DATABASE_URL" > "$FILE"
ls -1t "$DIR"/kingdom-*.dump | tail -n +15 | xargs -r rm --
echo "Backup written: $FILE"
