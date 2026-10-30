#!/usr/bin/env bash
# On the server: pull the latest code from GitHub and rebuild. Data is kept.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker image prune -f
echo "Updated. Check the version number at the bottom of the menu."
