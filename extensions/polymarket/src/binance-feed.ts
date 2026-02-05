import WebSocket from "ws";
import { EventEmitter } from "events";

interface BTCTicker {
  price: number;
  timestamp: number;
  change24h: number;
  volume24h: number;
}

interface MiniTicker {
  e: string; // Event type
  E: number; // Event time
  s: string; // Symbol
  c: string; // Close price
  o: string; // Open price
  h: string; // High price
  l: string; // Low price
  v: string; // Total traded base asset volume
  q: string; // Total traded quote asset volume
}

/**
 * Real-time BTC price feed from Binance WebSocket.
 * Used to compare live BTC price against Polymarket predictions.
 */
export class BinanceBTCFeed extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl = "wss://stream.binance.com:9443/ws/btcusdt@miniTicker";
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;

  // Price tracking
  private currentPrice: number = 0;
  private priceHistory: Array<{ price: number; timestamp: number }> = [];
  private maxHistoryLength = 1000; // Keep last 1000 ticks (~15 min at 1/sec)

  // Window tracking for 15-min markets
  private windowStartPrice: number | null = null;
  private windowStartTime: number | null = null;

  constructor() {
    super();
  }

  /**
   * Connect to Binance WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on("open", () => {
          console.log("[Binance] Connected to BTC/USDT feed");
          this.reconnectAttempts = 0;
          this.startPing();
          this.emit("connected");
          resolve();
        });

        this.ws.on("message", (data: Buffer) => {
          try {
            const ticker: MiniTicker = JSON.parse(data.toString());
            this.handleTicker(ticker);
          } catch (err) {
            console.error("[Binance] Failed to parse message:", err);
          }
        });

        this.ws.on("error", (error) => {
          console.error("[Binance] WebSocket error:", error.message);
          this.emit("error", error);
        });

        this.ws.on("close", () => {
          console.log("[Binance] Connection closed");
          this.stopPing();
          this.emit("disconnected");
          this.attemptReconnect();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Handle ticker updates from Binance
   */
  private handleTicker(ticker: MiniTicker): void {
    const price = parseFloat(ticker.c);
    const timestamp = ticker.E;

    this.currentPrice = price;

    // Add to history
    this.priceHistory.push({ price, timestamp });
    if (this.priceHistory.length > this.maxHistoryLength) {
      this.priceHistory.shift();
    }

    // Emit price update
    const btcTicker: BTCTicker = {
      price,
      timestamp,
      change24h: ((price - parseFloat(ticker.o)) / parseFloat(ticker.o)) * 100,
      volume24h: parseFloat(ticker.q),
    };

    this.emit("price", btcTicker);
  }

  /**
   * Start a new 15-minute window for tracking
   */
  startWindow(): void {
    this.windowStartPrice = this.currentPrice;
    this.windowStartTime = Date.now();
    console.log(
      `[Binance] Started window at $${this.windowStartPrice?.toFixed(2)}`,
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
   * Returns probability estimate based on current trajectory
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

    // Strong moves are more confident
    const absChange = Math.abs(change.percent);
    let confidence = Math.min(absChange * 20, 0.95); // Cap at 95%

    // If change is tiny, we're uncertain
    if (absChange < 0.01) {
      return { direction: "NEUTRAL", confidence: 0.1, change: change.percent };
    }

    const direction = change.percent > 0 ? "UP" : "DOWN";

    // Add momentum factor from recent price action
    const momentum = this.getRecentMomentum();
    if (
      (direction === "UP" && momentum > 0) ||
      (direction === "DOWN" && momentum < 0)
    ) {
      confidence = Math.min(confidence + 0.1, 0.95);
    }

    return { direction, confidence, change: change.percent };
  }

  /**
   * Calculate recent price momentum (last 30 seconds)
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
   * Get price volatility (standard deviation) over recent period
   */
  getVolatility(periodMs: number = 60000): number {
    const now = Date.now();
    const cutoff = now - periodMs;

    const recentPrices = this.priceHistory
      .filter((p) => p.timestamp > cutoff)
      .map((p) => p.price);

    if (recentPrices.length < 2) return 0;

    const mean = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const squaredDiffs = recentPrices.map((p) => Math.pow(p - mean, 2));
    const variance =
      squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length;

    return Math.sqrt(variance);
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
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Disconnect from Binance
   */
  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.priceHistory = [];
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[Binance] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[Binance] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    setTimeout(() => {
      this.connect();
    }, delay);
  }
}
