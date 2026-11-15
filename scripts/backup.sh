#!/usr/bin/env bash
# Database backup (11 §4). Run from the developer's computer: the free Supabase plan has no backups.
# Run before every migration and at least weekly.
#
#   DIRECT_URL=postgresql://... ./scripts/backup.sh [backup-dir]
#
# Creates  <backup-dir>/cms-YYYY-MM-DD.dump  (pg_dump custom format) and deletes dumps older than 30 days.
# Default backup dir: ./backups (ignored by git; keep copies off this machine too).
#
# RESTORE (into an empty database; never into the live one without a fresh dump first):
#   createdb cms_restore
#   pg_restore --clean --if-exists --no-owner --dbname "postgresql://.../cms_restore" backups/cms-YYYY-MM-DD.dump
# Files in Supabase Storage are not part of the dump; they are never overwritten and are purged only 30 days after delete.
set -euo pipefail

: "${DIRECT_URL:?DIRECT_URL is required (the direct Postgres connection, not the pooler)}"
DIR="${1:-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"

mkdir -p "$DIR"
OUT="$DIR/cms-$(date +%F).dump"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

pg_dump --format=custom --no-owner --file="$TMP" "$DIRECT_URL"
mv "$TMP" "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT") bytes)"

find "$DIR" -maxdepth 1 -name 'cms-*.dump' -type f -mtime "+$KEEP_DAYS" -print -delete
