#!/usr/bin/env bash
set -euo pipefail

# OrderTech Development Stack Startup
# Starts all infrastructure services and reverse proxy

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"
DEV_DIR="$ROOT_DIR/dev"

echo "🚀 Starting OrderTech Development Stack..."
echo "================================================="

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed or not running"
    echo "   Please install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker daemon is not running"
    echo "   Please start Docker Desktop"
    exit 1
fi

# Check if Caddy is available
if ! command -v caddy &> /dev/null; then
    echo "❌ Caddy is not installed"
    echo "   Please install with: brew install caddy"
    exit 1
fi

# Change to dev directory
cd "$DEV_DIR"

# Check for environment file
if [[ ! -f .env.local ]]; then
    echo "⚠️  Environment file not found: dev/.env.local"
    echo "   Creating from template..."
    if [[ -f .env.cloud.example ]]; then
        cp .env.cloud.example .env.local
        echo "   ✅ Created dev/.env.local from template"
        echo "   📝 Please edit dev/.env.local with your actual credentials"
    else
        echo "   ❌ Template not found: dev/.env.cloud.example"
        exit 1
    fi
fi

# Load environment variables for docker-compose
if [[ -f .env.local ]]; then
    set -a  # automatically export all variables
    source .env.local
    set +a
fi

# Check for critical port conflicts (skip detailed checking for now)
echo "🔍 Checking critical ports..."

# Only check ports that would definitely conflict (not 80/443 which Caddy needs)
CRITICAL_PORTS=(5050 6379 7880 8081 9000 9001)
PORTS_IN_USE=()

for port in "${CRITICAL_PORTS[@]}"; do
    if netstat -an | grep -E "\.$port[[:space:]].*LISTEN" &> /dev/null; then
        PROCESS_INFO=$(lsof -i ":$port" -t | head -1 | xargs ps -p 2>/dev/null | tail -1 || echo "unknown process")
        PORTS_IN_USE+=("$port")
    fi
done

if [[ ${#PORTS_IN_USE[@]} -gt 0 ]]; then
    echo "⚠️  Some infrastructure ports may be in use: ${PORTS_IN_USE[*]}"
    echo "   The script will try to start anyway..."
    echo "   If you encounter issues, you can stop conflicting processes"
else
    echo "✅ Infrastructure ports are available"
fi

# Start infrastructure services
echo "🐳 Starting infrastructure containers..."
echo "   - Redis (cache/session store)"
echo "   - MinIO (S3-compatible storage)"
echo "   - pgAdmin (database administration)"
echo "   - LiveKit (WebRTC server)"
echo "   - Redis Commander (Redis admin UI)"

docker compose up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check service health
UNHEALTHY_SERVICES=()
for service in redis minio livekit; do
    if ! docker compose ps --format json | jq -r ".[] | select(.Service==\"$service\") | .Health" | grep -q "healthy" 2>/dev/null; then
        # For services without health checks, just check if they're running
        if ! docker compose ps --format json | jq -r ".[] | select(.Service==\"$service\") | .State" | grep -q "running" 2>/dev/null; then
            UNHEALTHY_SERVICES+=("$service")
        fi
    fi
done

if [[ ${#UNHEALTHY_SERVICES[@]} -gt 0 ]]; then
    echo "⚠️  Some services may not be fully ready:"
    for service in "${UNHEALTHY_SERVICES[@]}"; do
        echo "   - $service"
    done
    echo "   Check logs with: docker compose logs $service"
fi

# Stop existing Caddy (if running)
echo "🔄 (Re)starting Caddy reverse proxy..."
caddy stop >/dev/null 2>&1 || true

# Start Caddy with our configuration
if caddy start --config "$DEV_DIR/Caddyfile"; then
    echo "✅ Caddy started successfully"
else
    echo "❌ Failed to start Caddy"
    echo "   Check configuration with: caddy validate --config $DEV_DIR/Caddyfile"
    exit 1
fi

# Trust certificates (if not already done)
if ! caddy trust >/dev/null 2>&1; then
    echo "🔐 Trusting Caddy's local CA certificates..."
    echo "   (You may be prompted for your password)"
    if sudo caddy trust; then
        echo "✅ Local certificates trusted"
        echo "   You may need to restart your browser"
    else
        echo "⚠️  Could not trust certificates automatically"
        echo "   You may see certificate warnings in your browser"
    fi
fi

# Check Cloud SQL Proxy status
echo "🗄️  Checking Cloud SQL Proxy status..."
if lsof -i :6555 &> /dev/null; then
    PROXY_PROCESS=$(ps aux | grep "[c]loud_sql_proxy" | head -1 | awk '{print $2}' || echo "")
    if [[ -n "$PROXY_PROCESS" ]]; then
        echo "✅ Cloud SQL Proxy is running (PID: $PROXY_PROCESS)"
    else
        echo "⚠️  Port 6555 is in use but may not be Cloud SQL Proxy"
    fi
else
    echo "⚠️  Cloud SQL Proxy not detected on port 6555"
    echo "   Start it with your existing script or manually:"
    echo "   cloud_sql_proxy smart-order-469705:me-central1:ordertech-db --port 6555"
fi

# Create MinIO bucket if it doesn't exist
echo "🗂️  Setting up MinIO bucket..."
sleep 2  # Give MinIO time to fully start

# We'll use docker exec to run mc commands inside a temporary container
if docker run --rm --network ordertech-dev_infra \
    -e MINIO_ROOT_USER="${MINIO_ROOT_USER:-ordertech-dev}" \
    -e MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-ordertech-dev-secret}" \
    minio/mc:latest sh -c "
    mc alias set local http://ordertech-minio:9000 \$MINIO_ROOT_USER \$MINIO_ROOT_PASSWORD &&
    mc mb local/ordertech-local 2>/dev/null || true &&
    mc policy set public local/ordertech-local
    " >/dev/null 2>&1; then
    echo "✅ MinIO bucket 'ordertech-local' configured"
else
    echo "⚠️  Could not configure MinIO bucket automatically"
    echo "   You can do this manually via https://storage.localhost"
fi

echo ""
echo "🎉 OrderTech Development Stack is ready!"
echo "================================================="
echo ""
echo "🌐 Access your services:"
echo "   API Server:       https://api.localhost"
echo "                     (Make sure your API is running on port 3000)"
echo ""
echo "   Database Admin:   https://db.localhost"
echo "                     Login: dev@ordertech.local / devpassword"
echo "                     Connect to: 127.0.0.1:6555 (Cloud SQL) or 127.0.0.1:5432 (Local)"
echo ""
echo "   Storage Admin:    https://storage.localhost"
echo "                     Login: ordertech-dev / ordertech-dev-secret"
echo ""
echo "   Storage API:      https://s3.localhost"
echo "                     (S3-compatible endpoint for applications)"
echo ""
echo "   Redis Admin:      https://redis.localhost"
echo "                     (No authentication required)"
echo ""
echo "   LiveKit Console:  https://livekit.localhost"
echo "                     WebSocket: wss://livekit-ws.localhost"
echo ""
echo "🚀 Next steps:"
echo "   1. Start your OrderTech API on port 3000:"
echo "      cd $ROOT_DIR"
echo "      source dev/.env.local"
echo "      PORT=3000 npm start"
echo ""
echo "   2. Test the API:"
echo "      curl -k https://api.localhost/health"
echo ""
echo "   3. Sync data from cloud (optional):"
echo "      ./dev/scripts/sync-from-cloud.sh"
echo ""
echo "   4. Stop the stack when done:"
echo "      ./dev/scripts/dev-stop.sh"
echo ""
echo "📊 Monitor services:"
echo "   docker compose logs -f          # All services"
echo "   docker compose ps               # Service status"
echo "   caddy admin localhost:2019      # Caddy admin API"