#!/bin/bash

echo "==================="
echo "OrderTech Server Status"
echo "==================="
echo

# Check which ports are in use
echo "Port Status:"
PORTS=$(lsof -i -P | grep ":8080\|:3000" | grep LISTEN)
if [ ! -z "$PORTS" ]; then
    echo "$PORTS"
else
    echo "No processes listening on ports 3000 or 8080"
fi
echo

# Check running processes
echo "Running Processes:"
ps aux | grep -E "(node server.js|block_port_3000)" | grep -v grep
echo

# Check server accessibility
echo "Server Accessibility Test:"
if curl -s http://localhost:8080/presence/displays -H "x-tenant-id: 450202" > /dev/null; then
    echo "✅ Server is accessible on http://localhost:8080"
else
    echo "❌ Server is not accessible on http://localhost:8080"
fi

if curl -s http://localhost:3000/presence/displays -H "x-tenant-id: 450202" > /dev/null 2>&1; then
    echo "⚠️  WARNING: Server is also accessible on port 3000"
else
    echo "✅ Port 3000 is blocked/not accessible"
fi
echo

# Show recent server logs
echo "Recent Server Logs (last 5 lines):"
tail -5 server.log 2>/dev/null || echo "No server.log found"
echo

echo "Port blocker status:"
if pgrep -f "block_port_3000.sh" > /dev/null; then
    echo "✅ Port 3000 blocker is running"
    tail -3 port_blocker.log 2>/dev/null || echo "No recent port blocker activity"
else
    echo "❌ Port 3000 blocker is not running"
fi