import { EventEmitter } from "events";
import {
  createClient,
  decodeReport,
  type DataStreamsClient,
  type DecodedV3Report,
} from "@chainlink/data-streams-sdk";

interface BTCTicker {
  price: number;
  timestamp: number;
  change24h: number;
}

/**
 * Real-time BTC price feed from Chainlink Data Streams.
 * This is the OFFICIAL price source used by Polymarket for settlement.
 * Using this eliminates basis risk between our predictions and actual outcomes.
 */
export class ChainlinkBTCFeed extends EventEmitter {
  private pollInterval: NodeJS.Timeout | null = null;
  private pollFrequency = 15000; // Poll every 15 seconds (Chainlink updates ~15-30s)
  private client: DataStreamsClient | null = null;

  // Price tracking
  private currentPrice: number = 0;
  private priceHistory: Array<{ price: number; timestamp: number }> = [];
  private maxHistoryLength = 100;

  // Window tracking for 15-min markets
  private windowStartPrice: number | null = null;
  private windowStartTime: number | null = null;

  // Last update tracking
  private lastUpdateTime: number = 0;
  private updateFrequency: number = 0; // Measured update frequency in ms

  // BTC/USD feed ID from Chainlink Data Streams (testnet)
  private readonly feedId =
    "0x00037da06d56d083fe599397a4769a042d63aa73dc4ef57d85840e9eeb0cbec2";

  constructor() {
    super();
  }

  /**
   * Connect to Chainlink Data Streams (polling mode)
   */
  async connect(): Promise<void> {
    console.log("[Chainlink] Connecting to Data Streams...");

    // Initialize Chainlink client - REQUIRES credentials
    const apiKey = process.env.CHAINLINK_API_KEY;
    const userSecret = process.env.CHAINLINK_API_SECRET;

    if (!apiKey || !userSecret) {
      console.warn(
        "[Chainlink] No credentials found. Skipping Chainlink feed (Binance will be used instead).",
      );
      console.warn(
        "[Chainlink] To use official Polymarket settlement source, sign up at https://data.chain.link",
      );
      throw new Error("Chainlink credentials not configured");
    }

    console.log("[Chainlink] Initializing authenticated client...");

    // Use testnet by default (can configure for mainnet via env vars)
    const endpoint =
      process.env.CHAINLINK_REST_ENDPOINT ||
      "https://api.testnet-dataengine.chain.link";
    const wsEndpoint =
      process.env.CHAINLINK_WS_ENDPOINT ||
      "wss://ws.testnet-dataengine.chain.link";

    this.client = createClient({
      apiKey,
      userSecret,
      endpoint,
      wsEndpoint,
    });

    try {
      // Initial fetch to verify connection
      await this.fetchPrice();

      // Start polling
      this.pollInterval = setInterval(() => {
        this.fetchPrice().catch((err) => {
          console.error("[Chainlink] Poll error:", err.message);
          this.emit("error", err);
        });
      }, this.pollFrequency);

      this.emit("connected");
      console.log("[Chainlink] Connected to Data Streams (polling every 15s)");
    } catch (err: any) {
      console.error("[Chainlink] Connection failed:", err.message);
      throw err;
    }
  }

  /**
   * Fetch latest price from Chainlink Data Streams
   */
  private async fetchPrice(): Promise<void> {
    if (!this.client) {
      throw new Error("Chainlink client not initialized");
    }

    try {
      // Get latest report for BTC/USD
      const report = await this.client.getLatestReport(this.feedId);

      // Decode the report to get the price (BTC/USD is V3 - crypto streams)
      const decoded = decodeReport(
        report.fullReport,
        this.feedId,
      ) as DecodedV3Report;

      // Extract price - Chainlink returns price as bigint with 18 decimals
      const price = Number(decoded.price) / 1e18;
      const timestamp = report.observationsTimestamp * 1000; // Convert to ms

      this.processPrice(price, timestamp);
    } catch (err: any) {
      console.warn(
        "[Chainlink] Fetch failed, will retry:",
        err?.message || err,
      );
      // Don't throw - let retry mechanism handle it
    }
  }

  /**
   * Process price data from Chainlink
   */
  private processPrice(price: number, timestamp: number): void {
    // Calculate update frequency
    if (this.lastUpdateTime > 0) {
      this.updateFrequency = timestamp - this.lastUpdateTime;
    }
    this.lastUpdateTime = timestamp;

    // Only update if price actually changed
    if (price === this.currentPrice) {
      return;
    }

    this.currentPrice = price;

    // Add to history
    this.priceHistory.push({ price, timestamp });
    if (this.priceHistory.length > this.maxHistoryLength) {
      this.priceHistory.shift();
    }

    // Calculate 24h change (approximate)
    const oldPrice =
      this.priceHistory.length > 20
        ? this.priceHistory[0].price
        : this.currentPrice;
    const change24h = ((price - oldPrice) / oldPrice) * 100;

    // Emit price update
    const ticker: BTCTicker = {
      price,
      timestamp,
      change24h,
    };

    this.emit("price", ticker);
  }

  /**
   * Start a new 15-minute window for tracking
   */
  startWindow(): void {
    this.windowStartPrice = this.currentPrice;
    this.windowStartTime = Date.now();
    console.log(
      `[Chainlink] Started window at $${this.windowStartPrice?.toFixed(2)}`,
    );
  }

  /**
   * Get the price change since window start
   */
  getWindowChange(): { absolute: number; percent: number } | null {
    if (!this.windowStartPrice || !this.currentPrice) return null;

    const absolute = this.currentPrice - this.windowStartPrice;
    const percent = (absolute / this.windowStartPrice) * 100;

    return { absolute, percent };
  }

  /**
   * Predict if BTC will be UP or DOWN at window end
   */
  predictOutcome(): {
    direction: "UP" | "DOWN" | "NEUTRAL";
    confidence: number;
    change: number;
  } {
    const change = this.getWindowChange();
    if (!change) {
      return { direction: "NEUTRAL", confidence: 0, change: 0 };
    }

    const absChange = Math.abs(change.percent);

    // Chainlink is the source of truth - very high confidence when clear direction
    if (absChange < 0.005) {
      // Less than 0.005% - too close to call
      return { direction: "NEUTRAL", confidence: 0.1, change: change.percent };
    }

    const direction = change.percent > 0 ? "UP" : "DOWN";

    // Chainlink confidence is very high - it's what settlement uses
    let confidence = Math.min(absChange * 50, 0.98); // Cap at 98%

    return { direction, confidence, change: change.percent };
  }

  /**
   * Get current BTC price
   */
  getCurrentPrice(): number {
    return this.currentPrice;
  }

  /**
   * Get window start price
   */
  getWindowStartPrice(): number | null {
    return this.windowStartPrice;
  }

  /**
   * Get recent momentum (percent change over last 30 seconds)
   */
  getRecentMomentum(): number {
    const now = Date.now();
    const cutoff = now - 30000; // Last 30 seconds

    const recentPrices = this.priceHistory.filter((p) => p.timestamp > cutoff);
    if (recentPrices.length < 2) return 0;

    const first = recentPrices[0].price;
    const last = recentPrices[recentPrices.length - 1].price;

    return ((last - first) / first) * 100;
  }

  /**
   * Get measured update frequency
   */
  getUpdateFrequency(): number {
    return this.updateFrequency;
  }

  /**
   * Get time since last update
   */
  getTimeSinceLastUpdate(): number {
    if (this.lastUpdateTime === 0) return 0;
    return Date.now() - this.lastUpdateTime;
  }

  /**
   * Check if connected and receiving updates
   */
  isConnected(): boolean {
    // Consider connected if we have a price and last update was recent
    return this.currentPrice > 0 && this.getTimeSinceLastUpdate() < 60000;
  }

  /**
   * Disconnect from Chainlink
   */
  disconnect(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.client = null;
    this.priceHistory = [];
    console.log("[Chainlink] Disconnected");
  }
}
