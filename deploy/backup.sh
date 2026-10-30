#!/usr/bin/env bash
# On the server: dump the database from the Docker container. Keeps the last 14 days.
# Add to crontab (crontab -e):   0 3 * * * /home/ubuntu/kingdom-command-center/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
docker compose exec -T db pg_dump -U kc -Fc kingdom > "backups/kingdom-$(date -u +%Y%m%d).dump"
ls -1t backups/kingdom-*.dump | tail -n +15 | xargs -r rm --
