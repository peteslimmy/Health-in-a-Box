#!/usr/bin/env bash
# Nightly database backup. Run from the repository root (cron or a scheduled task):
#   0 2 * * *  cd /srv/hnb && ./ops/backup.sh >> backups/backup.log 2>&1
# Copy the files in ./backups OFF this server (another site or a cloud bucket); a backup that lives
# only beside the database is not a backup. Uploaded source files live in the MinIO volume
# (hnb_minio_data): back that volume up on the same schedule.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
stamp="$(date +%Y%m%d-%H%M%S)"
file="backups/hnb-${stamp}.dump"
compose="docker compose -f docker-compose.prod.yml"
$compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$file"
# A dump that is empty or unreadable is a failed backup: say so loudly.
test -s "$file" || { echo "BACKUP FAILED: empty file $file" >&2; rm -f "$file"; exit 1; }
$compose exec -T db pg_restore --list < "$file" > /dev/null \
  || { echo "BACKUP FAILED: $file cannot be read back" >&2; exit 1; }
echo "$(date -Is) backup ok: $file ($(du -h "$file" | cut -f1))"
# Keep 14 daily copies locally; the off-site copy has its own retention (see the runbook).
find backups -name 'hnb-*.dump' -mtime +14 -delete
