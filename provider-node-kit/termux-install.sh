#!/data/data/com.termux/files/usr/bin/bash
set -e

APP_DIR="$HOME/Domain-Radar"
ENV_FILE="$APP_DIR/.env.provider-node"
RUN_FILE="$APP_DIR/run-provider-node.sh"
LOG_FILE="$APP_DIR/provider-node.log"

say() { printf "\n==> %s\n" "$1"; }
ask() {
  local label="$1"
  local default_value="$2"
  local value
  if [ -n "$default_value" ]; then
    read -r -p "$label [$default_value]: " value
    printf "%s" "${value:-$default_value}"
  else
    read -r -p "$label: " value
    printf "%s" "$value"
  fi
}

say "Domain Radar Provider Node Installer"

if ! command -v node >/dev/null 2>&1; then
  say "Installing nodejs"
  pkg update -y
  pkg install -y nodejs
fi

if ! command -v git >/dev/null 2>&1; then
  say "Installing git"
  pkg install -y git
fi

if ! command -v termux-battery-status >/dev/null 2>&1; then
  say "Installing termux-api"
  pkg install -y termux-api || true
fi

if [ ! -d "$APP_DIR/.git" ]; then
  say "Cloning repo"
  git clone https://github.com/9dbit/Domain-Radar.git "$APP_DIR"
fi

cd "$APP_DIR"
git fetch origin
git reset --hard origin/main
npm install --omit=dev

CENTRAL_URL=$(ask "Central URL" "https://domain-radar.org")
NODE_NAME=$(ask "Node name" "TELKOMSEL-JKT-01")
PROVIDER_NAME=$(ask "Provider name" "Telkomsel")
NETWORK_TYPE=$(ask "Network type" "mobile")
EXPECTED_ORG=$(ask "Expected org keyword" "telkomsel")
AGENT_SECRET=$(ask "Agent secret from dashboard/database" "")
POLL_INTERVAL_MS=$(ask "Poll interval ms" "3000")

cat > "$ENV_FILE" <<EOF
CENTRAL_URL=$CENTRAL_URL
NODE_NAME=$NODE_NAME
PROVIDER_NAME=$PROVIDER_NAME
NETWORK_TYPE=$NETWORK_TYPE
EXPECTED_ORG=$EXPECTED_ORG
AGENT_SECRET=$AGENT_SECRET
POLL_INTERVAL_MS=$POLL_INTERVAL_MS
STATUS_KEYWORDS=internetpositif,trustpositif,nawala
EOF

cat > "$RUN_FILE" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -a
source "$HOME/Domain-Radar/.env.provider-node"
set +a
cd "$HOME/Domain-Radar"
node agent/provider-poll-agent.js 2>&1 | tee -a "$HOME/Domain-Radar/provider-node.log"
EOF
chmod +x "$RUN_FILE"

say "Config saved to $ENV_FILE"
say "Run with: cd ~/Domain-Radar && ./run-provider-node.sh"
say "Log file: $LOG_FILE"
