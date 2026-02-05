# Polymarket Agent

OpenClaw extension for Polymarket prediction market trading, focusing on 15-minute BTC updown markets.

## Features

- **Real-time WebSocket streaming** - Live price updates via Polymarket CLOB WebSocket
- **BTC 15m market tracking** - Automatic detection and tracking of rotating 15-minute markets
- **Dry-run mode** - Safe testing and warmup without real trades
- **Sanity checks** - Built-in validation and anomaly detection

## Quick Start

### 1. Install Dependencies

```bash
cd extensions/polymarket
pnpm install
```

### 2. Build

```bash
pnpm build
```

### 3. Detect Current Market

```bash
node dist/cli.js detect
```

### 4. Test WebSocket

```bash
node dist/cli.js test
```

### 5. Start Agent (Dry Run)

```bash
node dist/cli.js start
```

## Environment Variables

Create a `.env` file:

```bash
# Dry run mode (no real trades)
POLYMARKET_DRY_RUN=true

# Risk limits
POLYMARKET_MAX_POSITION_SIZE=100

# Agent behavior
POLYMARKET_CHECK_INTERVAL=60

# Logging
POLYMARKET_LOG_LEVEL=info
```

## Architecture

```
src/
├── agent.ts           # Main trading agent logic
├── btc-tracker.ts     # BTC 15m market detection and tracking
├── websocket.ts       # Polymarket CLOB WebSocket client
├── types.ts           # TypeScript type definitions
├── cli.ts             # Command-line interface
└── index.ts           # Public exports
```

## Usage

### Detect Current Market

Finds the active 15-minute BTC updown market:

```bash
node dist/cli.js detect
```

### Test WebSocket Connection

Subscribe to live market updates:

```bash
node dist/cli.js test
```

Press Ctrl+C to stop.

### Run Agent (Dry Run)

Start the autonomous agent in dry-run mode:

```bash
node dist/cli.js start
```

The agent will:

- Detect the current BTC 15m market
- Subscribe to real-time price/orderbook updates via WebSocket
- Evaluate trading opportunities every 60 seconds
- Log signals it would execute (but doesn't actually trade)
- Automatically switch to new markets as they rotate

Press Ctrl+C to stop and see statistics.

### Debug Mode

Enable detailed logging:

```bash
POLYMARKET_LOG_LEVEL=debug node dist/cli.js start
```

## Development

### Project Scripts

```bash
# Build TypeScript
pnpm build

# Watch mode
pnpm dev

# Run tests
pnpm test
```

### Adding Custom Strategies

Edit `src/agent.ts` and modify the `evaluateMarket()` method to implement your trading logic.

## WebSocket API

The extension uses the Polymarket CLOB WebSocket API:

- **Endpoint:** `wss://ws-subscriptions-clob.polymarket.com/ws/market`
- **Docs:** https://docs.polymarket.com/developers/CLOB/websocket/wss-overview

Subscriptions include:

- Live price updates
- Orderbook depth
- Trade events

## Sanity Checks

The agent includes built-in sanity checks:

- **Price validation** - Ensures prices are between 1-99%
- **Sum check** - Verifies YES + NO ≈ 1.0
- **Anomaly detection** - Flags unusual market behavior
- **Market expiry** - Auto-refreshes when 15m period ends

## Safety

⚠️ **DRY RUN MODE IS ENABLED BY DEFAULT**

The agent runs in dry-run mode by default and will NOT execute real trades. All signals are logged for evaluation.

To enable live trading (not recommended yet):

```bash
POLYMARKET_DRY_RUN=false node dist/cli.js start
```

## Example Output

```
Starting Polymarket BTC 15m agent...

[Agent] Starting Polymarket BTC 15m agent (DRY RUN MODE)
[Agent] Config: { dryRun: true, maxPositionSize: 100, ... }
[Polymarket WS] Connected
[BTC Tracker] Detected market: BTC UPDOWN 15M 1770198300
[BTC Tracker] End time: 2026-02-04T15:45:00.000Z
[BTC Tracker] YES token: 0x1234...
[BTC Tracker] NO token: 0x5678...
[Agent] Agent started successfully

Agent running. Press Ctrl+C to stop.

[BTC Tracker] Trade: BUY YES @ 0.52 (size: 100)
[BTC Tracker] Trade: SELL YES @ 0.51 (size: 50)

============================================================
[DRY RUN SIGNAL]
Market: 0x42...
Outcome: YES
Side: BUY
Price: 14.20%
Size: $100
Reason: YES at 14.2% - potential contrarian opportunity
Confidence: 30.0%
============================================================
```

## Next Steps

1. ✅ Basic WebSocket connection - DONE
2. ✅ Market detection - DONE
3. ✅ Dry-run agent - DONE
4. 🔄 Add historical data analysis
5. 🔄 Implement advanced strategies
6. 🔄 Add backtesting framework
7. 🔄 Risk management enhancements

## Documentation

- Polymarket API: https://docs.polymarket.com
- CLOB WebSocket: https://docs.polymarket.com/developers/CLOB/websocket/wss-overview
- OpenClaw: https://docs.openclaw.ai

## License

MIT (inherits from OpenClaw)
