#!/bin/bash

# OrderTech Dashboard Startup Script
# Usage: ./start-dashboard.sh [dev|prod]

set -e

echo "🚀 OrderTech Dashboard Startup"
echo "=============================="

# Check if argument provided
MODE=${1:-dev}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Mode: ${MODE}${NC}"

# Check if environment file exists
if [ ! -f "server/.env.dashboard" ]; then
    echo -e "${YELLOW}⚠️  Creating environment file...${NC}"
    cp server/.env.dashboard.example server/.env.dashboard
    echo -e "${GREEN}✅ Environment file created at server/.env.dashboard${NC}"
    echo -e "${YELLOW}📝 Please edit server/.env.dashboard with your configuration${NC}"
fi

# Check database setup
echo -e "${BLUE}🔍 Checking database setup...${NC}"
if npm run dashboard:migrate --silent 2>/dev/null; then
    echo -e "${GREEN}✅ Database migrations up to date${NC}"
else
    echo -e "${YELLOW}📊 Setting up database...${NC}"
    npm run dashboard:setup
fi

case $MODE in
    "dev")
        echo -e "${GREEN}🔧 Starting in development mode (port 8080)...${NC}"
        echo -e "${BLUE}📱 Dashboard: http://localhost:8080/server${NC}"
        echo -e "${BLUE}🔗 API: http://localhost:8080/api/dashboard/summary${NC}"
        echo -e "${BLUE}❤️  Health: http://localhost:8080/health${NC}"
        echo ""
        npm run dashboard:dev
        ;;
    "prod")
        echo -e "${GREEN}🌐 Starting in production mode (port 80)...${NC}"
        echo -e "${YELLOW}⚠️  This requires sudo privileges for port 80${NC}"
        echo -e "${BLUE}📱 Dashboard: http://localhost/server${NC}"
        echo -e "${BLUE}🔗 API: http://localhost/api/dashboard/summary${NC}"
        echo -e "${BLUE}❤️  Health: http://localhost/health${NC}"
        echo ""
        
        # Check if running as root or with sudo
        if [ "$EUID" -ne 0 ]; then
            echo -e "${YELLOW}🔐 Requesting sudo privileges...${NC}"
            sudo -v
        fi
        
        npm run dashboard:prod
        ;;
    "test")
        echo -e "${GREEN}🧪 Running tests...${NC}"
        npm test
        ;;
    *)
        echo -e "${RED}❌ Invalid mode: $MODE${NC}"
        echo -e "${YELLOW}Usage: $0 [dev|prod|test]${NC}"
        echo ""
        echo -e "${BLUE}Modes:${NC}"
        echo -e "  ${GREEN}dev${NC}  - Development mode (port 8080, no sudo)"
        echo -e "  ${GREEN}prod${NC} - Production mode (port 80, requires sudo)"
        echo -e "  ${GREEN}test${NC} - Run tests"
        exit 1
        ;;
esac