import WebSocket from "ws";
import { EventEmitter } from "events";
import type { WSMessage, Price, Orderbook, Trade } from "./types.js";
import { WSMessageSchema } from "./types.js";

interface SubscriptionRequest {
  type: "MARKET" | "USER";
  assets_ids?: string[]; // For market channel (note: assets_ids not asset_ids)
  markets?: string[]; // For user channel (condition IDs)
}

export class PolymarketWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private pingInterval: NodeJS.Timeout | null = null;
  private subscribedMarkets = new Set<string>();

  constructor(
    wsUrl: string = "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  ) {
    super();
    this.wsUrl = wsUrl;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.on("open", () => {
          console.log("[Polymarket WS] Connected");
          this.reconnectAttempts = 0;
          this.startPing();

          // Resubscribe to markets
          if (this.subscribedMarkets.size > 0) {
            this.subscribe(Array.from(this.subscribedMarkets));
          }

          this.emit("connected");
          resolve();
        });

        this.ws.on("message", (data: Buffer) => {
          try {
            const raw = data.toString();
            const parsed = JSON.parse(raw);

            // Handle different message formats from Polymarket
            if (Array.isArray(parsed)) {
              // Handle array of events (common for book updates)
              parsed.forEach((item) => {
                if (item.bids && item.asks) {
                  // Initial orderbook snapshot
                  this.emit("orderbook", item);
                } else if (item.event_type) {
                  this.handleEventMessage(item);
                }
              });
            } else if (
              parsed.price_changes &&
              Array.isArray(parsed.price_changes)
            ) {
              // Price changes message with best_bid/best_ask
              this.handlePriceChanges(parsed);
            } else if (parsed.event_type) {
              // Single event-based format
              this.handleEventMessage(parsed);
            } else {
              // Try to parse as standard WSMessage
              const result = WSMessageSchema.safeParse(parsed);
              if (result.success) {
                this.handleMessage(result.data);
              } else {
                console.warn(
                  "[Polymarket WS] Unknown message format:",
                  raw.substring(0, 200),
                );
              }
            }
          } catch (err) {
            console.error("[Polymarket WS] Failed to parse message:", err);
          }
        });

        this.ws.on("error", (error) => {
          console.error("[Polymarket WS] Error:", error.message);
          this.emit("error", error);
        });

        this.ws.on("close", () => {
          console.log("[Polymarket WS] Connection closed");
          this.stopPing();
          this.emit("disconnected");
          this.attemptReconnect();
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleEventMessage(data: any): void {
    // Handle Polymarket's event-based message format
    switch (data.event_type) {
      case "price_change":
        if (data.market && data.price) {
          const price: Price = {
            market: data.market,
            price: String(data.price),
            side: data.side || "BUY",
            size: String(data.size || 0),
            timestamp: Date.now(),
          };
          this.emit("price", price);
        }
        break;

      case "last_trade_price":
        // Last trade price update - treat as price update
        if (data.asset_id && data.price) {
          const price: Price = {
            market: data.asset_id,
            price: String(data.price),
            side: "BUY", // Last trade doesn't specify side
            size: "0",
            timestamp: Date.now(),
          };
          this.emit("price", price);
        }
        break;

      case "book":
        // Order book update
        if (data.asset_id) {
          this.emit("orderbook", data);
        }
        break;

      case "trade":
        // Actual trade execution
        if (data.asset_id && data.price && data.size) {
          const trade: Trade = {
            id: data.id || String(Date.now()),
            market: data.market || data.asset_id,
            asset_id: data.asset_id,
            side: data.side || "BUY",
            price: String(data.price),
            size: String(data.size),
            timestamp: data.timestamp || Date.now(),
          };
          this.emit("trade", trade);
        }
        break;

      default:
        console.log("[Polymarket WS] Unhandled event type:", data.event_type);
    }
  }

  private handlePriceChanges(data: any): void {
    // Handle price_changes messages with real-time orderbook updates
    if (!data.price_changes || !Array.isArray(data.price_changes)) return;

    data.price_changes.forEach((change: any) => {
      // Emit as trade for momentum tracking
      if (change.asset_id && change.price && change.size && change.side) {
        const trade: Trade = {
          id: change.hash || String(Date.now()),
          market: data.market,
          asset_id: change.asset_id,
          side: change.side,
          price: String(change.price),
          size: String(change.size),
          timestamp: Date.now(),
        };
        this.emit("trade", trade);
      }

      // Emit orderbook update if best_bid/best_ask present
      if (change.best_bid || change.best_ask) {
        this.emit("orderbook", {
          asset_id: change.asset_id,
          market: data.market,
          best_bid: change.best_bid,
          best_ask: change.best_ask,
          timestamp: Date.now(),
        });
      }
    });
  }

  private handleMessage(message: WSMessage): void {
    switch (message.type) {
      case "price":
        this.emit("price", message.data);
        break;
      case "book":
        this.emit("orderbook", message.data);
        break;
      case "trade":
        this.emit("trade", message.data);
        break;
      case "error":
        console.error("[Polymarket WS] Server error:", message.message);
        this.emit("error", new Error(message.message));
        break;
    }
  }

  subscribe(markets: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn("[Polymarket WS] Cannot subscribe: not connected");
      return;
    }

    markets.forEach((m) => this.subscribedMarkets.add(m));

    const request: SubscriptionRequest = {
      type: "MARKET",
      assets_ids: markets, // These are token IDs
    };

    this.ws.send(JSON.stringify(request));
    console.log(`[Polymarket WS] Subscribed to ${markets.length} token(s)`);
  }

  unsubscribe(markets: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    markets.forEach((m) => this.subscribedMarkets.delete(m));

    // Send unsubscribe with operation field
    const request = {
      assets_ids: markets,
      operation: "unsubscribe",
    };

    this.ws.send(JSON.stringify(request));
    console.log(`[Polymarket WS] Unsubscribed from ${markets.length} token(s)`);
  }

  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 30000); // Ping every 30 seconds
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[Polymarket WS] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(
      `[Polymarket WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.subscribedMarkets.clear();
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
