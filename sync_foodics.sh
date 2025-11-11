#!/bin/bash
cd /Users/mosawi/DATATECH/OrderTech
/usr/local/bin/node sync_foodics_orders.js 50 >> /Users/mosawi/DATATECH/OrderTech/logs/foodics_sync.log 2>&1
