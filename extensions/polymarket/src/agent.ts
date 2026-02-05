import { PolymarketWSClient } from "./websocket.js";
import { BTCUpdownTracker } from "./btc-tracker.js";
import { BinanceBTCFeed } from "./binance-feed.js";
import { BTCUpdownStrategy } from "./strategy.js";
import { PaperTrader } from "./paper-trader.js";
import type {
  AgentConfig,
  MarketState,
  TradingSignal,
  SignalBreakdown,
} from "./types.js";

interface AgentStats {
  startTime: Date;
  cyclesCompleted: number;
  signalsGenerated: number;
  tradesExecuted: number;
  lastUpdate: Date | null;
  marketChanges: number;
  errors: number;
  marketsCompleted: number;
}

/**
 * Multi-signal trading agent for 15-minute BTC updown markets.
 * Combines time decay, orderbook analysis, trade momentum, and BTC price
 * to find profitable edges in prediction markets.
 */
export class PolymarketAgent {
  private config: AgentConfig;
  private wsClient: PolymarketWSClient;
  private btcTracker: BTCUpdownTracker;
  private btcFeed: BinanceBTCFeed;
  private strategy: BTCUpdownStrategy;
  private paperTrader: PaperTrader;
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private stats: AgentStats;
  private currentMarketEndTime: Date | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.wsClient = new PolymarketWSClient();
    this.btcTracker = new BTCUpdownTracker();
    this.btcFeed = new BinanceBTCFeed();
    this.strategy = new BTCUpdownStrategy();
    this.paperTrader = new PaperTrader(this.config.maxPositionSize);
    this.stats = {
      startTime: new Date(),
      cyclesCompleted: 0,
      signalsGenerated: 0,
      tradesExecuted: 0,
      lastUpdate: null,
      marketChanges: 0,
      errors: 0,
      marketsCompleted: 0,
    };
  }

  /**
   * Start the agent
   */
  async start(): Promise<void> {
    if (this.running) {
      console.warn("[Agent] Already running");
      return;
    }

    console.log("[Agent] Starting Polymarket BTC 15m agent (DRY RUN MODE)");
    console.log("[Agent] Config:", this.config);
    console.log("[Agent] Strategy weights:", this.strategy.getConfig().weights);

    this.running = true;
    this.stats.startTime = new Date();

    // Connect to Binance BTC feed first
    console.log("[Agent] Connecting to Binance BTC feed...");
    try {
      await this.btcFeed.connect();
      this.setupBinanceHandlers();
    } catch (err) {
      console.warn(
        "[Agent] Binance feed connection failed, continuing without BTC data",
      );
    }

    // Connect Polymarket WebSocket
    await this.wsClient.connect();

    // Setup WebSocket event handlers
    this.setupWebSocketHandlers();

    // Detect and track current market
    await this.refreshMarket();

    // Start periodic checks
    this.startPeriodicChecks();

    console.log("[Agent] Agent started successfully");
  }

  /**
   * Setup Binance feed handlers
   */
  private setupBinanceHandlers(): void {
    this.btcFeed.on("price", (ticker) => {
      if (this.config.logLevel === "debug") {
        console.log(
          `[BTC] $${ticker.price.toFixed(2)} (${ticker.change24h > 0 ? "+" : ""}${ticker.change24h.toFixed(2)}%)`,
        );
      }
    });

    this.btcFeed.on("error", (error) => {
      console.error("[Binance] Error:", error.message);
    });

    this.btcFeed.on("disconnected", () => {
      console.warn("[Agent] Binance feed disconnected");
    });
  }

  /**
   * Stop the agent
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log("[Agent] Stopping agent...");
    this.running = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.wsClient.disconnect();
    this.btcFeed.disconnect();
    this.btcTracker.reset();

    console.log("[Agent] Agent stopped");
    this.printStats();
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupWebSocketHandlers(): void {
    this.wsClient.on("connected", () => {
      console.log("[Agent] WebSocket connected");
      const tokenIds = this.btcTracker.getTokenIds();
      if (tokenIds.length > 0) {
        this.wsClient.subscribe(tokenIds);
      }
    });

    this.wsClient.on("disconnected", () => {
      console.log("[Agent] WebSocket disconnected");
    });

    this.wsClient.on("error", (error) => {
      console.error("[Agent] WebSocket error:", error.message);
      this.stats.errors++;
    });

    this.wsClient.on("price", (price) => {
      this.btcTracker.updatePrice(price);
      this.stats.lastUpdate = new Date();
    });

    this.wsClient.on("orderbook", (orderbook) => {
      this.btcTracker.updateOrderbook(orderbook);
      this.stats.lastUpdate = new Date();

      // Log price updates when orderbook changes
      if (this.config.logLevel === "debug") {
        const state = this.btcTracker.getState();
        if (state) {
          console.log(
            `[Price Update] YES: ${(state.currentPrice.yes * 100).toFixed(2)}% | NO: ${(state.currentPrice.no * 100).toFixed(2)}%`,
          );
        }
      }
    });

    this.wsClient.on("trade", (trade) => {
      this.btcTracker.handleTrade(trade);
    });

    // Listen to market state updates
    this.btcTracker.onUpdate((state) => {
      this.onMarketUpdate(state);
    });
  }

  /**
   * Refresh market (detect new 15m market when needed)
   */
  private async refreshMarket(): Promise<void> {
    // Settle previous market if exists
    if (this.currentMarketEndTime) {
      await this.settleMarket();
    }

    console.log("[Agent] Detecting current BTC 15m market...");

    const market = await this.btcTracker.detectCurrentMarket();

    if (!market) {
      console.warn("[Agent] No active market found");
      return;
    }

    this.stats.marketChanges++;

    // Store market end time
    const state = this.btcTracker.getState();
    if (state) {
      this.currentMarketEndTime = state.endTime;
      const timeToExpiry = state.endTime.getTime() - Date.now();
      console.log(
        `[Agent] Market expires in ${(timeToExpiry / 60000).toFixed(1)} minutes`,
      );
    }

    // Start new BTC price window for this market
    if (this.btcFeed.isConnected()) {
      this.btcFeed.startWindow();
      console.log(
        `[Agent] Started BTC window at $${this.btcFeed.getCurrentPrice().toFixed(2)}`,
      );
    }

    // Clear trade history for new market
    this.btcTracker.clearTradeHistory();

    // Subscribe to new market tokens
    const tokenIds = this.btcTracker.getTokenIds();
    if (this.wsClient.isConnected() && tokenIds.length > 0) {
      this.wsClient.subscribe(tokenIds);
    }
  }

  /**
   * Settle market at expiry and close all positions
   */
  private async settleMarket(): Promise<void> {
    const state = this.btcTracker.getState();
    if (!state) return;

    const openTrades = this.paperTrader.getOpenTrades();
    if (openTrades.length === 0) {
      console.log("\n[Agent] Market expired - no open positions");
      this.stats.marketsCompleted++;
      return;
    }

    console.log("\n" + "=".repeat(60));
    console.log("MARKET SETTLEMENT");
    console.log("=".repeat(60));
    console.log(`Market: ${state.question}`);
    console.log(`Expiry: ${state.endTime.toISOString()}`);

    // Determine final outcome based on BTC price movement
    let finalOutcome: "yes" | "no" = "no";

    if (this.btcFeed.isConnected()) {
      const change = this.btcFeed.getWindowChange();
      if (change) {
        finalOutcome = change.percent > 0 ? "yes" : "no";
        console.log(
          `BTC Change: ${change.percent > 0 ? "+" : ""}${change.percent.toFixed(4)}%`,
        );
        console.log(
          `Final Outcome: ${finalOutcome.toUpperCase()} (BTC ${change.percent > 0 ? "UP" : "DOWN"})`,
        );
      }
    } else {
      // Fallback: use market prices
      const yesPrice = state.currentPrice.yes;
      const noPrice = state.currentPrice.no;
      finalOutcome = yesPrice > noPrice ? "yes" : "no";
      console.log(
        `Market Prices: YES ${(yesPrice * 100).toFixed(1)}%, NO ${(noPrice * 100).toFixed(1)}%`,
      );
      console.log(
        `Final Outcome: ${finalOutcome.toUpperCase()} (based on market pricing)`,
      );
    }

    // Close all positions
    this.paperTrader.closeAllTrades(finalOutcome);

    // Print performance report
    this.paperTrader.printReport();

    this.stats.marketsCompleted++;

    // Reset paper trader for next market
    this.paperTrader.reset(this.config.maxPositionSize);

    console.log("=".repeat(60) + "\n");
  }

  /**
   * Start periodic checks (market expiry, signals)
   */
  private startPeriodicChecks(): void {
    this.checkInterval = setInterval(async () => {
      await this.runCycle();
    }, this.config.checkInterval * 1000);

    // Run first cycle immediately
    this.runCycle();
  }

  /**
   * Run a single agent cycle
   */
  private async runCycle(): Promise<void> {
    if (!this.running) return;

    try {
      this.stats.cyclesCompleted++;

      // Check if market expired
      if (this.btcTracker.isMarketExpired()) {
        console.log("[Agent] Market expired, refreshing...");
        await this.refreshMarket();
        return;
      }

      // Refresh orderbooks from API every cycle
      await this.btcTracker.refreshOrderbooks();

      // Evaluate current market state
      const state = this.btcTracker.getState();
      if (!state) {
        console.warn("[Agent] No market state available");
        return;
      }

      // Run multi-signal analysis
      const signals = this.strategy.analyze(
        state,
        this.btcTracker,
        this.btcFeed.isConnected() ? this.btcFeed : null,
      );

      // Log analysis if in debug mode
      if (this.config.logLevel === "debug") {
        this.logSignalAnalysis(state, signals);
      }

      // Generate trading signal
      const signal = this.strategy.generateSignal(state, signals);

      if (signal) {
        this.stats.signalsGenerated++;
        this.logSignal(signal);

        // Execute paper trade
        const trade = this.paperTrader.executeTrade(signal, state.question);
        if (trade) {
          this.stats.tradesExecuted++;
        }
      }
    } catch (err) {
      console.error("[Agent] Cycle error:", err);
      this.stats.errors++;
    }
  }

  /**
   * Log signal analysis breakdown
   */
  private logSignalAnalysis(
    state: MarketState,
    signals: SignalBreakdown,
  ): void {
    const timeToExpiry = this.btcTracker.getTimeToExpiry();
    const minutesToExpiry = timeToExpiry
      ? (timeToExpiry / 60000).toFixed(1)
      : "?";

    console.log("\n--- Signal Analysis ---");
    console.log(`Market: ${state.question}`);
    console.log(`Time to expiry: ${minutesToExpiry}m`);
    console.log(
      `YES: ${(state.currentPrice.yes * 100).toFixed(1)}% | NO: ${(state.currentPrice.no * 100).toFixed(1)}%`,
    );

    if (this.btcFeed.isConnected()) {
      const change = this.btcFeed.getWindowChange();
      if (change) {
        console.log(
          `BTC: $${this.btcFeed.getCurrentPrice().toFixed(2)} (${change.percent > 0 ? "+" : ""}${change.percent.toFixed(4)}%)`,
        );
      }
    }

    console.log("\nSignals:");
    console.log(
      `  Time Decay: ${(signals.timeDecay.score * 100).toFixed(1)}% (${(signals.timeDecay.confidence * 100).toFixed(0)}% conf)`,
    );
    console.log(
      `  Orderbook:  ${(signals.orderbookImbalance.score * 100).toFixed(1)}% (${(signals.orderbookImbalance.confidence * 100).toFixed(0)}% conf)`,
    );
    console.log(
      `  Momentum:   ${(signals.tradeMomentum.score * 100).toFixed(1)}% (${(signals.tradeMomentum.confidence * 100).toFixed(0)}% conf)`,
    );
    console.log(
      `  BTC Move:   ${(signals.btcPriceMovement.score * 100).toFixed(1)}% (${(signals.btcPriceMovement.confidence * 100).toFixed(0)}% conf)`,
    );
    console.log(
      `  Price Inef: ${(signals.priceInefficiency.score * 100).toFixed(1)}% (${(signals.priceInefficiency.confidence * 100).toFixed(0)}% conf)`,
    );
    console.log(
      `  COMPOSITE:  ${(signals.composite.score * 100).toFixed(1)}% (${(signals.composite.confidence * 100).toFixed(0)}% conf)`,
    );
    console.log("---\n");
  }

  /**
   * Handle market state updates from WebSocket
   */
  private onMarketUpdate(state: MarketState): void {
    if (this.config.logLevel === "debug") {
      this.logMarketState(state);
    }
  }

  /**
   * Log trading signal
   */
  private logSignal(signal: TradingSignal): void {
    console.log("\n" + "=".repeat(60));
    console.log(this.config.dryRun ? "[DRY RUN SIGNAL]" : "[LIVE SIGNAL]");
    console.log("=".repeat(60));
    console.log("Outcome:", signal.outcome.toUpperCase());
    console.log("Side:", signal.side);
    console.log("Price:", (signal.price * 100).toFixed(2) + "%");
    console.log("Size:", "$" + signal.size.toFixed(2));
    console.log("Confidence:", (signal.confidence * 100).toFixed(1) + "%");
    console.log("Reason:", signal.reason);

    if (signal.signals) {
      console.log("\nSignal Breakdown:");
      console.log("  Time Decay:", signal.signals.timeDecay.reason);
      console.log("  Orderbook:", signal.signals.orderbookImbalance.reason);
      console.log("  Momentum:", signal.signals.tradeMomentum.reason);
      console.log("  BTC Move:", signal.signals.btcPriceMovement.reason);
      console.log("  Price Inef:", signal.signals.priceInefficiency.reason);
    }
    console.log("=".repeat(60) + "\n");
  }

  /**
   * Log current market state (debug mode)
   */
  private logMarketState(state: MarketState): void {
    const timeToExpiry = this.btcTracker.getTimeToExpiry();
    const spread = this.btcTracker.getSpread();

    console.log("\n[Market Update]");
    console.log("Question:", state.question);
    console.log("YES:", (state.currentPrice.yes * 100).toFixed(2) + "%");
    console.log("NO:", (state.currentPrice.no * 100).toFixed(2) + "%");
    if (spread) console.log("Spread:", (spread * 100).toFixed(3) + "%");
    if (timeToExpiry) {
      const minutes = Math.floor(timeToExpiry / 60000);
      console.log("Time to expiry:", minutes + "m");
    }
    console.log("Last update:", state.lastUpdate.toISOString());
  }

  /**
   * Print agent statistics
   */
  printStats(): void {
    const runtime = Date.now() - this.stats.startTime.getTime();
    const runtimeMinutes = Math.floor(runtime / 60000);

    console.log("\n" + "=".repeat(60));
    console.log("AGENT STATISTICS");
    console.log("=".repeat(60));
    console.log("Runtime:", runtimeMinutes + " minutes");
    console.log("Markets completed:", this.stats.marketsCompleted);
    console.log("Cycles completed:", this.stats.cyclesCompleted);
    console.log("Signals generated:", this.stats.signalsGenerated);
    console.log("Trades executed:", this.stats.tradesExecuted);
    console.log("Market changes:", this.stats.marketChanges);
    console.log("Errors:", this.stats.errors);
    if (this.btcFeed.isConnected()) {
      console.log(
        "BTC Price:",
        "$" + this.btcFeed.getCurrentPrice().toFixed(2),
      );
    }
    if (this.stats.lastUpdate) {
      console.log("Last update:", this.stats.lastUpdate.toISOString());
    }
    console.log("=".repeat(60) + "\n");

    // Print final paper trading report if any trades were made
    const trades = this.paperTrader.getTrades();
    if (trades.length > 0) {
      console.log("\n");
      this.paperTrader.printReport();
    }
  }

  /**
   * Get current statistics
   */
  getStats(): AgentStats {
    return { ...this.stats };
  }

  /**
   * Check if agent is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
