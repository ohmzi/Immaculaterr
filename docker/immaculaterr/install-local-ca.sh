#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${IMM_HTTPS_CONTAINER:-ImmaculaterrHttps}"
CERT_PATH_IN_CONTAINER="${IMM_LOCAL_CA_CONTAINER_PATH:-/data/caddy/pki/authorities/local/root.crt}"
CERT_NAME="${IMM_LOCAL_CA_NAME:-Immaculaterr Local CA}"
CERT_FILE_BASENAME="${IMM_LOCAL_CA_FILE_BASENAME:-immaculaterr-local-ca}"
OUTPUT_CERT_PATH="${IMM_LOCAL_CA_OUTPUT_PATH:-/tmp/${CERT_FILE_BASENAME}.crt}"
INSTALL_SYSTEM_CA="${IMM_INSTALL_SYSTEM_CA:-true}"
INSTALL_FIREFOX_CA="${IMM_INSTALL_FIREFOX_CA:-true}"

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

is_true() {
  case "$(to_lower "$1")" in
    1|true|yes|on) return 0 ;;
  esac
  return 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi
  if have_cmd sudo && sudo -n true >/dev/null 2>&1; then
    sudo "$@"
    return
  fi
  return 1
}

copy_cert_from_container() {
  if ! have_cmd docker; then
    echo "ERROR: docker is required." >&2
    exit 1
  fi

  if ! docker ps --format '{{.Names}}' | grep -Fxq "$CONTAINER_NAME"; then
    echo "ERROR: container '$CONTAINER_NAME' is not running." >&2
    exit 1
  fi

  docker cp "${CONTAINER_NAME}:${CERT_PATH_IN_CONTAINER}" "$OUTPUT_CERT_PATH"
  chmod 0644 "$OUTPUT_CERT_PATH"
  echo "Copied local CA cert to: $OUTPUT_CERT_PATH"
}

install_system_ca() {
  local target_path="/usr/local/share/ca-certificates/${CERT_FILE_BASENAME}.crt"

  if ! have_cmd update-ca-certificates; then
    echo "Skipped system CA install: update-ca-certificates not found."
    return
  fi

  if run_as_root cp "$OUTPUT_CERT_PATH" "$target_path"; then
    run_as_root update-ca-certificates >/dev/null
    echo "Installed system trust CA: $target_path"
  else
    echo "Skipped system CA install: root privileges unavailable."
    echo "Run manually as root:"
    echo "  cp '$OUTPUT_CERT_PATH' '$target_path' && update-ca-certificates"
  fi
}

find_firefox_profiles() {
  local base
  for base in "$HOME/.mozilla/firefox" "$HOME/snap/firefox/common/.mozilla/firefox"; do
    [ -d "$base" ] || continue
    find "$base" -maxdepth 1 -mindepth 1 -type d \
      \( -name '*.default' -o -name '*.default-release' -o -name '*.default-esr' \)
  done
}

install_firefox_ca() {
  if ! have_cmd certutil; then
    echo "Skipped Firefox CA install: certutil not found."
    echo "Install it (Ubuntu/Debian): sudo apt-get install -y libnss3-tools"
    return
  fi

  local installed=0
  while IFS= read -r profile; do
    [ -n "$profile" ] || continue
    if [ ! -f "$profile/cert9.db" ] && [ ! -f "$profile/cert8.db" ]; then
      continue
    fi
    certutil -D -n "$CERT_NAME" -d "sql:$profile" >/dev/null 2>&1 || true
    if certutil -A -n "$CERT_NAME" -t "C,," -i "$OUTPUT_CERT_PATH" -d "sql:$profile"; then
      installed=$((installed + 1))
      echo "Installed Firefox trust in profile: $profile"
    else
      echo "WARN: failed to update Firefox profile: $profile" >&2
      echo "      Close Firefox and retry this script."
    fi
  done < <(find_firefox_profiles | sort -u)

  if [ "$installed" -eq 0 ]; then
    echo "No writable Firefox profiles found for auto-install."
  fi
}

copy_cert_from_container

if is_true "$INSTALL_SYSTEM_CA"; then
  install_system_ca
fi

if is_true "$INSTALL_FIREFOX_CA"; then
  install_firefox_ca
fi

echo "Done."
