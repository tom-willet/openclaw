#!/usr/bin/env node
import { PolymarketAgent } from "./agent.js";
import { BTCUpdownTracker } from "./btc-tracker.js";
import type { AgentConfig } from "./types.js";

const DEFAULT_CONFIG: AgentConfig = {
  dryRun: true,
  maxPositionSize: 100,
  checkInterval: 60, // 60 seconds
  logLevel: "info",
};

async function startAgent(): Promise<void> {
  console.log("Starting Polymarket BTC 15m agent...\n");

  const config: AgentConfig = {
    dryRun: process.env.POLYMARKET_DRY_RUN !== "false",
    maxPositionSize: parseInt(
      process.env.POLYMARKET_MAX_POSITION_SIZE || "100",
    ),
    checkInterval: parseInt(process.env.POLYMARKET_CHECK_INTERVAL || "60"),
    logLevel: (process.env.POLYMARKET_LOG_LEVEL as any) || "info",
  };

  const agent = new PolymarketAgent(config);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, stopping agent...");
    await agent.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, stopping agent...");
    await agent.stop();
    process.exit(0);
  });

  try {
    await agent.start();

    // Keep process alive
    console.log("\nAgent running. Press Ctrl+C to stop.\n");
  } catch (err) {
    console.error("Failed to start agent:", err);
    process.exit(1);
  }
}

async function detectMarket(slug?: string): Promise<void> {
  if (slug) {
    console.log(`Fetching specific market: ${slug}\n`);
  } else {
    console.log("Detecting current BTC 15m market...\n");
  }

  const tracker = new BTCUpdownTracker();
  const market = slug
    ? await tracker.fetchMarketBySlug(slug)
    : await tracker.detectCurrentMarket();

  if (!market) {
    console.error("No active market found");
    if (!slug) {
      console.log(
        "\nTip: These markets rotate every 15 minutes and close quickly.",
      );
      console.log("Try passing a specific slug:");
      console.log("  pnpm detect btc-updown-15m-1770199200");
    }
    process.exit(1);
  }

  const state = tracker.getState();
  if (state) {
    console.log("\n" + "=".repeat(60));
    console.log("MARKET FOUND");
    console.log("=".repeat(60));
    console.log("Question:", state.question);
    console.log("Condition ID:", state.conditionId);
    console.log("End Time:", state.endTime.toISOString());
    console.log("\nToken IDs:");
    console.log("  YES:", state.yesTokenId);
    console.log("  NO:", state.noTokenId);
    console.log("\nCurrent Prices:");
    console.log("  YES:", (state.currentPrice.yes * 100).toFixed(2) + "%");
    console.log("  NO:", (state.currentPrice.no * 100).toFixed(2) + "%");

    const timeToExpiry = tracker.getTimeToExpiry();
    if (timeToExpiry) {
      const minutes = Math.floor(timeToExpiry / 60000);
      const seconds = Math.floor((timeToExpiry % 60000) / 1000);
      console.log("\nTime to Expiry:", `${minutes}m ${seconds}s`);
    }
    console.log("=".repeat(60) + "\n");
  }
}

async function testWebSocket(): Promise<void> {
  console.log("Testing WebSocket connection...\n");

  const { PolymarketWSClient } = await import("./websocket.js");
  const tracker = new BTCUpdownTracker();

  // First detect the market
  const market = await tracker.detectCurrentMarket();
  if (!market) {
    console.error("No active market found");
    process.exit(1);
  }

  const tokenIds = tracker.getTokenIds();
  console.log("Subscribing to tokens:", tokenIds);

  const ws = new PolymarketWSClient();

  ws.on("connected", () => {
    console.log("✓ WebSocket connected");
    ws.subscribe(tokenIds);
  });

  ws.on("price", (price) => {
    console.log(`[Price] ${price.market.substring(0, 8)}... @ ${price.price}`);
  });

  ws.on("orderbook", (orderbook) => {
    const bestBid = orderbook.bids[0]?.price || "N/A";
    const bestAsk = orderbook.asks[0]?.price || "N/A";
    console.log(
      `[Book] ${orderbook.market.substring(0, 8)}... Bid: ${bestBid}, Ask: ${bestAsk}`,
    );
  });

  ws.on("trade", (trade) => {
    console.log(`[Trade] ${trade.side} @ ${trade.price} (size: ${trade.size})`);
  });

  ws.on("error", (err) => {
    console.error("WebSocket error:", err.message);
  });

  // Connect
  await ws.connect();

  console.log("\nListening for updates... Press Ctrl+C to stop.\n");

  // Keep alive
  process.on("SIGINT", () => {
    console.log("\nDisconnecting...");
    ws.disconnect();
    process.exit(0);
  });
}

function printHelp(): void {
  console.log(`
Polymarket BTC 15m Agent - CLI

Usage:
  pnpm start              Start the agent (dry run mode)
  pnpm detect             Detect current BTC 15m market
  pnpm test               Test WebSocket connection

Environment Variables:
  POLYMARKET_DRY_RUN              Enable dry run mode (default: true)
  POLYMARKET_MAX_POSITION_SIZE    Max position size in USD (default: 100)
  POLYMARKET_CHECK_INTERVAL       Check interval in seconds (default: 60)
  POLYMARKET_LOG_LEVEL            Log level: debug|info|warn|error (default: info)

Examples:
  # Start agent with debug logging
  POLYMARKET_LOG_LEVEL=debug pnpm start

  # Detect current market
  pnpm detect

  # Test WebSocket connection
  pnpm test
`);
}

// Parse CLI arguments
const args = process.argv.slice(2);
const command = args[0];
const param = args[1];

switch (command) {
  case "start":
    startAgent();
    break;
  case "detect":
    detectMarket(param); // param is optional slug
    break;
  case "test":
    testWebSocket();
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    if (!command) {
      // Default to start
      startAgent();
    } else {
      console.error(`Unknown command: ${command}\n`);
      printHelp();
      process.exit(1);
    }
}
