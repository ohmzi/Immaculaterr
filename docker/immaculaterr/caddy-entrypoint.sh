#!/usr/bin/env sh
set -eu

APP_INTERNAL_PORT="${APP_INTERNAL_PORT:-5455}"
IMM_ENABLE_HTTP="${IMM_ENABLE_HTTP:-true}"
IMM_HTTP_PORT="${IMM_HTTP_PORT:-5454}"
IMM_ENABLE_HTTPS="${IMM_ENABLE_HTTPS:-true}"
IMM_HTTPS_PORT="${IMM_HTTPS_PORT:-5464}"
IMM_INCLUDE_LOCALHOST="${IMM_INCLUDE_LOCALHOST:-true}"
IMM_ENABLE_LAN_IP="${IMM_ENABLE_LAN_IP:-true}"
IMM_HTTPS_LAN_IP="${IMM_HTTPS_LAN_IP:-}"
IMM_HTTPS_EXTRA_HOSTS="${IMM_HTTPS_EXTRA_HOSTS:-}"
IMM_PUBLIC_DOMAIN="${IMM_PUBLIC_DOMAIN:-}"
IMM_PUBLIC_DOMAIN_PORT="${IMM_PUBLIC_DOMAIN_PORT:-443}"
IMM_PUBLIC_DOMAIN_TLS_MODE="${IMM_PUBLIC_DOMAIN_TLS_MODE:-public}"
IMM_TLS_ACME_EMAIL="${IMM_TLS_ACME_EMAIL:-}"

lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

is_true() {
  case "$(lower "$1")" in
    1|true|yes|on) return 0 ;;
  esac
  return 1
}

trim() {
  # shellcheck disable=SC2001
  printf '%s' "$1" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

normalize_host() {
  host="$(trim "$1")"
  [ -z "$host" ] && return 0
  host="${host#https://}"
  host="${host#http://}"
  host="${host%%/*}"
  printf '%s' "$host"
}

detect_lan_ip() {
  ip route get 1.1.1.1 2>/dev/null | awk '
    {
      for (i = 1; i <= NF; i++) {
        if ($i == "src" && i < NF) {
          print $(i + 1);
          exit;
        }
      }
    }
  '
}

TMP_HOSTS="$(mktemp)"
TMP_HOSTS_SORTED="$(mktemp)"
CONFIG_FILE="/etc/caddy/Caddyfile.generated"
trap 'rm -f "$TMP_HOSTS" "$TMP_HOSTS_SORTED"' EXIT

add_host() {
  host="$(normalize_host "$1")"
  [ -z "$host" ] && return 0
  printf '%s\n' "$host" >> "$TMP_HOSTS"
}

if is_true "$IMM_INCLUDE_LOCALHOST"; then
  add_host "localhost"
fi

if [ -z "$IMM_HTTPS_LAN_IP" ] && is_true "$IMM_ENABLE_LAN_IP"; then
  IMM_HTTPS_LAN_IP="$(detect_lan_ip || true)"
fi

if [ -n "$IMM_HTTPS_LAN_IP" ]; then
  add_host "$IMM_HTTPS_LAN_IP"
fi

if [ -n "$IMM_HTTPS_EXTRA_HOSTS" ]; then
  OLD_IFS="$IFS"
  IFS=','
  # shellcheck disable=SC2086
  set -- $IMM_HTTPS_EXTRA_HOSTS
  IFS="$OLD_IFS"
  for raw_host in "$@"; do
    add_host "$raw_host"
  done
fi

sort -u "$TMP_HOSTS" > "$TMP_HOSTS_SORTED" || true

local_http_site_addrs=''
local_https_site_addrs=''
while IFS= read -r host; do
  [ -z "$host" ] && continue
  if is_true "$IMM_ENABLE_HTTP"; then
    http_addr="http://${host}:${IMM_HTTP_PORT}"
    if [ -z "$local_http_site_addrs" ]; then
      local_http_site_addrs="$http_addr"
    else
      local_http_site_addrs="$local_http_site_addrs, $http_addr"
    fi
  fi
  if is_true "$IMM_ENABLE_HTTPS"; then
    https_addr="https://${host}:${IMM_HTTPS_PORT}"
    if [ -z "$local_https_site_addrs" ]; then
      local_https_site_addrs="$https_addr"
    else
      local_https_site_addrs="$local_https_site_addrs, $https_addr"
    fi
  fi
done < "$TMP_HOSTS_SORTED"

cat > "$CONFIG_FILE" <<EOF
{
  admin off
  auto_https disable_redirects
}

(common_proxy) {
  encode zstd gzip
  reverse_proxy 127.0.0.1:${APP_INTERNAL_PORT} {
    header_up X-Forwarded-Port {server_port}
  }
}
EOF

has_site='false'
if [ -n "$local_http_site_addrs" ]; then
  cat >> "$CONFIG_FILE" <<EOF

${local_http_site_addrs} {
  import common_proxy
}
EOF
  has_site='true'
fi

if [ -n "$local_https_site_addrs" ]; then
  cat >> "$CONFIG_FILE" <<EOF

${local_https_site_addrs} {
  tls internal
  import common_proxy
}
EOF
  has_site='true'
fi

public_domain_host="$(normalize_host "$IMM_PUBLIC_DOMAIN")"
public_tls_mode="$(lower "$IMM_PUBLIC_DOMAIN_TLS_MODE")"

if [ -n "$public_domain_host" ]; then
  if [ "$IMM_PUBLIC_DOMAIN_PORT" = "443" ]; then
    public_site_addr="https://${public_domain_host}"
  else
    public_site_addr="https://${public_domain_host}:${IMM_PUBLIC_DOMAIN_PORT}"
  fi

  if [ "$public_tls_mode" = 'internal' ]; then
    cat >> "$CONFIG_FILE" <<EOF

${public_site_addr} {
  tls internal
  import common_proxy
}
EOF
  elif [ -n "$IMM_TLS_ACME_EMAIL" ]; then
    cat >> "$CONFIG_FILE" <<EOF

${public_site_addr} {
  tls {
    issuer acme {
      email ${IMM_TLS_ACME_EMAIL}
    }
  }
  import common_proxy
}
EOF
  else
    cat >> "$CONFIG_FILE" <<EOF

${public_site_addr} {
  import common_proxy
}
EOF
  fi

  has_site='true'
fi

if [ "$has_site" != 'true' ]; then
  echo "ERROR: No HTTP/HTTPS sites configured. Enable localhost/LAN or set IMM_PUBLIC_DOMAIN." >&2
  exit 1
fi

caddy fmt --overwrite "$CONFIG_FILE" >/dev/null 2>&1 || true
exec caddy run --config "$CONFIG_FILE" --adapter caddyfile
