#!/bin/bash
# Quick start MarketingOS
echo "🚀 Starting MarketingOS..."
cd ~/marketingos

# Kill any existing server
pkill -f "next dev" 2>/dev/null
sleep 1

# Start dev server in background
npm run dev &
sleep 5

# Check if running
if curl -s http://localhost:3001 > /dev/null 2>&1; then
    echo "✅ MarketingOS running at http://localhost:3001"
    open http://localhost:3001
else
    echo "⏳ Still starting... wait a moment"
fi
