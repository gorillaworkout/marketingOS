#!/bin/bash
# MarketingOS — Auto Team Launcher
# Jalankan: ./team.sh start | stop | status | logs

TEAM_NAME="marketingos-team"
PROFILES=("fe-agent" "be-agent" "qa-agent" "pm-agent")

start() {
    echo "🚀 Starting MarketingOS Agent Team..."
    
    for profile in "${PROFILES[@]}"; do
        if tmux has-session -t "$profile" 2>/dev/null; then
            echo "  ⚠️  $profile already running"
        else
            tmux new-session -d -s "$profile" "hermes -p $profile"
            echo "  ✅ $profile started"
        fi
    done
    
    echo ""
    echo "📋 Team Status:"
    tmux list-sessions 2>/dev/null | grep -E "fe-agent|be-agent|qa-agent|pm-agent"
    echo ""
    echo "💡 Usage:"
    echo "   tmux attach -t pm-agent    # Talk to PM"
    echo "   tmux attach -t fe-agent    # Talk to Frontend"
    echo "   tmux attach -t be-agent    # Talk to Backend"
    echo "   tmux attach -t qa-agent    # Talk to QA"
    echo ""
    echo "   Or from your main Hermes session:"
    echo "   /agents  # See active agents"
}

stop() {
    echo "🛑 Stopping MarketingOS Agent Team..."
    for profile in "${PROFILES[@]}"; do
        if tmux has-session -t "$profile" 2>/dev/null; then
            tmux kill-session -t "$profile"
            echo "  ✅ $profile stopped"
        fi
    done
}

status() {
    echo "📊 MarketingOS Agent Team Status:"
    echo ""
    for profile in "${PROFILES[@]}"; do
        if tmux has-session -t "$profile" 2>/dev/null; then
            echo "  🟢 $profile — running"
        else
            echo "  🔴 $profile — stopped"
        fi
    done
}

logs() {
    echo "📋 Recent agent activity:"
    for profile in "${PROFILES[@]}"; do
        if tmux has-session -t "$profile" 2>/dev/null; then
            echo ""
            echo "=== $profile ==="
            tmux capture-pane -t "$profile" -p | tail -5
        fi
    done
}

case "$1" in
    start)  start ;;
    stop)   stop ;;
    status) status ;;
    logs)   logs ;;
    *)
        echo "Usage: $0 {start|stop|status|logs}"
        exit 1
        ;;
esac
