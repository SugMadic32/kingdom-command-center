#!/usr/bin/env bash
# Restore a dump into an EMPTY database:  scripts/restore.sh backups/kingdom-XXXX.dump
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
pg_restore --no-owner --clean --if-exists -d "$DATABASE_URL" "$1"
