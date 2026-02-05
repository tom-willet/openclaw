import type {
  MarketState,
  Price,
  Orderbook,
  Trade,
  TradeHistory,
  OrderbookDepth,
} from "./types.js";

interface BTCMarketInfo {
  slug: string;
  conditionId: string;
  question: string;
  endTime: Date;
  yesTokenId: string;
  noTokenId: string;
}

/**
 * Detects and tracks the current 15-minute BTC updown market on Polymarket.
 * These markets rotate every 15 minutes with a specific naming pattern.
 */
export class BTCUpdownTracker {
  private currentMarket: BTCMarketInfo | null = null;
  private marketState: MarketState | null = null;
  private updateCallbacks: Set<(state: MarketState) => void> = new Set();

  // Trade history tracking
  private tradeHistory: TradeHistory[] = [];
  private maxTradeHistory = 100; // Keep last 100 trades

  /**
   * Fetch the current active 15-minute BTC updown market from Polymarket API
   * Uses timestamp-based slug pattern: btc-updown-15m-{unix_timestamp}
   */
  async detectCurrentMarket(): Promise<BTCMarketInfo | null> {
    try {
      console.log("[BTC Tracker] Searching for BTC updown 15m markets...");

      // Calculate current 15-minute window
      // These markets start every 15 minutes (900 seconds)
      const now = Math.floor(Date.now() / 1000); // Current Unix timestamp

      // Try a few recent 15-minute windows
      const timestamps = [];
      for (let i = -2; i <= 2; i++) {
        const rounded = Math.floor(now / 900) * 900 + i * 900;
        timestamps.push(rounded);
      }

      console.log(
        `[BTC Tracker] Checking timestamps: ${timestamps.join(", ")}`,
      );

      // Try to find the market by slug pattern
      for (const ts of timestamps) {
        const slug = `btc-updown-15m-${ts}`;
        console.log(`[BTC Tracker] Trying slug: ${slug}`);

        try {
          const response = await fetch(
            `https://gamma-api.polymarket.com/markets/slug/${slug}`,
          );

          if (response.ok) {
            const market = await response.json();

            // Check if market is active AND not expired
            const endTime = new Date(market.endDate);
            const now = new Date();
            const isExpired = endTime <= now;

            if (!market.closed && market.active && !isExpired) {
              console.log(
                `[BTC Tracker] Found active market: ${market.question}`,
              );
              return this.processMarket(market, slug);
            } else {
              console.log(
                `[BTC Tracker] Market ${slug} is not active (closed=${market.closed}, active=${market.active}, expired=${isExpired})`,
              );
            }
          }
        } catch (err) {
          // Market not found for this timestamp, continue
          continue;
        }
      }

      console.warn(
        "\n[BTC Tracker] No active 15m BTC updown market found in recent windows",
      );
      console.log("[BTC Tracker] These markets rotate every 15 minutes");
      return null;
    } catch (err) {
      console.error("[BTC Tracker] Failed to detect market:", err);
      return null;
    }
  }

  /**
   * Directly fetch a specific market by slug
   * Example: btc-updown-15m-1770199200
   */
  async fetchMarketBySlug(slug: string): Promise<BTCMarketInfo | null> {
    try {
      console.log(`[BTC Tracker] Fetching market: ${slug}`);

      const response = await fetch(
        `https://gamma-api.polymarket.com/markets/slug/${slug}`,
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const market = await response.json();

      if (!market.active || market.closed) {
        console.warn(`[BTC Tracker] Market is not active`);
        return null;
      }

      return this.processMarket(market, slug);
    } catch (err) {
      console.error("[BTC Tracker] Failed to fetch market:", err);
      return null;
    }
  }

  /**
   * Process market data and extract relevant information
   */
  private processMarket(market: any, slug: string): BTCMarketInfo | null {
    // Parse outcomes and token IDs
    const outcomes = JSON.parse(market.outcomes || "[]");
    const clobTokenIds = JSON.parse(market.clobTokenIds || "[]");
    const outcomePrices = JSON.parse(market.outcomePrices || "[]");

    if (outcomes.length !== 2 || clobTokenIds.length !== 2) {
      console.error(
        "[BTC Tracker] Invalid market structure: expected 2 outcomes and 2 tokens",
      );
      return null;
    }

    // Map outcomes to token IDs
    // BTC updown markets typically have "Up" and "Down" outcomes
    const upIndex = outcomes.findIndex(
      (o: string) =>
        o.toLowerCase().includes("up") || o.toLowerCase().includes("yes"),
    );
    const downIndex = outcomes.findIndex(
      (o: string) =>
        o.toLowerCase().includes("down") || o.toLowerCase().includes("no"),
    );

    if (upIndex === -1 || downIndex === -1) {
      console.error("[BTC Tracker] Could not identify up/down outcomes");
      return null;
    }

    this.currentMarket = {
      slug: market.slug || slug,
      conditionId: market.conditionId,
      question: market.question,
      endTime: new Date(market.endDate),
      yesTokenId: clobTokenIds[upIndex],
      noTokenId: clobTokenIds[downIndex],
    };

    this.marketState = {
      conditionId: this.currentMarket.conditionId,
      question: this.currentMarket.question,
      endTime: this.currentMarket.endTime,
      yesTokenId: this.currentMarket.yesTokenId,
      noTokenId: this.currentMarket.noTokenId,
      currentPrice: {
        yes: parseFloat(outcomePrices[upIndex] || "0.5"),
        no: parseFloat(outcomePrices[downIndex] || "0.5"),
      },
      orderbook: {
        yes: null,
        no: null,
      },
      lastUpdate: new Date(),
    };

    console.log(`[BTC Tracker] Market: ${this.currentMarket.question}`);
    console.log(
      `[BTC Tracker] End time: ${this.currentMarket.endTime.toISOString()}`,
    );
    console.log(`[BTC Tracker] UP token: ${this.currentMarket.yesTokenId}`);
    console.log(`[BTC Tracker] DOWN token: ${this.currentMarket.noTokenId}`);

    return this.currentMarket;
  }

  /**
   * Update market state from WebSocket price updates
   */
  updatePrice(price: Price): void {
    if (!this.marketState || !this.currentMarket) return;

    const priceValue = parseFloat(price.price);

    if (price.market === this.currentMarket.yesTokenId) {
      this.marketState.currentPrice.yes = priceValue;
      this.marketState.lastUpdate = new Date();
      this.notifyUpdate();
    } else if (price.market === this.currentMarket.noTokenId) {
      this.marketState.currentPrice.no = priceValue;
      this.marketState.lastUpdate = new Date();
      this.notifyUpdate();
    }
  }

  /**
   * Update orderbook from WebSocket
   */
  updateOrderbook(orderbook: any): void {
    if (!this.marketState || !this.currentMarket) return;

    // Handle full orderbook snapshot
    if (orderbook.bids && orderbook.asks) {
      // Normalize timestamp to number if it's a string
      const normalizedBook = {
        ...orderbook,
        timestamp:
          typeof orderbook.timestamp === "string"
            ? parseInt(orderbook.timestamp)
            : orderbook.timestamp || Date.now(),
      };

      const isYes = orderbook.asset_id === this.currentMarket.yesTokenId;

      if (isYes) {
        this.marketState.orderbook.yes = normalizedBook;
      } else if (orderbook.asset_id === this.currentMarket.noTokenId) {
        this.marketState.orderbook.no = normalizedBook;
      }

      // Update current price from orderbook (best ask = market price to buy)
      if (normalizedBook.asks && normalizedBook.asks.length > 0) {
        const bestAsk = parseFloat(normalizedBook.asks[0].price);
        if (isYes) {
          this.marketState.currentPrice.yes = bestAsk;
        } else if (orderbook.asset_id === this.currentMarket.noTokenId) {
          this.marketState.currentPrice.no = bestAsk;
        }
      }

      this.marketState.lastUpdate = new Date();
      this.notifyUpdate();
      return;
    }

    // Handle best_bid/best_ask updates from price_changes
    if (orderbook.best_bid || orderbook.best_ask) {
      const isYes = orderbook.asset_id === this.currentMarket.yesTokenId;
      const book = isYes
        ? this.marketState.orderbook.yes
        : this.marketState.orderbook.no;

      if (!book) {
        // Create minimal orderbook from best prices
        const newBook = {
          market: orderbook.market,
          asset_id: orderbook.asset_id,
          timestamp: orderbook.timestamp || Date.now(),
          hash: "",
          bids: orderbook.best_bid
            ? [{ price: orderbook.best_bid, size: "0" }]
            : [],
          asks: orderbook.best_ask
            ? [{ price: orderbook.best_ask, size: "0" }]
            : [],
        };

        if (isYes) {
          this.marketState.orderbook.yes = newBook;
        } else {
          this.marketState.orderbook.no = newBook;
        }
      } else {
        // Update existing orderbook best prices
        if (orderbook.best_bid && book.bids && book.bids.length > 0) {
          book.bids[0].price = orderbook.best_bid;
        }
        if (orderbook.best_ask && book.asks && book.asks.length > 0) {
          book.asks[0].price = orderbook.best_ask;
        }
      }

      // Update current price from best ask
      if (orderbook.best_ask) {
        const bestAsk = parseFloat(orderbook.best_ask);
        if (isYes) {
          this.marketState.currentPrice.yes = bestAsk;
        } else {
          this.marketState.currentPrice.no = bestAsk;
        }
      }

      this.marketState.lastUpdate = new Date();
      this.notifyUpdate();
      return;
    }

    // Legacy handler for typed orderbook
    const isYes = orderbook.market === this.currentMarket.yesTokenId;

    if (isYes) {
      this.marketState.orderbook.yes = orderbook;
      // Update price from orderbook if available
      if (orderbook.asks && orderbook.asks.length > 0) {
        this.marketState.currentPrice.yes = parseFloat(orderbook.asks[0].price);
      }
    } else if (orderbook.market === this.currentMarket.noTokenId) {
      this.marketState.orderbook.no = orderbook;
      // Update price from orderbook if available
      if (orderbook.asks && orderbook.asks.length > 0) {
        this.marketState.currentPrice.no = parseFloat(orderbook.asks[0].price);
      }
    }

    this.marketState.lastUpdate = new Date();
    this.notifyUpdate();
  }

  /**
   * Handle trade events - store in history for momentum analysis
   */
  handleTrade(trade: Trade): void {
    if (!this.currentMarket) return;

    const isYes =
      trade.market === this.currentMarket.yesTokenId ||
      trade.asset_id === this.currentMarket.yesTokenId;
    const isNo =
      trade.market === this.currentMarket.noTokenId ||
      trade.asset_id === this.currentMarket.noTokenId;

    if (!isYes && !isNo) return;

    const outcome: "yes" | "no" = isYes ? "yes" : "no";

    // Store in trade history
    const tradeRecord: TradeHistory = {
      outcome,
      side: trade.side,
      price: parseFloat(trade.price),
      size: parseFloat(trade.size),
      timestamp: trade.timestamp,
      volume: parseFloat(trade.price) * parseFloat(trade.size),
    };

    this.tradeHistory.push(tradeRecord);
    if (this.tradeHistory.length > this.maxTradeHistory) {
      this.tradeHistory.shift();
    }

    console.log(
      `[BTC Tracker] Trade: ${trade.side} ${outcome.toUpperCase()} @ ${trade.price} (size: ${trade.size})`,
    );
  }

  /**
   * Fetch orderbook from CLOB API
   */
  async fetchOrderbookFromAPI(tokenId: string): Promise<any> {
    try {
      const response = await fetch(
        `https://clob.polymarket.com/book?token_id=${tokenId}`,
      );

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch (err) {
      console.error("[BTC Tracker] Failed to fetch orderbook:", err);
      return null;
    }
  }

  /**
   * Refresh orderbooks from API (called periodically)
   */
  async refreshOrderbooks(): Promise<void> {
    if (!this.currentMarket || !this.marketState) return;

    try {
      const [yesBook, noBook] = await Promise.all([
        this.fetchOrderbookFromAPI(this.currentMarket.yesTokenId),
        this.fetchOrderbookFromAPI(this.currentMarket.noTokenId),
      ]);

      if (yesBook && yesBook.bids && yesBook.asks) {
        this.marketState.orderbook.yes = yesBook;
      }

      if (noBook && noBook.bids && noBook.asks) {
        this.marketState.orderbook.no = noBook;
      }

      if (yesBook || noBook) {
        this.marketState.lastUpdate = new Date();
        this.notifyUpdate();
      }
    } catch (err) {
      console.error("[BTC Tracker] Failed to refresh orderbooks:", err);
    }
  }

  /**
   * Get recent trade momentum
   * Returns ratio of YES volume to total volume (0-1)
   * >0.5 means more buying pressure on YES
   */
  getTradeMomentum(lookbackMs: number = 60000): {
    yesRatio: number;
    totalVolume: number;
    tradeCount: number;
  } {
    const now = Date.now();
    const cutoff = now - lookbackMs;

    const recentTrades = this.tradeHistory.filter((t) => t.timestamp > cutoff);

    if (recentTrades.length === 0) {
      return { yesRatio: 0.5, totalVolume: 0, tradeCount: 0 };
    }

    let yesVolume = 0;
    let noVolume = 0;

    for (const trade of recentTrades) {
      // BUY on YES = bullish, SELL on YES = bearish
      // BUY on NO = bearish, SELL on NO = bullish
      const volume = trade.volume;

      if (trade.outcome === "yes") {
        if (trade.side === "BUY") yesVolume += volume;
        else noVolume += volume;
      } else {
        if (trade.side === "BUY") noVolume += volume;
        else yesVolume += volume;
      }
    }

    const totalVolume = yesVolume + noVolume;
    const yesRatio = totalVolume > 0 ? yesVolume / totalVolume : 0.5;

    return { yesRatio, totalVolume, tradeCount: recentTrades.length };
  }

  /**
   * Calculate orderbook depth and imbalance
   */
  getOrderbookAnalysis(): OrderbookDepth | null {
    if (!this.marketState) return null;

    const yesBook = this.marketState.orderbook.yes;
    const noBook = this.marketState.orderbook.no;

    if (!yesBook && !noBook) return null;

    // Calculate total bid/ask depth for each side
    const calculateDepth = (book: Orderbook | null, levels: number = 10) => {
      if (!book)
        return { bidDepth: 0, askDepth: 0, bestBid: 0, bestAsk: 1, spread: 1 };

      const topBids = book.bids.slice(0, levels);
      const topAsks = book.asks.slice(0, levels);

      const bidDepth = topBids.reduce((sum, o) => sum + parseFloat(o.size), 0);
      const askDepth = topAsks.reduce((sum, o) => sum + parseFloat(o.size), 0);

      const bestBid = topBids.length > 0 ? parseFloat(topBids[0].price) : 0;
      const bestAsk = topAsks.length > 0 ? parseFloat(topAsks[0].price) : 1;
      const spread = bestAsk - bestBid;

      return { bidDepth, askDepth, bestBid, bestAsk, spread };
    };

    const yesDepth = calculateDepth(yesBook);
    const noDepth = calculateDepth(noBook);

    // Calculate imbalance ratios
    // Higher yes bid depth = more demand for YES = bullish
    const yesBidRatio =
      yesDepth.bidDepth / (yesDepth.bidDepth + yesDepth.askDepth || 1);
    const noBidRatio =
      noDepth.bidDepth / (noDepth.bidDepth + noDepth.askDepth || 1);

    // Overall imbalance: positive = bullish (more YES buying pressure)
    const imbalance = yesBidRatio - noBidRatio;

    return {
      yesBidDepth: yesDepth.bidDepth,
      yesAskDepth: yesDepth.askDepth,
      noBidDepth: noDepth.bidDepth,
      noAskDepth: noDepth.askDepth,
      yesSpread: yesDepth.spread,
      noSpread: noDepth.spread,
      imbalance, // -1 to 1, positive = bullish
      yesBestBid: yesDepth.bestBid,
      yesBestAsk: yesDepth.bestAsk,
      noBestBid: noDepth.bestBid,
      noBestAsk: noDepth.bestAsk,
    };
  }

  /**
   * Get recent trade history
   */
  getTradeHistory(): TradeHistory[] {
    return [...this.tradeHistory];
  }

  /**
   * Clear trade history (on market change)
   */
  clearTradeHistory(): void {
    this.tradeHistory = [];
  }

  /**
   * Check if market has expired and needs refresh
   */
  isMarketExpired(): boolean {
    if (!this.currentMarket) return true;
    return new Date() >= this.currentMarket.endTime;
  }

  /**
   * Get time until market expiry
   */
  getTimeToExpiry(): number | null {
    if (!this.currentMarket) return null;
    return this.currentMarket.endTime.getTime() - Date.now();
  }

  /**
   * Register callback for state updates
   */
  onUpdate(callback: (state: MarketState) => void): void {
    this.updateCallbacks.add(callback);
  }

  /**
   * Unregister callback
   */
  offUpdate(callback: (state: MarketState) => void): void {
    this.updateCallbacks.delete(callback);
  }

  private notifyUpdate(): void {
    if (!this.marketState) return;
    this.updateCallbacks.forEach((cb) => cb(this.marketState!));
  }

  /**
   * Get current market state
   */
  getState(): MarketState | null {
    return this.marketState;
  }

  /**
   * Get token IDs for WebSocket subscription
   */
  getTokenIds(): string[] {
    if (!this.currentMarket) return [];
    return [this.currentMarket.yesTokenId, this.currentMarket.noTokenId];
  }

  /**
   * Get market spread (difference between yes and no price)
   */
  getSpread(): number | null {
    if (!this.marketState) return null;
    return Math.abs(
      this.marketState.currentPrice.yes - this.marketState.currentPrice.no,
    );
  }

  /**
   * Get implied probability from price
   */
  getImpliedProbability(outcome: "yes" | "no"): number | null {
    if (!this.marketState) return null;
    return outcome === "yes"
      ? this.marketState.currentPrice.yes
      : this.marketState.currentPrice.no;
  }

  /**
   * Reset tracker state
   */
  reset(): void {
    this.currentMarket = null;
    this.marketState = null;
    this.tradeHistory = [];
    this.updateCallbacks.clear();
  }
}
