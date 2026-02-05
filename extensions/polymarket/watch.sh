#!/bin/bash
# Watch Polymarket agent trading activity in real-time

LOG_FILE="${1:-/tmp/polymarket-realtime.log}"

echo "🔍 Watching Polymarket agent..."
echo "📊 Filtering for: Signals, Trades, Performance"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

tail -f "$LOG_FILE" | grep --line-buffered -E \
  "Market:|expiry:|YES:.*NO:|Signal Analysis|Time Decay:|Orderbook:|Momentum:|BTC Move:|Composite:|DRY RUN SIGNAL|EXECUTED PT-|CLOSED PT-|Market expired|Win Rate:|ROI:|Starting Capital:|Ending Capital:" \
  | sed 's/\[BTC Tracker\] //g' \
  | sed 's/\[Agent\] //g' \
  | sed 's/\[Paper Trade\] //g'
