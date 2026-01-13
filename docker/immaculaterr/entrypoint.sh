#!/usr/bin/env sh
set -eu

APP_DATA_DIR="${APP_DATA_DIR:-/data}"

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

# Run migrations + start the server as the non-root user.
run_cmd='npm -w apps/api run db:migrate && node apps/api/dist/main.js'

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

