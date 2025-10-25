#!/bin/bash

# OrderTech Auto-Start Services Script
# This script starts all required services for OrderTech development

echo "🚀 Starting OrderTech services..."

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to check if service is running
check_service() {
    local service_name=$1
    local check_command=$2
    
    if eval $check_command >/dev/null 2>&1; then
        echo -e "  ✅ $service_name ${GREEN}already running${NC}"
        return 0
    else
        echo -e "  ❌ $service_name ${RED}not running${NC}"
        return 1
    fi
}

# Function to start service and verify
start_service() {
    local service_name=$1
    local start_command=$2
    local check_command=$3
    local wait_time=${4:-3}
    
    echo -e "  🔄 Starting $service_name..."
    eval $start_command
    sleep $wait_time
    
    if eval $check_command >/dev/null 2>&1; then
        echo -e "  ✅ $service_name ${GREEN}started successfully${NC}"
        return 0
    else
        echo -e "  ❌ $service_name ${RED}failed to start${NC}"
        return 1
    fi
}

echo ""
echo "📋 Checking current service status..."

# Check Docker
if ! check_service "Docker" "docker info"; then
    echo -e "  ${YELLOW}Starting Docker Desktop (may take 30-60 seconds)...${NC}"
    open -a Docker
    echo "  ⏳ Waiting for Docker to start..."
    while ! docker info >/dev/null 2>&1; do
        sleep 5
        echo "     Still waiting for Docker..."
    done
    echo -e "  ✅ Docker ${GREEN}started successfully${NC}"
fi

# Check Cloud SQL Proxy
if ! check_service "Cloud SQL Proxy (port 6555)" "lsof -i :6555"; then
    start_service "Cloud SQL Proxy" \
        "cloud-sql-proxy smart-order-469705:me-central1:ordertech-db --address 127.0.0.1 --port 6555 &" \
        "lsof -i :6555" 5
fi

# Check Redis
if ! check_service "Redis (port 6379)" "lsof -i :6379"; then
    start_service "Redis" \
        "brew services start redis" \
        "lsof -i :6379" 3
fi

# Check MinIO (Docker container)
if ! check_service "MinIO Container" "docker ps --filter name=minio --filter status=running | grep -q minio"; then
    echo -e "  🔄 Starting MinIO container..."
    docker run -d --name minio \
        -p 9000:9000 \
        -p 9001:9001 \
        -e "MINIO_ROOT_USER=ordertech" \
        -e "MINIO_ROOT_PASSWORD=ordertech123" \
        -v /Users/mosawi/DATATECH/OrderTech/data/minio:/data \
        quay.io/minio/minio server /data --console-address ":9001" 2>/dev/null || \
    docker start minio 2>/dev/null
    
    sleep 5
    if docker ps --filter name=minio --filter status=running | grep -q minio; then
        echo -e "  ✅ MinIO ${GREEN}started successfully${NC}"
    else
        echo -e "  ❌ MinIO ${RED}failed to start${NC}"
    fi
fi

echo ""
echo "🔍 Final service status check..."

# Final status report
SERVICES_OK=true

echo "  🖥️  Docker:           $(docker info >/dev/null 2>&1 && echo -e "${GREEN}✅ Running${NC}" || echo -e "${RED}❌ Not running${NC}")"
echo "  💾 Cloud SQL Proxy:  $(lsof -i :6555 >/dev/null 2>&1 && echo -e "${GREEN}✅ Running (port 6555)${NC}" || echo -e "${RED}❌ Not running${NC}")"
echo "  📦 Redis:            $(lsof -i :6379 >/dev/null 2>&1 && echo -e "${GREEN}✅ Running (port 6379)${NC}" || echo -e "${RED}❌ Not running${NC}")"
echo "  🗄️  MinIO API:        $(lsof -i :9000 >/dev/null 2>&1 && echo -e "${GREEN}✅ Running (port 9000)${NC}" || echo -e "${RED}❌ Not running${NC}")"
echo "  🖥️  MinIO Console:    $(lsof -i :9001 >/dev/null 2>&1 && echo -e "${GREEN}✅ Running (port 9001)${NC}" || echo -e "${RED}❌ Not running${NC}")"

# Check if all required services are running
if ! docker info >/dev/null 2>&1; then SERVICES_OK=false; fi
if ! lsof -i :6555 >/dev/null 2>&1; then SERVICES_OK=false; fi
if ! lsof -i :6379 >/dev/null 2>&1; then SERVICES_OK=false; fi
if ! lsof -i :9000 >/dev/null 2>&1; then SERVICES_OK=false; fi

echo ""
if [ "$SERVICES_OK" = true ]; then
    echo -e "🎉 ${GREEN}All services are running!${NC} Ready to start OrderTech."
    echo ""
    echo "📋 Next steps:"
    echo "   1. Run: cd /Users/mosawi/DATATECH/OrderTech"
    echo "   2. Run: node start.js"
    echo "   3. Access dashboard: http://localhost:8080/server"
else
    echo -e "⚠️  ${YELLOW}Some services failed to start.${NC} Check the errors above."
    echo "   You may need to troubleshoot individual services."
fi

echo ""