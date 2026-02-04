# Polymarket Extension - Technical Specification

**Version:** 1.0.0  
**Status:** Design Phase  
**Author:** Tom Willet  
**Date:** 2026-02-03

---

## 1. Overview

### 1.1 Purpose

The Polymarket extension enables OpenClaw to interact with Polymarket prediction markets, providing:

- Market data fetching and analysis
- Autonomous trading agent capabilities
- Position and portfolio management
- Risk monitoring and alerts
- Multi-device deployment support

### 1.2 Use Cases

1. **Autonomous Trading Bot**: Run continuously, execute trades within predefined risk parameters
2. **Market Intelligence**: Monitor specific markets and alert on opportunities
3. **Portfolio Management**: Track positions, PnL, and performance metrics
4. **Research & Backtesting**: Analyze historical market data and strategy performance

### 1.3 Deployment Targets

- **Development**: Local machine with hot-reload
- **Production**: VPS (AWS Lightsail, DigitalOcean, etc.)
- **Multi-device**: Sync code via GitHub, instance-specific config via environment

---

## 2. Architecture

### 2.1 Extension Structure

```
extensions/polymarket/
├── package.json                    # Dependencies & extension metadata
├── tsconfig.json                   # TypeScript config
├── README.md                       # User-facing documentation
├── SPEC.md                         # This file
├── .env.example                    # Template for environment variables
├── src/
│   ├── index.ts                    # Extension entry point (OpenClaw plugin interface)
│   ├── types.ts                    # TypeScript type definitions
│   ├── config.ts                   # Configuration management
│   ├── api/
│   │   ├── client.ts              # Polymarket API client wrapper
│   │   ├── markets.ts             # Market data operations
│   │   ├── trading.ts             # Trade execution
│   │   └── portfolio.ts           # Position management
│   ├── strategies/
│   │   ├── base.ts                # Base strategy interface
│   │   ├── value-betting.ts      # Value-based strategy implementation
│   │   └── risk-manager.ts       # Risk management logic
│   ├── agent/
│   │   ├── trading-agent.ts      # Main autonomous agent logic
│   │   ├── scheduler.ts          # Cron/interval scheduling
│   │   └── alerts.ts             # Notification system
│   ├── commands/
│   │   ├── markets.ts            # CLI: list/search markets
│   │   ├── positions.ts          # CLI: view positions
│   │   ├── trade.ts              # CLI: execute manual trade
│   │   └── agent.ts              # CLI: start/stop agent
│   └── utils/
│       ├── logger.ts             # Structured logging
│       ├── validation.ts         # Input validation
│       └── formatting.ts         # Display formatting
├── test/
│   ├── api.test.ts               # API client tests
│   ├── strategies.test.ts        # Strategy logic tests
│   └── integration.test.ts       # E2E tests
└── scripts/
    └── setup.sh                  # Initial setup script
```

### 2.2 Data Storage

**Extension Code** (version controlled):

```
extensions/polymarket/src/        # TypeScript source
```

**Runtime Data** (per-instance, gitignored):

```
~/.openclaw/
├── config/
│   └── polymarket.json          # Instance config (risk limits, strategy params)
├── credentials/
│   └── polymarket               # API keys, private keys (encrypted)
├── data/polymarket/
│   ├── markets.json             # Latest market snapshot
│   ├── positions.jsonl          # Position history (append-only)
│   ├── performance.jsonl        # Performance metrics
│   └── archive/                 # Historical data
└── agents/polymarket-trader/
    ├── sessions/                # Agent session logs
    └── state.json               # Agent state (last run, flags, etc.)
```

### 2.3 Component Responsibilities

#### API Client (`src/api/`)

- Authenticate with Polymarket API
- Fetch market data (live prices, volume, liquidity)
- Execute trades (place orders, check fills)
- Query portfolio (positions, balance, PnL)
- Handle rate limiting and retries

#### Strategies (`src/strategies/`)

- Define trading logic (entry/exit signals)
- Calculate fair value / edge
- Determine position sizing
- Enforce risk management rules
- Support multiple strategy types

#### Agent (`src/agent/`)

- Run autonomously on schedule (cron/interval)
- Orchestrate: fetch data → analyze → trade → log
- Manage agent state (paused, active, error)
- Send alerts on critical events
- Heartbeat to main session

#### Commands (`src/commands/`)

- CLI interface for manual operations
- `openclaw polymarket markets --filter politics`
- `openclaw polymarket positions --summary`
- `openclaw polymarket trade --market <id> --side buy --amount 100`
- `openclaw polymarket agent start --strategy value-betting`

---

## 3. Core Features

### 3.1 Market Data Integration

**Requirements:**

- Fetch live market data via Polymarket API
- Filter markets by category, volume, liquidity
- Cache market data (TTL: 5 minutes default)
- Store historical snapshots for analysis

**API Surface:**

```typescript
// Fetch markets
const markets = await polymarket.markets.list({
  category: "politics",
  minVolume: 10000,
  minLiquidity: 0.95,
  limit: 100,
});

// Get specific market
const market = await polymarket.markets.get(marketId);

// Subscribe to updates (websocket)
polymarket.markets.subscribe(marketId, (update) => {
  console.log("Price update:", update);
});
```

**Data Schema:**

```typescript
interface Market {
  id: string;
  question: string;
  category: string;
  outcomes: Outcome[];
  volume24h: number;
  liquidity: number;
  resolutionDate: Date;
  currentPrice: {
    yes: number;
    no: number;
  };
  spread: number;
}
```

### 3.2 Trading Execution

**Requirements:**

- Place limit orders (buy/sell)
- Market orders (when needed)
- Order status tracking (pending, filled, canceled)
- Transaction logging (audit trail)
- Dry-run mode for testing

**API Surface:**

```typescript
// Execute trade
const trade = await polymarket.trading.execute({
  marketId: "election-2024",
  side: "buy",
  outcome: "yes",
  amount: 100, // USD
  limitPrice: 0.42,
  strategy: "limit", // or 'market'
});

// Check order status
const status = await polymarket.trading.getOrderStatus(trade.orderId);

// Cancel order
await polymarket.trading.cancelOrder(trade.orderId);
```

**Trade Logging:**

```jsonl
{"timestamp":"2026-02-03T10:15:00Z","market_id":"election-2024","side":"buy","amount":100,"price":0.42,"order_id":"abc123","status":"filled","pnl":null}
{"timestamp":"2026-02-03T12:30:00Z","market_id":"election-2024","side":"sell","amount":100,"price":0.48,"order_id":"def456","status":"filled","pnl":6.00}
```

### 3.3 Position Management

**Requirements:**

- Track all open positions (cost basis, current value)
- Calculate unrealized PnL
- Close positions (full or partial)
- Portfolio-level metrics (total exposure, diversification)

**API Surface:**

```typescript
// Get all positions
const positions = await polymarket.portfolio.getPositions();

// Get single position
const position = await polymarket.portfolio.getPosition(marketId);

// Close position
await polymarket.portfolio.closePosition(marketId, {
  amount: 100, // partial close
  limitPrice: 0.5,
});

// Portfolio summary
const summary = await polymarket.portfolio.getSummary();
// Returns: { totalValue, totalCost, unrealizedPnL, realizedPnL, positions: [...] }
```

### 3.4 Risk Management

**Requirements:**

- Pre-trade risk checks (position limits, exposure)
- Stop-loss monitoring (auto-close on breach)
- Daily/weekly loss limits
- Circuit breaker (halt on anomalies)
- Risk dashboard (current exposure, limits)

**Configuration:**

```typescript
interface RiskConfig {
  maxPositionSize: number; // Max $ per position
  maxPortfolioValue: number; // Max total portfolio $
  maxCategoryExposure: number; // Max $ in single category
  stopLossPercent: number; // Auto-close at -X%
  takeProfitPercent: number; // Auto-close at +X%
  dailyLossLimit: number; // Halt if daily loss exceeds
  maxConsecutiveLosses: number; // Halt after N losses
}
```

**Risk Checks:**

```typescript
// Pre-trade validation
const riskCheck = await riskManager.validateTrade({
  marketId: "election-2024",
  side: "buy",
  amount: 100,
  price: 0.42,
});

if (!riskCheck.approved) {
  console.error("Trade rejected:", riskCheck.reasons);
  return;
}

// Monitor positions (runs every cycle)
await riskManager.checkStopLosses();
// Auto-closes positions that breach stop-loss

// Check circuit breaker
if (riskManager.isHalted()) {
  console.log("Trading halted:", riskManager.getHaltReason());
  return;
}
```

### 3.5 Autonomous Agent

**Requirements:**

- Run on schedule (cron or interval)
- Fetch markets → analyze → execute trades → log
- Maintain state across runs
- Alert on critical events
- Support pause/resume/stop controls

**Agent Lifecycle:**

```typescript
// Start agent
await polymarket.agent.start({
  strategy: 'value-betting',
  interval: '5m', // Check every 5 minutes
  riskConfig: { ... }
});

// Agent runs in background, performing:
// 1. Fetch latest market data
// 2. Check current positions
// 3. Evaluate opportunities (strategy logic)
// 4. Execute approved trades
// 5. Monitor risk (stop-losses, limits)
// 6. Log all decisions
// 7. Alert if critical events

// Pause agent (stop trading, keep monitoring)
await polymarket.agent.pause();

// Resume agent
await polymarket.agent.resume();

// Stop agent (full shutdown)
await polymarket.agent.stop();
```

**Agent State:**

```typescript
interface AgentState {
  status: "active" | "paused" | "halted" | "error";
  lastRun: Date;
  nextRun: Date;
  cyclesCompleted: number;
  tradesExecuted: number;
  currentPnL: number;
  haltReason?: string;
}
```

### 3.6 Strategy Framework

**Requirements:**

- Pluggable strategy interface
- Built-in strategies (value betting, momentum, etc.)
- Custom strategy support
- Backtesting capabilities
- Strategy-specific logging

**Strategy Interface:**

```typescript
interface Strategy {
  name: string;
  evaluate(market: Market, positions: Position[]): TradeSignal | null;
  calculateFairValue(market: Market): number;
  determinePositionSize(market: Market, edge: number): number;
}

interface TradeSignal {
  marketId: string;
  side: "buy" | "sell";
  amount: number;
  limitPrice: number;
  reason: string; // Human-readable explanation
  confidence: number; // 0-1
}
```

**Built-in Strategy: Value Betting**

```typescript
class ValueBettingStrategy implements Strategy {
  name = "value-betting";

  evaluate(market: Market, positions: Position[]): TradeSignal | null {
    const fairValue = this.calculateFairValue(market);
    const currentPrice = market.currentPrice.yes;
    const edge = (fairValue - currentPrice) / currentPrice;

    // Require 3% minimum edge
    if (Math.abs(edge) < 0.03) return null;

    // Check liquidity and volume
    if (market.volume24h < 10000) return null;
    if (market.spread > 0.05) return null;

    // Check if already at max position
    const existingPosition = positions.find((p) => p.marketId === market.id);
    if (
      existingPosition &&
      existingPosition.value >= this.config.maxPositionSize
    ) {
      return null;
    }

    return {
      marketId: market.id,
      side: edge > 0 ? "buy" : "sell",
      amount: this.determinePositionSize(market, edge),
      limitPrice: currentPrice * (1 + (edge > 0 ? 0.01 : -0.01)), // Slight improvement
      reason: `Fair value: ${fairValue.toFixed(2)}, Current: ${currentPrice.toFixed(2)}, Edge: ${(edge * 100).toFixed(1)}%`,
      confidence: Math.min(Math.abs(edge) / 0.1, 1.0), // Max at 10% edge
    };
  }

  calculateFairValue(market: Market): number {
    // Implement fair value estimation
    // Could use: market fundamentals, historical data, external APIs, ML models
    // For MVP: placeholder logic
    return 0.5; // Simplified
  }

  determinePositionSize(market: Market, edge: number): number {
    // Kelly Criterion or fixed fractional sizing
    const baseSize = 100; // $100 default
    const scaleFactor = Math.min(Math.abs(edge) / 0.05, 2.0); // Scale up to 2x
    return Math.min(baseSize * scaleFactor, this.config.maxPositionSize);
  }
}
```

### 3.7 Alerting & Notifications

**Requirements:**

- Critical alerts to main OpenClaw session
- Configurable alert levels (critical, warning, info)
- Alert deduplication (avoid spam)
- Multiple delivery methods (WhatsApp, Telegram, etc.)

**Alert Types:**

```typescript
enum AlertLevel {
  INFO = "info", // Daily summary, routine updates
  WARNING = "warning", // Approaching limits, unusual activity
  CRITICAL = "critical", // Stop-loss, halt, errors
}

interface Alert {
  level: AlertLevel;
  title: string;
  message: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}
```

**Alert Examples:**

```typescript
// Critical: Stop-loss triggered
await alerts.send({
  level: AlertLevel.CRITICAL,
  title: "Stop Loss Triggered",
  message: "Market: Election2024, Loss: $75, Position closed.",
  metadata: { marketId: "election-2024", pnl: -75 },
});

// Warning: Approaching daily limit
await alerts.send({
  level: AlertLevel.WARNING,
  title: "Daily Loss Limit: 80%",
  message: "Current loss: $160/$200. Consider reducing exposure.",
  metadata: { dailyPnL: -160, limit: -200 },
});

// Info: Daily summary
await alerts.send({
  level: AlertLevel.INFO,
  title: "Daily Trading Summary",
  message: "PnL: +$145 (2.9%), Trades: 8 (6W/2L), Positions: 5",
  metadata: { pnl: 145, trades: 8, winRate: 0.75 },
});
```

---

## 4. Configuration Management

### 4.1 Environment Variables

**Required:**

```bash
# Polymarket API
POLYMARKET_API_KEY=<api_key>
POLYMARKET_PRIVATE_KEY=<wallet_private_key>
POLYMARKET_WALLET_ADDRESS=<wallet_address>

# OpenClaw Integration
OPENCLAW_SESSION_KEY=main  # Where to send alerts
```

**Optional:**

```bash
# Risk Management
POLYMARKET_MAX_POSITION_SIZE=500
POLYMARKET_MAX_PORTFOLIO_VALUE=5000
POLYMARKET_DAILY_LOSS_LIMIT=200
POLYMARKET_STOP_LOSS_PERCENT=15
POLYMARKET_TAKE_PROFIT_PERCENT=25

# Agent Behavior
POLYMARKET_CHECK_INTERVAL=5m
POLYMARKET_STRATEGY=value-betting
POLYMARKET_TEST_MODE=false

# Data Storage
POLYMARKET_DATA_DIR=~/.openclaw/data/polymarket
```

### 4.2 Config File (`~/.openclaw/config/polymarket.json`)

```json
{
  "version": "1.0.0",
  "agent": {
    "enabled": true,
    "strategy": "value-betting",
    "checkInterval": "5m"
  },
  "risk": {
    "maxPositionSize": 500,
    "maxPortfolioValue": 5000,
    "maxCategoryExposure": 2000,
    "stopLossPercent": 15,
    "takeProfitPercent": 25,
    "dailyLossLimit": 200,
    "weeklyLossLimit": 500,
    "maxConsecutiveLosses": 5
  },
  "strategy": {
    "minEdge": 0.03,
    "minVolume": 10000,
    "maxSpread": 0.05,
    "categories": ["politics", "economics", "sports"],
    "maxTimeToResolution": 30
  },
  "alerts": {
    "enabled": true,
    "levels": ["warning", "critical"],
    "sessionKey": "main",
    "dailySummary": true,
    "summaryTime": "08:00"
  },
  "dataRetention": {
    "marketSnapshots": 7,
    "positionHistory": 90,
    "tradeHistory": 365
  }
}
```

---

## 5. CLI Commands

### 5.1 Markets

```bash
# List markets
openclaw polymarket markets [options]
  --category <cat>      Filter by category (politics, economics, etc.)
  --min-volume <num>    Minimum 24h volume
  --min-liquidity <num> Minimum liquidity (0-1)
  --search <query>      Search market questions
  --limit <num>         Number of results (default: 20)

# Get market details
openclaw polymarket market <market-id>
  --json                Output as JSON

# Watch market (live updates)
openclaw polymarket watch <market-id>
```

### 5.2 Positions

```bash
# View positions
openclaw polymarket positions [options]
  --summary             Show summary only
  --json                Output as JSON

# Close position
openclaw polymarket close <market-id> [options]
  --amount <num>        Amount to close (default: all)
  --limit-price <num>   Limit price

# Portfolio summary
openclaw polymarket portfolio
```

### 5.3 Trading

```bash
# Execute trade
openclaw polymarket trade <market-id> [options]
  --side <buy|sell>     Trade side
  --amount <num>        Amount in USD
  --limit-price <num>   Limit price
  --market              Use market order (default: limit)
  --dry-run             Simulate only

# Trade history
openclaw polymarket history [options]
  --start <date>        Start date
  --end <date>          End date
  --limit <num>         Number of results
```

### 5.4 Agent Control

```bash
# Start agent
openclaw polymarket agent start [options]
  --strategy <name>     Strategy to use
  --config <file>       Config file path
  --dry-run             Simulation mode

# Stop agent
openclaw polymarket agent stop

# Pause agent (stop trading, keep monitoring)
openclaw polymarket agent pause

# Resume agent
openclaw polymarket agent resume

# Agent status
openclaw polymarket agent status
```

### 5.5 Configuration

```bash
# Show config
openclaw polymarket config

# Set config value
openclaw polymarket config set <key> <value>
  Example: openclaw polymarket config set risk.maxPositionSize 1000

# Reset to defaults
openclaw polymarket config reset
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Coverage Requirements:**

- API client: >80%
- Strategy logic: >90%
- Risk management: >95%
- Utils/formatting: >70%

**Test Files:**

```
test/
├── api/
│   ├── client.test.ts
│   ├── markets.test.ts
│   └── trading.test.ts
├── strategies/
│   ├── value-betting.test.ts
│   └── risk-manager.test.ts
├── agent/
│   └── trading-agent.test.ts
└── utils/
    └── validation.test.ts
```

**Example Test:**

```typescript
describe("ValueBettingStrategy", () => {
  it("should generate buy signal when price below fair value", () => {
    const strategy = new ValueBettingStrategy(defaultConfig);
    const market = createMockMarket({ currentPrice: 0.4 });

    // Mock fair value calculation
    vi.spyOn(strategy, "calculateFairValue").mockReturnValue(0.52);

    const signal = strategy.evaluate(market, []);

    expect(signal).toBeDefined();
    expect(signal?.side).toBe("buy");
    expect(signal?.limitPrice).toBeCloseTo(0.404, 2); // 1% above current
  });

  it("should skip when edge below threshold", () => {
    const strategy = new ValueBettingStrategy(defaultConfig);
    const market = createMockMarket({ currentPrice: 0.5 });

    vi.spyOn(strategy, "calculateFairValue").mockReturnValue(0.51); // Only 2% edge

    const signal = strategy.evaluate(market, []);

    expect(signal).toBeNull();
  });
});
```

### 6.2 Integration Tests

**Test Scenarios:**

1. End-to-end agent cycle (mock API)
2. Trade execution flow (sandbox environment)
3. Risk management edge cases
4. Alert delivery
5. Config loading and validation

**Example Integration Test:**

```typescript
describe("TradingAgent Integration", () => {
  it("should complete full trading cycle", async () => {
    const agent = new TradingAgent({
      strategy: new ValueBettingStrategy(testConfig),
      apiClient: mockApiClient,
      riskManager: mockRiskManager,
    });

    await agent.runCycle();

    // Verify expected calls
    expect(mockApiClient.markets.list).toHaveBeenCalled();
    expect(mockRiskManager.validateTrade).toHaveBeenCalled();
    expect(mockApiClient.trading.execute).toHaveBeenCalledWith(
      expect.objectContaining({ side: "buy" }),
    );
  });
});
```

### 6.3 Manual Testing Checklist

**Before Production:**

- [ ] Test mode works (no real trades)
- [ ] API authentication succeeds
- [ ] Market data fetches correctly
- [ ] Position tracking accurate
- [ ] Risk checks enforce limits
- [ ] Stop-loss auto-closes positions
- [ ] Circuit breaker halts on anomalies
- [ ] Alerts deliver to correct session
- [ ] CLI commands work as expected
- [ ] Agent starts/stops/pauses correctly
- [ ] Config changes apply on restart
- [ ] Logs are structured and readable

---

## 7. Deployment Guide

### 7.1 Development Setup

```bash
# 1. Navigate to extension
cd extensions/polymarket

# 2. Install dependencies
pnpm install

# 3. Copy environment template
cp .env.example .env

# 4. Edit .env with your credentials
# POLYMARKET_API_KEY=...
# POLYMARKET_PRIVATE_KEY=...

# 5. Test API connection
pnpm openclaw polymarket markets --limit 5

# 6. Start agent in test mode
pnpm openclaw polymarket agent start --dry-run
```

### 7.2 VPS Deployment (AWS Lightsail Example)

**Provision Instance:**

```bash
# Create Lightsail instance
aws lightsail create-instances \
  --instance-names polymarket-bot \
  --availability-zone us-east-1a \
  --blueprint-id ubuntu_22_04 \
  --bundle-id nano_2_0

# Get SSH key
aws lightsail download-default-key-pair \
  --output text \
  --query privateKeyBase64 \
  | base64 --decode > ~/.ssh/lightsail-key.pem
chmod 600 ~/.ssh/lightsail-key.pem
```

**Setup Server:**

```bash
# SSH into instance
ssh -i ~/.ssh/lightsail-key.pem ubuntu@<instance-ip>

# Install Node.js 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Clone repository
git clone https://github.com/tom-willet/openclaw.git
cd openclaw

# Install dependencies
pnpm install

# Create config directory
mkdir -p ~/.openclaw/config
mkdir -p ~/.openclaw/credentials
mkdir -p ~/.openclaw/data/polymarket

# Set environment variables (via systemd or .env)
cat > ~/.openclaw/config/polymarket.json <<EOF
{
  "agent": { "enabled": true, "strategy": "value-betting" },
  "risk": { "maxPositionSize": 500, "dailyLossLimit": 200 }
}
EOF

# Store credentials (encrypted)
echo "<api_key>" > ~/.openclaw/credentials/polymarket
chmod 600 ~/.openclaw/credentials/polymarket
```

**Systemd Service:**

```bash
# Create systemd service
sudo tee /etc/systemd/system/polymarket-agent.service > /dev/null <<EOF
[Unit]
Description=Polymarket Trading Agent
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/openclaw
ExecStart=/usr/bin/pnpm openclaw polymarket agent start
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

Environment="NODE_ENV=production"
Environment="POLYMARKET_API_KEY_FILE=/home/ubuntu/.openclaw/credentials/polymarket"

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable polymarket-agent
sudo systemctl start polymarket-agent

# Check status
sudo systemctl status polymarket-agent

# View logs
sudo journalctl -u polymarket-agent -f
```

### 7.3 Monitoring & Maintenance

**Health Checks:**

```bash
# Agent status
openclaw polymarket agent status

# Recent trades
openclaw polymarket history --limit 10

# Portfolio health
openclaw polymarket portfolio

# Check logs
tail -f ~/.openclaw/agents/polymarket-trader/sessions/latest.jsonl
```

**Alerts Setup:**

- Configure SMS/Email for critical alerts
- Set up monitoring dashboard (Grafana, Datadog, etc.)
- Enable dead-man switch (alert if no heartbeat for 1 hour)

**Backup Strategy:**

```bash
# Daily backup of critical data
rsync -avz ~/.openclaw/data/polymarket/ \
  s3://my-backup-bucket/polymarket/$(date +%Y%m%d)/

# Keep local backups for 30 days
find ~/.openclaw/data/polymarket/archive/ \
  -type f -mtime +30 -delete
```

---

## 8. Security Considerations

### 8.1 Credential Management

**Never commit:**

- API keys
- Private keys
- Wallet addresses
- Production config with real values

**Best practices:**

- Use `.env.example` template (commit)
- Store real credentials in `~/.openclaw/credentials/` (gitignore)
- Encrypt credentials at rest (planned feature)
- Rotate keys regularly
- Use separate keys for dev/prod

### 8.2 Trade Validation

**Pre-execution checks:**

- Verify market exists and is active
- Confirm sufficient balance
- Validate price is within reasonable bounds
- Check for duplicate orders
- Ensure order size within limits

**Post-execution verification:**

- Confirm order accepted by exchange
- Monitor fill status
- Verify position updated correctly
- Alert on unexpected behavior

### 8.3 Error Handling

**Graceful degradation:**

- API errors → log, alert, skip cycle
- Network issues → retry with exponential backoff
- Invalid data → discard, log warning
- Critical errors → halt agent, alert immediately

**Circuit breaker conditions:**

- 3+ consecutive API failures
- Unexpected account balance change (>10%)
- Daily loss limit exceeded
- Position mismatch detected

---

## 9. Performance Requirements

### 9.1 Latency

- Market data fetch: <2s
- Trade execution: <5s
- Position update: <1s
- Agent cycle (full): <30s

### 9.2 Throughput

- Support 100+ markets monitoring
- Handle 50+ trades per day
- Process 1000+ data points per cycle

### 9.3 Resource Limits

- Memory: <512MB typical, <1GB peak
- CPU: <10% idle, <50% during cycle
- Disk: <100MB logs per week
- Network: <10MB/hour data transfer

---

## 10. Future Enhancements

### 10.1 Phase 2 Features

- [ ] Advanced strategies (momentum, arbitrage, etc.)
- [ ] Machine learning price prediction
- [ ] Multi-account portfolio management
- [ ] Social sentiment analysis integration
- [ ] Backtesting framework with historical data
- [ ] Web dashboard for monitoring/control

### 10.2 Phase 3 Features

- [ ] Cross-exchange arbitrage
- [ ] Liquidity provision strategies
- [ ] Cooperative multi-agent strategies
- [ ] Options/derivatives support
- [ ] Advanced risk analytics (VaR, Sharpe, etc.)

---

## 11. Dependencies

### 11.1 Runtime Dependencies

```json
{
  "dependencies": {
    "@polymarket/sdk": "^1.0.0",
    "ethers": "^6.0.0",
    "node-cron": "^3.0.0",
    "zod": "^3.22.0"
  }
}
```

### 11.2 Development Dependencies

```json
{
  "devDependencies": {
    "openclaw": "workspace:*",
    "@types/node": "^22.0.0",
    "vitest": "^2.0.0",
    "typescript": "^5.6.0"
  }
}
```

---

## 12. OpenClaw Integration

### 12.1 Extension Interface

```typescript
// src/index.ts
import type { Extension } from "openclaw/plugin-sdk";

export default {
  name: "@openclaw/polymarket",
  version: "1.0.0",

  async activate(context) {
    // Register CLI commands
    context.commands.register([
      marketsCommand,
      positionsCommand,
      tradeCommand,
      agentCommand,
    ]);

    // Register agent scheduler
    if (config.agent.enabled) {
      await startTradingAgent(context);
    }

    // Register tools (for other agents to use)
    context.tools.register([
      fetchMarketsToolSchema,
      executeTradeToolSchema,
      getPositionsToolSchema,
    ]);
  },

  async deactivate() {
    // Stop agent
    await stopTradingAgent();

    // Cleanup resources
    await apiClient.disconnect();
  },
} satisfies Extension;
```

### 12.2 Tool Registration (for AI Agents)

```typescript
// Other OpenClaw agents can invoke Polymarket tools
const fetchMarketsToolSchema = {
  name: "polymarket_fetch_markets",
  description: "Fetch prediction markets from Polymarket",
  parameters: {
    type: "object",
    properties: {
      category: { type: "string", enum: ["politics", "economics", "sports"] },
      minVolume: { type: "number", default: 10000 },
      limit: { type: "number", default: 20 },
    },
  },
  handler: async (params) => {
    return await polymarket.markets.list(params);
  },
};
```

---

## 13. Migration from Workspace

### 13.1 Files to Move

**From `~/.openclaw/workspace/polymarket/`:**

- ✅ `AGENTS.md` → Include in extension README
- ✅ `TOOLS.md` → Inform API design
- ✅ `SOUL.md` → Inform agent personality
- ✅ `scripts/*.sh` → Migrate to TypeScript in `src/api/`
- ❌ `data/*` → Leave in workspace (runtime data)
- ❌ `logs/*` → Leave in workspace (logs)

### 13.2 Implementation Priorities

**Must Have (MVP):**

1. API client (markets, trading, portfolio)
2. Value betting strategy
3. Risk management (limits, stop-loss)
4. Autonomous agent (basic scheduler)
5. CLI commands (markets, positions, trade)

**Should Have (v1.1):** 6. Advanced risk management (circuit breaker) 7. Alert system (critical events) 8. Daily summary reports 9. Dry-run/test mode 10. Comprehensive logging

**Nice to Have (v1.2+):** 11. Multiple strategies 12. Backtesting framework 13. Web dashboard 14. Advanced analytics

---

## 14. Success Metrics

### 14.1 Technical Metrics

- [ ] API uptime: >99.5%
- [ ] Trade execution success rate: >95%
- [ ] Agent cycle completion rate: >99%
- [ ] Alert delivery success: >99.9%

### 14.2 Performance Metrics

- [ ] Profitable trades: >55%
- [ ] Sharpe ratio: >1.0
- [ ] Max drawdown: <25%
- [ ] Risk-adjusted return: >10% annually

### 14.3 Operational Metrics

- [ ] Zero unauthorized trades
- [ ] Zero balance discrepancies
- [ ] <5 minutes mean time to recovery
- [ ] 100% audit trail coverage

---

## 15. Risk Disclosure

**THIS SOFTWARE IS PROVIDED AS-IS WITHOUT WARRANTY. USE AT YOUR OWN RISK.**

- Trading prediction markets involves financial risk
- Automated trading can result in significant losses
- Past performance does not guarantee future results
- Always test thoroughly before deploying with real funds
- Never trade more than you can afford to lose
- Review and understand all code before execution
- Monitor agent performance regularly
- Set conservative risk limits initially

---

## 16. License & Attribution

**License:** MIT (inherit from OpenClaw)

**Attribution:**

- Built on OpenClaw framework (openclaw.ai)
- Uses Polymarket SDK (polymarket.com)
- Trading strategies are educational examples

---

## 17. Appendix

### 17.1 Glossary

- **Edge**: Difference between fair value and market price (opportunity)
- **Position**: Open trade (bought but not yet sold)
- **PnL**: Profit and Loss (realized or unrealized)
- **Stop-loss**: Automatic exit when position loses X%
- **Take-profit**: Automatic exit when position gains X%
- **Circuit breaker**: Emergency halt on anomalous conditions
- **Fair value**: Estimated true probability of outcome
- **Spread**: Difference between bid and ask price
- **Liquidity**: Ease of entering/exiting positions

### 17.2 References

- Polymarket API Docs: https://docs.polymarket.com
- OpenClaw Plugin SDK: https://docs.openclaw.ai/plugins
- Kelly Criterion: https://en.wikipedia.org/wiki/Kelly_criterion
- Risk Management Best Practices: https://...

### 17.3 Changelog

**2026-02-03:**

- Initial specification created
- Architecture defined
- Feature requirements documented
- Testing strategy outlined
- Deployment guide drafted

---

**END OF SPECIFICATION**
