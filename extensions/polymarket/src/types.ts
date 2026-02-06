import { z } from "zod";

// WebSocket message types based on Polymarket CLOB API
export const MarketSchema = z.object({
  condition_id: z.string(),
  question: z.string(),
  description: z.string().optional(),
  end_date_iso: z.string(),
  game_start_time: z.string().optional(),
  outcomes: z.array(z.string()),
  tokens: z.array(
    z.object({
      token_id: z.string(),
      outcome: z.string(),
      price: z.string().optional(),
    }),
  ),
  active: z.boolean(),
  closed: z.boolean(),
});

export const PriceSchema = z.object({
  market: z.string(), // token_id
  price: z.string(),
  side: z.enum(["BUY", "SELL"]),
  size: z.string(),
  timestamp: z.number(),
});

export const OrderbookSchema = z.object({
  market: z.string(), // token_id
  asset_id: z.string(),
  bids: z.array(
    z.object({
      price: z.string(),
      size: z.string(),
    }),
  ),
  asks: z.array(
    z.object({
      price: z.string(),
      size: z.string(),
    }),
  ),
  timestamp: z.number(),
});

export const TradeSchema = z.object({
  id: z.string(),
  market: z.string(), // token_id
  asset_id: z.string(),
  side: z.enum(["BUY", "SELL"]),
  price: z.string(),
  size: z.string(),
  timestamp: z.number(),
});

export const WSMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("price"),
    data: PriceSchema,
  }),
  z.object({
    type: z.literal("book"),
    data: OrderbookSchema,
  }),
  z.object({
    type: z.literal("trade"),
    data: TradeSchema,
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);

export type Market = z.infer<typeof MarketSchema>;
export type Price = z.infer<typeof PriceSchema>;
export type Orderbook = z.infer<typeof OrderbookSchema>;
export type Trade = z.infer<typeof TradeSchema>;
export type WSMessage = z.infer<typeof WSMessageSchema>;

// Agent configuration
export interface AgentConfig {
  dryRun: boolean;
  maxPositionSize: number;
  checkInterval: number;
  logLevel: "debug" | "info" | "warn" | "error";
}

// Market tracker state
export interface MarketState {
  conditionId: string;
  question: string;
  endTime: Date;
  yesTokenId: string;
  noTokenId: string;
  currentPrice: {
    yes: number;
    no: number;
  };
  orderbook: {
    yes: Orderbook | null;
    no: Orderbook | null;
  };
  lastUpdate: Date;
}

// Trading signal
export interface TradingSignal {
  market: string;
  tokenId: string;
  side: "BUY" | "SELL";
  outcome: "yes" | "no";
  price: number;
  size: number;
  reason: string;
  confidence: number;
  signals?: SignalBreakdown; // Detailed signal breakdown
}

// Paper trade for dry-run tracking
export interface PaperTrade {
  id: string;
  market: string;
  marketQuestion: string;
  outcome: "yes" | "no";
  entryPrice: number;
  entryTime: Date;
  size: number;
  cost: number; // entryPrice * size
  exitPrice?: number;
  exitTime?: Date;
  pnl?: number;
  status: "open" | "closed" | "expired";
  closeReason?: "expired" | "manual" | "stop-loss";
}

// Performance metrics for paper trading
export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  totalCost: number;
  roi: number; // Return on investment %
  avgWin: number;
  avgLoss: number;
  largestWi: number;
  largestLoss: number;
  sharpeRatio: number;
  profitFactor: number; // Gross profit / gross loss
  startingCapital: number;
  endingCapital: number;
}

// Trade history for momentum analysis
export interface TradeHistory {
  outcome: "yes" | "no";
  side: "BUY" | "SELL";
  price: number;
  size: number;
  timestamp: number;
  volume: number;
}

// Orderbook depth analysis
export interface OrderbookDepth {
  yesBidDepth: number;
  yesAskDepth: number;
  noBidDepth: number;
  noAskDepth: number;
  yesSpread: number;
  noSpread: number;
  imbalance: number; // -1 to 1, positive = bullish
  yesBestBid: number;
  yesBestAsk: number;
  noBestBid: number;
  noBestAsk: number;
}

// Individual signal components
export interface SignalScore {
  score: number; // -1 to 1, positive = bullish (YES), negative = bearish (NO)
  confidence: number; // 0 to 1
  reason: string;
}

// Breakdown of all signals contributing to decision
export interface SignalBreakdown {
  timeDecay: SignalScore;
  orderbookImbalance: SignalScore;
  tradeMomentum: SignalScore;
  btcPriceMovement: SignalScore;
  priceInefficiency: SignalScore;
  feedComparison: SignalScore; // NEW: Binance vs Chainlink comparison
  composite: SignalScore;
}

// Strategy configuration
export interface StrategyConfig {
  // Signal weights (should sum to 1.0)
  weights: {
    timeDecay: number;
    orderbookImbalance: number;
    tradeMomentum: number;
    btcPriceMovement: number;
    priceInefficiency: number;
    feedComparison: number;
  };
  // Thresholds
  minConfidenceToTrade: number; // 0-1, minimum composite confidence
  minScoreToTrade: number; // 0-1, minimum absolute score
  // Time decay settings
  timeDecayActivationMinutes: number; // When to start weighting time decay heavily
  // Position sizing
  kellyFraction: number; // Fraction of Kelly criterion to use (e.g., 0.25 = quarter Kelly)
}

// Default strategy configuration
export const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  weights: {
    timeDecay: 0.35, // Highest weight - most reliable edge
    orderbookImbalance: 0.18,
    tradeMomentum: 0.13,
    btcPriceMovement: 0.18,
    priceInefficiency: 0.08,
    feedComparison: 0.08, // Validation signal - agreement boost / divergence filter
  },
  minConfidenceToTrade: 0.30, // TESTING: Lowered from 0.55 for more action
  minScoreToTrade: 0.15, // TESTING: Lowered from 0.3 for more trades
  timeDecayActivationMinutes: 8, // TESTING: Extended from 3 min to activate earlier
  kellyFraction: 0.25, // Conservative quarter Kelly
};
