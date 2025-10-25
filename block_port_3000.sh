#!/bin/bash

# Script to continuously monitor and kill processes using port 3000
# This ensures only port 8080 is used for the OrderTech server

echo "Starting port 3000 blocker - will kill any processes using port 3000..."
echo "Press Ctrl+C to stop"

while true; do
    # Find process using port 3000
    PID=$(lsof -ti:3000)
    
    if [ ! -z "$PID" ]; then
        echo "$(date): Found process $PID using port 3000, killing it..."
        kill -9 $PID
        echo "$(date): Process $PID killed"
    fi
    
    sleep 2
done