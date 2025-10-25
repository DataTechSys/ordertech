#!/bin/bash
# Setup script for OrderTech database configuration

echo "🔧 OrderTech Database Setup"
echo "=========================="

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ .env.local not found. Please create it from .env.example"
    echo "   cp .env.example .env.local"
    echo "   Then edit .env.local with your actual database credentials"
    exit 1
fi

echo "✅ Found .env.local configuration"

# Check if Cloud SQL proxy is running on port 6555
if ! lsof -i:6555 > /dev/null 2>&1; then
    echo "⚠️  Cloud SQL proxy not detected on port 6555"
    echo "   Start it with:"
    echo "   cloud_sql_proxy --credentials-file=path/to/key.json instance_connection_name --port 6555"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✅ Cloud SQL proxy running on port 6555"
fi

# Test local server
if ! curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo "🚀 Starting local server..."
    npm start &
    SERVER_PID=$!
    echo "   Server PID: $SERVER_PID"
    sleep 3
else
    echo "✅ Local server already running on port 3000"
fi

# Test database connection
echo "🔍 Testing database connection..."
if curl -s http://localhost:3000/admin/sync-modifiers/final | grep -q "db_required"; then
    echo "❌ Database connection failed"
    echo "   Check your DATABASE_URL in .env.local"
    exit 1
else
    echo "✅ Database connection working"
fi

echo ""
echo "🎉 Setup complete!"
echo "   - Local server: http://localhost:3000"
echo "   - Admin page: http://localhost:3000/admin"
echo "   - Final sync: curl -X POST http://localhost:3000/admin/sync-modifiers/final"