#!/usr/bin/env bash
# Setup local HTTPS for console.ordertech.me and api.ordertech.me via mkcert + Homebrew nginx
# - Installs mkcert, nginx, cloud-sql-proxy if missing (Homebrew)
# - Issues a trusted local cert for both hostnames
# - Writes a brew nginx servers/ordertech-local.conf that proxies both hosts to 127.0.0.1:3000
# - Adds hosts entries (attempts non-interactive sudo; falls back with instructions)
# Safe: no secrets printed. Does not modify your app source.

set -Eeuo pipefail

have(){ command -v "$1" >/dev/null 2>&1; }
need_brew(){ command -v brew >/dev/null 2>&1 || { echo "Homebrew not found. Install from https://brew.sh then re-run." >&2; exit 1; }; }

need_brew
BREW_PREFIX="$(brew --prefix)"

# Ensure tools
if ! have mkcert; then
  echo "[setup] Installing mkcert via Homebrew..."
  brew install mkcert
fi
if ! have nginx; then
  echo "[setup] Installing nginx via Homebrew..."
  brew install nginx
fi
if ! have cloud-sql-proxy; then
  echo "[setup] Installing Cloud SQL Auth Proxy via Homebrew..."
  brew install cloud-sql-proxy
fi

# Trust local CA (may open a macOS trust prompt once)
echo "[setup] Ensuring mkcert local CA is installed (one-time)..."
mkcert -install

SSL_DIR="$HOME/.ordertech-local/ssl"
mkdir -p "$SSL_DIR"
CERT="$SSL_DIR/ordertech-local.pem"
KEY="$SSL_DIR/ordertech-local-key.pem"
if [[ ! -f "$CERT" || ! -f "$KEY" ]]; then
  echo "[setup] Issuing local cert for console.ordertech.me and api.ordertech.me ..."
  mkcert -cert-file "$CERT" -key-file "$KEY" console.ordertech.me api.ordertech.me
else
  echo "[setup] Reusing existing cert: $CERT"
fi

NG_DIR="$BREW_PREFIX/etc/nginx"
SERVERS_DIR="$NG_DIR/servers"
mkdir -p "$SERVERS_DIR"
CONF="$SERVERS_DIR/ordertech-local.conf"

# Write nginx server config
cat > "$CONF" <<'NGCONF'
server {
  listen 80;
  server_name console.ordertech.me api.ordertech.me;
  return 301 https://$host$request_uri;
}

server {
  listen 443 ssl;
  server_name console.ordertech.me;

  ssl_certificate     __CERT__;
  ssl_certificate_key __KEY__;

  location / {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_pass http://127.0.0.1:3000;
  }
}

server {
  listen 443 ssl;
  server_name api.ordertech.me;

  ssl_certificate     __CERT__;
  ssl_certificate_key __KEY__;

  location / {
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_pass http://127.0.0.1:3000;
  }
}
NGCONF

# Replace placeholders with actual cert paths (safe sed)
sed -i '' -e "s#__CERT__#${CERT//\//\/}#g" -e "s#__KEY__#${KEY//\//\/}#g" "$CONF"

# Hosts entries (non-interactive sudo if available)
for H in console.ordertech.me api.ordertech.me; do
  if ! grep -q "[[:space:]]$H\b" /etc/hosts 2>/dev/null; then
    echo "[setup] Adding /etc/hosts entry for $H"
    if ! printf "127.0.0.1 $H\n" | sudo -n tee -a /etc/hosts >/dev/null 2>&1; then
      echo "[setup] Could not add hosts entry automatically (sudo needed). Run this command manually:"
      echo "  echo '127.0.0.1 $H' | sudo tee -a /etc/hosts"
    fi
  fi
done

# Test and restart nginx
if ! nginx -t >/dev/null 2>&1; then
  echo "[setup] nginx config test failed. Showing details:" >&2
  nginx -t || true
  exit 1
fi

echo "[setup] Restarting nginx via brew services..."
# Start or restart
brew services list | grep -q '^nginx\s' && brew services restart nginx || brew services start nginx

echo "[setup] Local HTTPS is configured. Visit: https://console.ordertech.me and https://api.ordertech.me"