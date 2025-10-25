#!/usr/bin/env bash
set -euo pipefail

# OrderTech Development Stack Shutdown
# Stops all infrastructure services and reverse proxy

ROOT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/../.." && pwd )"
DEV_DIR="$ROOT_DIR/dev"

echo "🛑 Stopping OrderTech Development Stack..."
echo "==========================================="

# Change to dev directory
cd "$DEV_DIR"

# Stop Caddy reverse proxy
echo "🔄 Stopping Caddy reverse proxy..."
if caddy stop >/dev/null 2>&1; then
    echo "✅ Caddy stopped"
else
    echo "⚠️  Caddy was not running or failed to stop"
fi

# Stop Docker containers
echo "🐳 Stopping infrastructure containers..."
if docker compose down; then
    echo "✅ All containers stopped"
else
    echo "⚠️  Some containers may not have stopped cleanly"
fi

# Optional: Remove volumes (uncomment if you want to reset data)
# echo "🗑️  Removing volumes..."
# docker compose down -v

# Check if any services are still running on our ports
echo "🔍 Checking for remaining processes..."
PORTS_TO_CHECK=(3000 5050 6379 7880 8081 9000 9001)
STILL_RUNNING=()

for port in "${PORTS_TO_CHECK[@]}"; do
    if lsof -i ":$port" &> /dev/null; then
        PROCESS=$(lsof -i ":$port" -t | head -1)
        PROCESS_NAME=$(ps -p "$PROCESS" -o comm= 2>/dev/null || echo "unknown")
        STILL_RUNNING+=("$port ($PROCESS_NAME)")
    fi
done

if [[ ${#STILL_RUNNING[@]} -gt 0 ]]; then
    echo "⚠️  Some processes are still running:"
    for process_info in "${STILL_RUNNING[@]}"; do
        echo "   - Port $process_info"
    done
    echo ""
    echo "   If these are not needed, you can stop them with:"
    echo "   sudo lsof -ti:${PORTS_TO_CHECK[*]} | xargs kill"
else
    echo "✅ All development stack ports are free"
fi

# Check Cloud SQL Proxy (we don't stop this as it might be used elsewhere)
if lsof -i :6555 &> /dev/null; then
    echo "ℹ️  Cloud SQL Proxy is still running on port 6555"
    echo "   (This is normal - we don't manage the Cloud SQL Proxy)"
fi

echo ""
echo "✅ OrderTech Development Stack stopped"
echo "======================================="
echo ""
echo "💡 Notes:"
echo "   - Your OrderTech API (if running on port 3000) was not stopped"
echo "   - Cloud SQL Proxy (port 6555) was left running"
echo "   - Data in Redis, MinIO, and pgAdmin volumes is preserved"
echo ""
echo "🚀 To start again: ./dev/scripts/dev-start.sh"
echo "🗑️  To reset all data: docker compose down -v"