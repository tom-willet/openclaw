/**
 * Polymarket Extension for OpenClaw
 *
 * Provides integration with Polymarket prediction markets, focusing on
 * 15-minute BTC updown markets with real-time WebSocket data streaming.
 *
 * Features:
 * - Multi-signal trading strategy (time decay, orderbook, momentum, BTC price)
 * - Real-time Binance BTC price feed integration
 * - Kelly criterion position sizing
 * - Paper trading with performance tracking
 * - Dry-run and live trading modes
 */

export { PolymarketAgent } from "./agent.js";
export { BTCUpdownTracker } from "./btc-tracker.js";
export { PolymarketWSClient } from "./websocket.js";
export { BinanceBTCFeed } from "./binance-feed.js";
export { BTCUpdownStrategy } from "./strategy.js";
export { PaperTrader } from "./paper-trader.js";
