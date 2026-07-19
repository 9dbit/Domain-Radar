#!/data/data/com.termux/files/usr/bin/bash
set -e

APP_DIR="$HOME/Domain-Radar"
ENV_FILE="$APP_DIR/.env.provider-node"

usage() {
  echo "Usage: ./set-quota.sh <remaining_gb> [total_gb] [expires_at]"
  echo "Example: ./set-quota.sh 12.5 30 2026-07-30"
}

if [ "$1" = "-h" ] || [ "$1" = "--help" ] || [ -z "$1" ]; then
  usage
  exit 0
fi

REMAINING="$1"
TOTAL="${2:-}"
EXPIRES="${3:-}"

case "$REMAINING" in
  ''|*[!0-9.]*|*.*.*)
    echo "Invalid remaining quota: $REMAINING"
    usage
    exit 1
    ;;
esac

if [ -n "$TOTAL" ]; then
  case "$TOTAL" in
    *[!0-9.]*|*.*.*)
      echo "Invalid total quota: $TOTAL"
      usage
      exit 1
      ;;
  esac
fi

mkdir -p "$APP_DIR"
touch "$ENV_FILE"

update_key() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf "\n%s=%s" "$key" "$value" >> "$ENV_FILE"
  fi
}

LABEL="$REMAINING GB"
if [ -n "$TOTAL" ]; then
  LABEL="$REMAINING GB / $TOTAL GB"
fi

update_key "QUOTA_REMAINING_GB" "$REMAINING"
update_key "QUOTA_TOTAL_GB" "$TOTAL"
update_key "QUOTA_EXPIRES_AT" "$EXPIRES"
update_key "QUOTA_LABEL" "$LABEL"

echo "Quota saved: $LABEL"
if [ -n "$EXPIRES" ]; then
  echo "Expires: $EXPIRES"
fi
echo "Restart the provider agent for immediate update, or wait for next run if your shell reloads env."
