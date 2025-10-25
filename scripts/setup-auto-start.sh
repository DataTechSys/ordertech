#!/bin/bash

# OrderTech Auto-Start Setup Script
# This script enables or disables automatic service startup on Mac login

PLIST_FILE="$HOME/Library/LaunchAgents/com.ordertech.services.plist"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

show_help() {
    echo "OrderTech Auto-Start Setup"
    echo ""
    echo "Usage: $0 [enable|disable|status|test]"
    echo ""
    echo "Commands:"
    echo "  enable   - Enable auto-start services on login"
    echo "  disable  - Disable auto-start services"
    echo "  status   - Show current auto-start status"
    echo "  test     - Run the startup script manually (for testing)"
    echo ""
}

case "$1" in
    "enable")
        echo "🔧 Enabling OrderTech auto-start services..."
        
        # Load the launch agent
        launchctl load "$PLIST_FILE" 2>/dev/null || {
            echo -e "${RED}❌ Failed to load launch agent${NC}"
            echo "Make sure the plist file exists: $PLIST_FILE"
            exit 1
        }
        
        echo -e "✅ ${GREEN}Auto-start enabled!${NC}"
        echo ""
        echo "Services will automatically start when you log in to macOS."
        echo "Logs will be saved to: /Users/mosawi/DATATECH/OrderTech/logs/"
        ;;
        
    "disable")
        echo "🛑 Disabling OrderTech auto-start services..."
        
        # Unload the launch agent
        launchctl unload "$PLIST_FILE" 2>/dev/null
        
        echo -e "✅ ${GREEN}Auto-start disabled!${NC}"
        echo "Services will not automatically start on login."
        ;;
        
    "status")
        echo "📋 OrderTech Auto-Start Status:"
        echo ""
        
        if launchctl list | grep -q "com.ordertech.services"; then
            echo -e "  Auto-start: ${GREEN}✅ ENABLED${NC}"
            echo "  Services will start automatically on login"
        else
            echo -e "  Auto-start: ${RED}❌ DISABLED${NC}"
            echo "  Services will NOT start automatically on login"
        fi
        
        echo ""
        echo "Manual startup script: ./scripts/auto-start-services.sh"
        echo "Logs directory: ./logs/"
        ;;
        
    "test")
        echo "🧪 Testing OrderTech service startup script..."
        echo ""
        /Users/mosawi/DATATECH/OrderTech/scripts/auto-start-services.sh
        ;;
        
    *)
        show_help
        ;;
esac