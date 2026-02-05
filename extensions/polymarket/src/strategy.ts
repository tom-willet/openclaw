import type {
  MarketState,
  SignalScore,
  SignalBreakdown,
  StrategyConfig,
  TradingSignal,
  OrderbookDepth,
} from "./types.js";
import { DEFAULT_STRATEGY_CONFIG } from "./types.js";
import type { BTCUpdownTracker } from "./btc-tracker.js";
import type { BinanceBTCFeed } from "./binance-feed.js";

/**
 * Multi-signal strategy for 15-minute BTC updown markets.
 * Combines multiple edge sources to generate high-confidence trades.
 */
export class BTCUpdownStrategy {
  private config: StrategyConfig;

  constructor(config: Partial<StrategyConfig> = {}) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
  }

  /**
   * Analyze all signals and generate trading recommendation
   */
  analyze(
    state: MarketState,
    tracker: BTCUpdownTracker,
    btcFeed: BinanceBTCFeed | null,
  ): SignalBreakdown {
    const timeToExpiryMs = tracker.getTimeToExpiry() || 0;
    const orderbookAnalysis = tracker.getOrderbookAnalysis();
    const tradeMomentum = tracker.getTradeMomentum(60000); // Last minute

    // Calculate individual signals
    const timeDecay = this.analyzeTimeDecay(state, timeToExpiryMs, btcFeed);

    const orderbookImbalance = this.analyzeOrderbook(orderbookAnalysis);

    const momentum = this.analyzeTradeMomentum(tradeMomentum);

    const btcMovement = this.analyzeBTCMovement(btcFeed);

    const priceInefficiency = this.analyzePriceInefficiency(state, btcFeed);

    // Calculate composite score
    const composite = this.calculateComposite(
      timeDecay,
      orderbookImbalance,
      momentum,
      btcMovement,
      priceInefficiency,
      timeToExpiryMs,
    );

    return {
      timeDecay,
      orderbookImbalance,
      tradeMomentum: momentum,
      btcPriceMovement: btcMovement,
      priceInefficiency,
      composite,
    };
  }

  /**
   * Generate trading signal from analysis
   */
  generateSignal(
    state: MarketState,
    signals: SignalBreakdown,
  ): TradingSignal | null {
    const { composite } = signals;

    // Check thresholds
    if (composite.confidence < this.config.minConfidenceToTrade) {
      return null;
    }

    if (Math.abs(composite.score) < this.config.minScoreToTrade) {
      return null;
    }

    // Determine direction
    const isBullish = composite.score > 0;
    const outcome: "yes" | "no" = isBullish ? "yes" : "no";
    const price = isBullish ? state.currentPrice.yes : state.currentPrice.no;
    const tokenId = isBullish ? state.yesTokenId : state.noTokenId;

    // Calculate position size using Kelly criterion
    const size = this.calculatePositionSize(composite, price);

    return {
      market: state.conditionId,
      tokenId,
      side: "BUY",
      outcome,
      price,
      size,
      reason: composite.reason,
      confidence: composite.confidence,
      signals,
    };
  }

  /**
   * Signal 1: Time Decay Analysis
   * As expiry approaches, if BTC direction is clear, bet the obvious winner
   */
  private analyzeTimeDecay(
    state: MarketState,
    timeToExpiryMs: number,
    btcFeed: BinanceBTCFeed | null,
  ): SignalScore {
    const minutesToExpiry = timeToExpiryMs / 60000;
    const activationMinutes = this.config.timeDecayActivationMinutes;

    // Not in time decay window yet
    if (minutesToExpiry > activationMinutes) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `${minutesToExpiry.toFixed(1)}m to expiry - time decay not active`,
      };
    }

    // Get BTC direction prediction
    if (!btcFeed) {
      return {
        score: 0,
        confidence: 0.1,
        reason: "No BTC feed available for time decay analysis",
      };
    }

    const prediction = btcFeed.predictOutcome();

    if (prediction.direction === "NEUTRAL") {
      return {
        score: 0,
        confidence: 0.2,
        reason: `BTC change ${prediction.change.toFixed(3)}% - too close to call`,
      };
    }

    // The closer to expiry, the more confident we can be
    const timeMultiplier = Math.min(
      1,
      (activationMinutes - minutesToExpiry) / activationMinutes,
    );
    const score = prediction.direction === "UP" ? 1 : -1;
    const confidence = Math.min(
      0.95,
      prediction.confidence * (0.6 + 0.4 * timeMultiplier),
    );

    // Check if market price reflects reality
    const impliedProb =
      prediction.direction === "UP"
        ? state.currentPrice.yes
        : state.currentPrice.no;
    const edge = confidence - impliedProb;

    if (edge < 0.05) {
      return {
        score: score * 0.3,
        confidence: 0.3,
        reason: `Time decay: BTC ${prediction.direction} but market already priced at ${(impliedProb * 100).toFixed(1)}%`,
      };
    }

    return {
      score: score * Math.min(1, edge * 5),
      confidence,
      reason: `Time decay: BTC ${prediction.direction} ${prediction.change.toFixed(3)}%, ${minutesToExpiry.toFixed(1)}m left, edge ${(edge * 100).toFixed(1)}%`,
    };
  }

  /**
   * Signal 2: Orderbook Imbalance
   * Heavy buying pressure on one side indicates smart money direction
   */
  private analyzeOrderbook(analysis: OrderbookDepth | null): SignalScore {
    if (!analysis) {
      return {
        score: 0,
        confidence: 0.1,
        reason: "No orderbook data available",
      };
    }

    const { imbalance, yesBidDepth, noBidDepth, yesSpread, noSpread } =
      analysis;

    // Imbalance ranges from -1 (bearish) to 1 (bullish)
    const absImbalance = Math.abs(imbalance);

    // Need significant imbalance to signal
    if (absImbalance < 0.1) {
      return {
        score: 0,
        confidence: 0.2,
        reason: `Orderbook balanced (imbalance: ${(imbalance * 100).toFixed(1)}%)`,
      };
    }

    // Calculate confidence based on depth and spread
    const totalDepth = yesBidDepth + noBidDepth;
    const avgSpread = (yesSpread + noSpread) / 2;

    // More depth = more confidence, tighter spread = more confidence
    let confidence = Math.min(0.7, 0.3 + absImbalance * 0.5);
    if (totalDepth > 10000) confidence += 0.1;
    if (avgSpread < 0.02) confidence += 0.1;

    const direction = imbalance > 0 ? "YES" : "NO";

    return {
      score: imbalance,
      confidence: Math.min(0.8, confidence),
      reason: `Orderbook: ${(absImbalance * 100).toFixed(1)}% imbalance toward ${direction}, depth $${totalDepth.toFixed(0)}`,
    };
  }

  /**
   * Signal 3: Trade Momentum
   * Recent trade flow indicates market direction
   */
  private analyzeTradeMomentum(momentum: {
    yesRatio: number;
    totalVolume: number;
    tradeCount: number;
  }): SignalScore {
    const { yesRatio, totalVolume, tradeCount } = momentum;

    // Need enough trades to analyze
    if (tradeCount < 5) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Only ${tradeCount} recent trades - insufficient data`,
      };
    }

    // Convert ratio to score (-1 to 1)
    const score = (yesRatio - 0.5) * 2;
    const absScore = Math.abs(score);

    // Need significant imbalance
    if (absScore < 0.2) {
      return {
        score: 0,
        confidence: 0.2,
        reason: `Trade flow balanced: ${(yesRatio * 100).toFixed(1)}% YES`,
      };
    }

    // Confidence based on volume and trade count
    let confidence = 0.3 + absScore * 0.3;
    if (totalVolume > 1000) confidence += 0.1;
    if (tradeCount > 20) confidence += 0.1;

    const direction = yesRatio > 0.5 ? "YES" : "NO";

    return {
      score,
      confidence: Math.min(0.7, confidence),
      reason: `Trade momentum: ${(yesRatio * 100).toFixed(1)}% toward ${direction}, ${tradeCount} trades, $${totalVolume.toFixed(0)} volume`,
    };
  }

  /**
   * Signal 4: BTC Price Movement
   * Direct correlation with BTC price action
   */
  private analyzeBTCMovement(btcFeed: BinanceBTCFeed | null): SignalScore {
    if (!btcFeed || !btcFeed.isConnected()) {
      return {
        score: 0,
        confidence: 0.1,
        reason: "No BTC feed available",
      };
    }

    const change = btcFeed.getWindowChange();
    if (!change) {
      return {
        score: 0,
        confidence: 0.1,
        reason: "No BTC window data",
      };
    }

    const { percent } = change;
    const absChange = Math.abs(percent);

    // Very small changes are noise
    if (absChange < 0.01) {
      return {
        score: 0,
        confidence: 0.2,
        reason: `BTC change ${percent.toFixed(4)}% - noise range`,
      };
    }

    // Convert to score, cap at ±1
    const score = Math.max(-1, Math.min(1, percent * 50)); // 2% move = full score

    // Confidence based on magnitude and momentum
    const momentum = btcFeed.getRecentMomentum();
    let confidence = Math.min(0.8, 0.3 + absChange * 20);

    // If momentum aligns with direction, boost confidence
    if ((percent > 0 && momentum > 0) || (percent < 0 && momentum < 0)) {
      confidence = Math.min(0.9, confidence + 0.1);
    }

    const direction = percent > 0 ? "UP" : "DOWN";

    return {
      score,
      confidence,
      reason: `BTC ${direction} ${percent.toFixed(4)}%, momentum ${momentum.toFixed(4)}%`,
    };
  }

  /**
   * Signal 5: Price Inefficiency
   * Compare market price to fair value based on BTC movement
   */
  private analyzePriceInefficiency(
    state: MarketState,
    btcFeed: BinanceBTCFeed | null,
  ): SignalScore {
    if (!btcFeed || !btcFeed.isConnected()) {
      return {
        score: 0,
        confidence: 0.1,
        reason: "No BTC feed for inefficiency analysis",
      };
    }

    const change = btcFeed.getWindowChange();
    if (!change) {
      return {
        score: 0,
        confidence: 0.1,
        reason: "No window data for inefficiency analysis",
      };
    }

    // Estimate fair probability based on BTC change
    // If BTC is up significantly, YES should be priced higher
    const absChange = Math.abs(change.percent);
    let fairYesProb: number;

    if (absChange < 0.01) {
      fairYesProb = 0.5; // Too close to call
    } else if (change.percent > 0) {
      // BTC up - YES more likely
      fairYesProb = Math.min(0.95, 0.5 + absChange * 10);
    } else {
      // BTC down - NO more likely
      fairYesProb = Math.max(0.05, 0.5 - absChange * 10);
    }

    // Calculate mispricing
    const marketYesProb = state.currentPrice.yes;
    const mispricing = fairYesProb - marketYesProb;

    // Need significant mispricing for edge
    if (Math.abs(mispricing) < 0.05) {
      return {
        score: 0,
        confidence: 0.2,
        reason: `Market fairly priced (YES: ${(marketYesProb * 100).toFixed(1)}% vs fair ${(fairYesProb * 100).toFixed(1)}%)`,
      };
    }

    // Score based on mispricing direction and magnitude
    const score = Math.max(-1, Math.min(1, mispricing * 5));
    const confidence = Math.min(0.7, 0.3 + Math.abs(mispricing) * 2);

    const direction = mispricing > 0 ? "underpriced" : "overpriced";

    return {
      score,
      confidence,
      reason: `YES ${direction} by ${(mispricing * 100).toFixed(1)}% (market ${(marketYesProb * 100).toFixed(1)}% vs fair ${(fairYesProb * 100).toFixed(1)}%)`,
    };
  }

  /**
   * Calculate composite score from all signals
   */
  private calculateComposite(
    timeDecay: SignalScore,
    orderbook: SignalScore,
    momentum: SignalScore,
    btcMovement: SignalScore,
    priceIneff: SignalScore,
    timeToExpiryMs: number,
  ): SignalScore {
    const { weights } = this.config;
    const minutesToExpiry = timeToExpiryMs / 60000;

    // Dynamic weight adjustment based on time to expiry
    // Increase time decay weight as we approach expiry
    let adjustedWeights = { ...weights };
    if (minutesToExpiry < this.config.timeDecayActivationMinutes) {
      const timeBoost =
        (this.config.timeDecayActivationMinutes - minutesToExpiry) /
        this.config.timeDecayActivationMinutes;
      adjustedWeights.timeDecay += timeBoost * 0.2;

      // Reduce other weights proportionally
      const reduction = (timeBoost * 0.2) / 4;
      adjustedWeights.orderbookImbalance -= reduction;
      adjustedWeights.tradeMomentum -= reduction;
      adjustedWeights.btcPriceMovement -= reduction;
      adjustedWeights.priceInefficiency -= reduction;
    }

    // Calculate weighted score
    const weightedScore =
      timeDecay.score * adjustedWeights.timeDecay +
      orderbook.score * adjustedWeights.orderbookImbalance +
      momentum.score * adjustedWeights.tradeMomentum +
      btcMovement.score * adjustedWeights.btcPriceMovement +
      priceIneff.score * adjustedWeights.priceInefficiency;

    // Calculate weighted confidence
    const weightedConfidence =
      timeDecay.confidence * adjustedWeights.timeDecay +
      orderbook.confidence * adjustedWeights.orderbookImbalance +
      momentum.confidence * adjustedWeights.tradeMomentum +
      btcMovement.confidence * adjustedWeights.btcPriceMovement +
      priceIneff.confidence * adjustedWeights.priceInefficiency;

    // Boost confidence if signals agree
    const scores = [
      timeDecay.score,
      orderbook.score,
      momentum.score,
      btcMovement.score,
      priceIneff.score,
    ];
    const positiveCount = scores.filter((s) => s > 0.1).length;
    const negativeCount = scores.filter((s) => s < -0.1).length;
    const agreement = Math.max(positiveCount, negativeCount) / scores.length;

    const adjustedConfidence = Math.min(
      0.95,
      weightedConfidence * (0.8 + 0.4 * agreement),
    );

    // Build reason summary
    const direction = weightedScore > 0 ? "YES" : "NO";
    const signalSummary = [
      timeDecay.score !== 0
        ? `TD:${(timeDecay.score * 100).toFixed(0)}%`
        : null,
      orderbook.score !== 0
        ? `OB:${(orderbook.score * 100).toFixed(0)}%`
        : null,
      momentum.score !== 0 ? `TM:${(momentum.score * 100).toFixed(0)}%` : null,
      btcMovement.score !== 0
        ? `BTC:${(btcMovement.score * 100).toFixed(0)}%`
        : null,
      priceIneff.score !== 0
        ? `PI:${(priceIneff.score * 100).toFixed(0)}%`
        : null,
    ]
      .filter(Boolean)
      .join(", ");

    return {
      score: weightedScore,
      confidence: adjustedConfidence,
      reason: `Composite: ${direction} (${(Math.abs(weightedScore) * 100).toFixed(1)}%) - ${signalSummary}`,
    };
  }

  /**
   * Calculate position size using Kelly criterion
   */
  private calculatePositionSize(signal: SignalScore, price: number): number {
    // Kelly optimal fraction = (p * b - q) / b
    // where p = probability of winning, b = odds, q = 1 - p
    const p = signal.confidence;
    const q = 1 - p;
    const b = (1 - price) / price; // Implied odds

    const kellyFraction = (p * b - q) / b;

    // Apply fractional Kelly for safety
    const adjustedKelly = Math.max(
      0,
      kellyFraction * this.config.kellyFraction,
    );

    // Cap at reasonable size
    const maxSize = 100; // Max $100 per trade
    const size = Math.min(maxSize, adjustedKelly * maxSize);

    return Math.round(size * 100) / 100; // Round to cents
  }

  /**
   * Get strategy configuration
   */
  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  /**
   * Update strategy configuration
   */
  updateConfig(updates: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}
