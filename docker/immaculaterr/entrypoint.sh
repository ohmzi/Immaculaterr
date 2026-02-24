#!/usr/bin/env sh
set -eu

APP_DATA_DIR="${APP_DATA_DIR:-/data}"
DB_PRE_MIGRATE_BACKUP="${DB_PRE_MIGRATE_BACKUP:-true}"
DB_PRE_MIGRATE_BACKUP_STRICT="${DB_PRE_MIGRATE_BACKUP_STRICT:-false}"
DB_PRE_MIGRATE_BACKUP_KEEP="${DB_PRE_MIGRATE_BACKUP_KEEP:-10}"
DB_PRE_MIGRATE_BACKUP_DIR="${DB_PRE_MIGRATE_BACKUP_DIR:-$APP_DATA_DIR/backups/pre-migrate}"

resolve_db_file() {
  db_file="$APP_DATA_DIR/tcp.sqlite"
  case "${DATABASE_URL:-}" in
    file:*)
      url_path="${DATABASE_URL#file:}"
      if [ -n "$url_path" ]; then
        db_file="$url_path"
      fi
      ;;
  esac
  printf '%s' "$db_file"
}

create_pre_migrate_backup() {
  db_file="$1"
  if [ ! -f "$db_file" ]; then
    echo "No existing database file at $db_file; skipping pre-migration backup."
    return 0
  fi

  mkdir -p "$DB_PRE_MIGRATE_BACKUP_DIR"
  chmod 700 "$DB_PRE_MIGRATE_BACKUP_DIR" 2>/dev/null || true

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  backup_file="$DB_PRE_MIGRATE_BACKUP_DIR/tcp-${timestamp}.sqlite"

  cp "$db_file" "$backup_file"
  if [ -f "${db_file}-wal" ]; then
    cp "${db_file}-wal" "${backup_file}-wal"
  fi
  if [ -f "${db_file}-shm" ]; then
    cp "${db_file}-shm" "${backup_file}-shm"
  fi

  chmod 600 "$backup_file" 2>/dev/null || true
  if [ -f "${backup_file}-wal" ]; then
    chmod 600 "${backup_file}-wal" 2>/dev/null || true
  fi
  if [ -f "${backup_file}-shm" ]; then
    chmod 600 "${backup_file}-shm" 2>/dev/null || true
  fi

  echo "Created pre-migration backup: $backup_file"

  case "$DB_PRE_MIGRATE_BACKUP_KEEP" in
    ''|*[!0-9]*)
      echo "WARN: DB_PRE_MIGRATE_BACKUP_KEEP must be numeric; skipping cleanup." >&2
      return 0
      ;;
  esac

  keep="$DB_PRE_MIGRATE_BACKUP_KEEP"
  if [ "$keep" -lt 1 ]; then
    return 0
  fi

  i=0
  for f in $(ls -1t "$DB_PRE_MIGRATE_BACKUP_DIR"/*.sqlite 2>/dev/null || true); do
    i=$((i + 1))
    if [ "$i" -le "$keep" ]; then
      continue
    fi
    rm -f "$f" "${f}-wal" "${f}-shm" 2>/dev/null || true
  done
}

# Best-effort hardening for the mounted data directory.
mkdir -p "$APP_DATA_DIR" 2>/dev/null || true

# Tighten permissions (ignore failures on restrictive mounts).
chmod 700 "$APP_DATA_DIR" 2>/dev/null || true
if [ -f "$APP_DATA_DIR/app-master.key" ]; then
  chmod 600 "$APP_DATA_DIR/app-master.key" 2>/dev/null || true
fi
if [ -f "$APP_DATA_DIR/tcp.sqlite" ]; then
  chmod 600 "$APP_DATA_DIR/tcp.sqlite" 2>/dev/null || true
fi

# If we're root, ensure the non-root app user can read/write the volume.
if [ "$(id -u)" = "0" ]; then
  chown -R app:app "$APP_DATA_DIR" 2>/dev/null || true
fi

DB_FILE="$(resolve_db_file)"
if [ "$DB_PRE_MIGRATE_BACKUP" = "true" ]; then
  if ! create_pre_migrate_backup "$DB_FILE"; then
    if [ "$DB_PRE_MIGRATE_BACKUP_STRICT" = "true" ]; then
      echo "ERROR: pre-migration backup failed in strict mode." >&2
      exit 1
    fi
    echo "WARN: pre-migration backup failed; continuing (best-effort mode)." >&2
  fi
fi

# Run migrations (with compatibility repair for legacy auth/session data) + start server.
run_cmd='node apps/api/dist/scripts/migrate-with-repair.js && node apps/api/dist/main.js'

if [ "$(id -u)" = "0" ]; then
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=app --regid=app --clear-groups sh -c "$run_cmd"
  elif command -v runuser >/dev/null 2>&1; then
    exec runuser -u app -- sh -c "$run_cmd"
  elif command -v su >/dev/null 2>&1; then
    exec su -s /bin/sh app -c "$run_cmd"
  else
    echo "WARN: no privilege-drop tool found (setpriv/runuser/su). Running as root." >&2
    exec sh -c "$run_cmd"
  fi
fi

exec sh -c "$run_cmd"
