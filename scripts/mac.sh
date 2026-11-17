#!/bin/bash
# Everything the go-live steps need on a Mac, one command per step. docs/BADER_MAC.md walks
# through them in order; each one can be run again safely.
#
#   ./scripts/mac.sh setup          once: Node, packages, Apple's WWDR certificate, our key and CSR, .env
#   ./scripts/mac.sh cert [file]    after Apple: pass.cer (default ~/Downloads/pass.cer) -> certs/pass.pem
#   ./scripts/mac.sh google <file>  after Google: the service account key JSON -> certs/
#   ./scripts/mac.sh test-cafe      a test merchant with a staff key and a dashboard sign-in
#   ./scripts/mac.sh tunnel         the server on a temporary public HTTPS address, for the phone test
#   ./scripts/mac.sh lan            the server on this Wi-Fi only (cards install, but never update)
#   ./scripts/mac.sh check          is everything in place? (npm run doctor)
#   ./scripts/mac.sh clean-test     after the test: deletes the test database
#
# Written for the bash every Mac has (3.2): no newer bash features.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# KEY=value in .env: replaced where it is, added at the end otherwise.
set_env() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$value" '
    BEGIN { done = 0 }
    $0 ~ "^" k "=" { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' .env > "$tmp"
  cat "$tmp" > .env
  rm -f "$tmp"
}

get_env() {
  [ -f .env ] || return 0
  awk -F= -v k="$1" '$1 == k { sub(/^[^=]*=/, ""); print; exit }' .env
}

node_ok() {
  have node || return 1
  local v major minor
  v="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  major="${v%%.*}"
  minor="${v#*.}"
  minor="${minor%%.*}"
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }
}

# Node 22.13 or newer on PATH: the one already there, Homebrew's node@22, or a fresh install of it.
use_node() {
  if node_ok; then return; fi
  local prefix=""
  if have brew; then prefix="$(brew --prefix)"; fi
  if [ -n "$prefix" ] && [ -d "$prefix/opt/node@22/bin" ]; then
    PATH="$prefix/opt/node@22/bin:$PATH"
    export PATH
    node_ok && return
  fi
  if ! have brew; then
    die "Node 22 is needed. Install Homebrew first (brew.sh), by pasting this into Terminal:
    /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"
  then run this command again. (Or install Node 22 LTS from nodejs.org.)"
  fi
  bold "Installing Node 22 with Homebrew..."
  brew install node@22
  PATH="$prefix/opt/node@22/bin:$PATH"
  export PATH
  node_ok || die "Node 22 did not install. Try: brew install node@22"
  warn "So that 'npm' works in your own Terminal windows too, run once:"
  echo "    echo 'export PATH=\"$prefix/opt/node@22/bin:\$PATH\"' >> ~/.zprofile"
}

cmd_setup() {
  bold "1/5 Node"
  use_node
  ok "Node $(node -v)"

  bold "2/5 Packages"
  npm ci --no-audit --no-fund
  ok "Installed"

  bold "3/5 Settings (.env)"
  if [ -f .env ]; then
    ok ".env already exists; left as it is"
  else
    cp .env.example .env
    chmod 600 .env
    set_env PUBLIC_URL "http://localhost:8787"
    set_env APP_SECRET "$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
    set_env APPLE_TEAM_ID "LZ8RFD29KM"
    set_env PASS_TYPE_ID "pass.com.theoffice.loyalty"
    ok "Made .env with a fresh APP_SECRET, our team and Pass Type ID"
  fi

  bold "4/5 Apple's WWDR G4 certificate"
  if [ -f certs/wwdr-g4.pem ]; then ok "Already in certs/wwdr-g4.pem"; else npm run --silent apple -- wwdr; fi

  bold "5/5 Our private key and the request (CSR) for Apple"
  npm run --silent apple -- csr

  echo
  bold "Next, on developer.apple.com (docs/BADER_MAC.md, step 3):"
  echo "  Create the Pass Type ID pass.com.theoffice.loyalty, then its certificate from"
  echo "  ~/Desktop/loyalty-pass.csr, and download pass.cer. Then run: ./scripts/mac.sh cert"
  if have open; then
    open "https://developer.apple.com/account/resources/identifiers/list/passTypeId" || true
    [ -f "$HOME/Desktop/loyalty-pass.csr" ] && open -R "$HOME/Desktop/loyalty-pass.csr" || true
  fi
}

cmd_cert() {
  use_node
  local file="${1:-$HOME/Downloads/pass.cer}"
  [ -f "$file" ] || die "No certificate at $file. Download pass.cer from developer.apple.com, or give its path: ./scripts/mac.sh cert /path/to/pass.cer"
  npm run --silent apple -- cert "$file"
  echo
  cmd_check || true
}

cmd_google() {
  use_node
  local file="${1:-}"
  [ -n "$file" ] && [ -f "$file" ] || die "Give the key file Google downloaded: ./scripts/mac.sh google ~/Downloads/<project>-<id>.json"
  node -e '
    const k = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    if (k.type !== "service_account" || !k.client_email || !k.private_key) { console.error("Not a service account key file"); process.exit(1) }
    console.log("Service account: " + k.client_email)
  ' "$file" || die "That file is not a Google service account key (docs/MANUAL_STEPS.md §5)."
  mkdir -p certs
  cp "$file" certs/google-service-account.json
  chmod 600 certs/google-service-account.json
  [ -f .env ] || die "Run ./scripts/mac.sh setup first."
  set_env GOOGLE_ISSUER_ID "3388000000023224499"
  set_env GOOGLE_SERVICE_ACCOUNT_PATH "certs/google-service-account.json"
  ok "Saved as certs/google-service-account.json and switched Google Wallet on in .env"
  warn "Now delete the copy in Downloads: it can create cards in our name. (Empty the Bin too.)"
  echo
  cmd_check || true
}

cmd_test_cafe() {
  use_node
  [ -f .env ] || die "Run ./scripts/mac.sh setup first."
  if npm run --silent merchant -- show --slug test-cafe >/dev/null 2>&1; then
    ok "test-cafe already exists"
  else
    npm run --silent merchant -- create --slug test-cafe --name "Test Cafe" --name-ar "مقهى تجريبي" --program stamps \
      --threshold 3 --reward "Free coffee" --reward-ar "قهوة مجانية"
  fi
  echo
  bold "Staff key for the counter (paste it once on PUBLIC_URL/staff):"
  npm run --silent merchant -- staff-key --slug test-cafe --label "Test counter"
  echo
  local email="${1:-}"
  if [ -z "$email" ]; then
    printf "Email for the dashboard sign-in (Enter to skip): "
    read -r email
  fi
  if [ -n "$email" ]; then
    bold "Dashboard sign-in (PUBLIC_URL/admin):"
    npm run --silent merchant -- admin --slug test-cafe --email "$email" ||
      warn "That email already has a sign-in. Forgot its password? npm run merchant -- admin-reset --email $email"
  fi
}

port() {
  local p
  p="$(get_env PORT)"
  echo "${p:-8787}"
}

cmd_tunnel() {
  use_node
  [ -f .env ] || die "Run ./scripts/mac.sh setup first."
  if ! have cloudflared; then
    have brew || die "cloudflared is needed: install Homebrew (brew.sh), then run this again."
    bold "Installing cloudflared (Cloudflare's tunnel) with Homebrew..."
    brew install cloudflared
  fi
  warn "While this runs, anyone with the random address can reach this test server. Stop it (Ctrl+C) after the test."
  local url
  # Not local: the exit trap needs them after this function returns.
  TUNNEL_LOG="$(mktemp)"
  cloudflared tunnel --no-autoupdate --url "http://localhost:$(port)" >"$TUNNEL_LOG" 2>&1 &
  TUNNEL_PID=$!
  trap 'kill "$TUNNEL_PID" 2>/dev/null || true; rm -f "$TUNNEL_LOG"' EXIT
  trap 'exit 130' INT TERM
  local log="$TUNNEL_LOG" tunnel_pid="$TUNNEL_PID"
  url=""
  for _ in $(seq 1 40); do
    url="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1 || true)"
    [ -n "$url" ] && break
    kill -0 "$tunnel_pid" 2>/dev/null || { cat "$log"; die "cloudflared stopped."; }
    sleep 1
  done
  [ -n "$url" ] || { cat "$log"; die "No tunnel address after 40 seconds."; }
  set_env PUBLIC_URL "$url"
  ok "Public address: $url (written to .env as PUBLIC_URL)"
  echo
  bold "On the iPhone, in Safari:   $url/m/test-cafe"
  bold "Staff page (any browser):   $url/staff"
  bold "Dashboard:                  $url/admin"
  echo
  echo "Starting the server. Ctrl+C stops the server and the tunnel."
  echo
  npm start
}

cmd_lan() {
  use_node
  [ -f .env ] || die "Run ./scripts/mac.sh setup first."
  local ip
  ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  [ -n "$ip" ] || die "Not on a Wi-Fi or wired network."
  set_env PUBLIC_URL "http://$ip:$(port)"
  warn "Plain HTTP on this Wi-Fi: cards install and scan, but never update. If macOS asks whether node may accept incoming connections, allow it."
  bold "On a phone on the same Wi-Fi: http://$ip:$(port)/m/test-cafe"
  npm start
}

cmd_check() {
  use_node
  [ -f .env ] || die "Run ./scripts/mac.sh setup first."
  npm run --silent doctor -- "$@"
}

cmd_clean_test() {
  local db
  db="$(get_env DB_PATH)"
  db="${db:-data/loyalty.db}"
  [ "$db" = "data/loyalty.db" ] || die "DB_PATH is $db, not the test database. Delete it by hand if you are sure."
  [ -f "$ROOT/data/loyalty.db" ] || { ok "No test database to delete."; return; }
  printf "Delete the test database (every test card, staff key and sign-in)? Type yes: "
  local answer
  read -r answer
  [ "$answer" = "yes" ] || die "Left as it is."
  rm -f "$ROOT/data/loyalty.db" "$ROOT/data/loyalty.db-wal" "$ROOT/data/loyalty.db-shm"
  ok "Deleted. Remove the test cards from the phones too (Wallet → card → ⋯ → Remove Pass)."
}

case "${1:-}" in
  setup) cmd_setup ;;
  cert) shift; cmd_cert "$@" ;;
  google) shift; cmd_google "$@" ;;
  test-cafe) shift; cmd_test_cafe "$@" ;;
  tunnel) cmd_tunnel ;;
  lan) cmd_lan ;;
  check) shift; cmd_check "$@" ;;
  clean-test) cmd_clean_test ;;
  *)
    sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
