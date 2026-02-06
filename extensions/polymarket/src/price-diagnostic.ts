/**
 * Price Diagnostic Tool - Compare BTC prices across sources
 *
 * Shows real-time BTC prices from multiple exchanges to understand:
 * 1. Price spreads between sources
 * 2. Which source Polymarket likely uses for settlement
 * 3. Basis risk impact on 15-minute markets
 */

interface PriceSource {
  name: string;
  price: number | null;
  timestamp: number;
  error?: string;
}

async function fetchBinancePrice(): Promise<number> {
  const response = await fetch(
    "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
  );
  const data = await response.json();
  return parseFloat(data.price);
}

async function fetchCoinbasePrice(): Promise<number> {
  const response = await fetch(
    "https://api.coinbase.com/v2/prices/BTC-USD/spot",
  );
  const data = await response.json();
  return parseFloat(data.data.amount);
}

async function fetchKrakenPrice(): Promise<number> {
  const response = await fetch(
    "https://api.kraken.com/0/public/Ticker?pair=XBTUSD",
  );
  const data = await response.json();
  return parseFloat(data.result.XXBTZUSD.c[0]);
}

async function fetchCoinGeckoPrice(): Promise<number> {
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  );
  const data = await response.json();
  return data.bitcoin.usd;
}

async function getAllPrices(): Promise<PriceSource[]> {
  const sources: PriceSource[] = [];
  const now = Date.now();

  // Binance
  try {
    const price = await fetchBinancePrice();
    sources.push({ name: "Binance", price, timestamp: now });
  } catch (err: any) {
    sources.push({
      name: "Binance",
      price: null,
      timestamp: now,
      error: err.message,
    });
  }

  // Coinbase
  try {
    const price = await fetchCoinbasePrice();
    sources.push({ name: "Coinbase", price, timestamp: now });
  } catch (err: any) {
    sources.push({
      name: "Coinbase",
      price: null,
      timestamp: now,
      error: err.message,
    });
  }

  // Kraken
  try {
    const price = await fetchKrakenPrice();
    sources.push({ name: "Kraken", price, timestamp: now });
  } catch (err: any) {
    sources.push({
      name: "Kraken",
      price: null,
      timestamp: now,
      error: err.message,
    });
  }

  // CoinGecko
  try {
    const price = await fetchCoinGeckoPrice();
    sources.push({ name: "CoinGecko", price, timestamp: now });
  } catch (err: any) {
    sources.push({
      name: "CoinGecko",
      price: null,
      timestamp: now,
      error: err.message,
    });
  }

  return sources;
}

async function runDiagnostic() {
  console.log("\n=".repeat(60));
  console.log("BTC PRICE DIAGNOSTIC");
  console.log("=".repeat(60));
  console.log(`Time: ${new Date().toISOString()}\n`);

  const sources = await getAllPrices();
  const validPrices = sources.filter(
    (s) => s.price !== null,
  ) as (PriceSource & { price: number })[];

  // Display prices
  console.log("SOURCE         PRICE       ERROR");
  console.log("-".repeat(60));
  for (const source of sources) {
    if (source.price !== null) {
      console.log(
        `${source.name.padEnd(14)} $${source.price.toFixed(2).padStart(10)}  `,
      );
    } else {
      console.log(
        `${source.name.padEnd(14)} ${"ERROR".padStart(10)}   ${source.error}`,
      );
    }
  }

  if (validPrices.length < 2) {
    console.log("\n⚠️  Not enough valid prices for comparison");
    return;
  }

  // Calculate statistics
  const prices = validPrices.map((s) => s.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const spread = maxPrice - minPrice;
  const spreadPercent = (spread / avgPrice) * 100;

  console.log("\n" + "-".repeat(60));
  console.log("STATISTICS");
  console.log("-".repeat(60));
  console.log(`Average:       $${avgPrice.toFixed(2)}`);
  console.log(
    `Min:           $${minPrice.toFixed(2)} (${validPrices.find((s) => s.price === minPrice)?.name})`,
  );
  console.log(
    `Max:           $${maxPrice.toFixed(2)} (${validPrices.find((s) => s.price === maxPrice)?.name})`,
  );
  console.log(
    `Spread:        $${spread.toFixed(2)} (${spreadPercent.toFixed(3)}%)`,
  );

  console.log("\n" + "-".repeat(60));
  console.log("IMPACT ON 15-MINUTE MARKETS");
  console.log("-".repeat(60));

  // Simulate different scenarios
  const scenarios = [
    { name: "Small move", priceChange: 50 },
    { name: "Medium move", priceChange: 100 },
    { name: "Large move", priceChange: 200 },
  ];

  for (const scenario of scenarios) {
    const highSource = maxPrice;
    const lowSource = minPrice;

    // Case 1: UP market - both agree
    const highUp =
      ((highSource + scenario.priceChange - highSource) / highSource) * 100;
    const lowUp =
      ((lowSource + scenario.priceChange - lowSource) / lowSource) * 100;

    console.log(`\n${scenario.name} UP (+$${scenario.priceChange}):`);
    console.log(`  Binance (high): +${highUp.toFixed(4)}% → UP`);
    console.log(`  Coinbase (low): +${lowUp.toFixed(4)}% → UP`);
    console.log(`  Risk: ✅ Both agree`);

    // Case 2: Very small move - potential disagreement
    const tinyMove = spread / 2;
    const highTiny = ((highSource + tinyMove - highSource) / highSource) * 100;
    const lowTiny = ((lowSource + tinyMove - lowSource) / lowSource) * 100;
    const expectedLow = lowSource + tinyMove;

    if (expectedLow < highSource) {
      console.log(`\n${scenario.name} TINY MOVE (+$${tinyMove.toFixed(2)}):`);
      console.log(`  Binance (high): +${highTiny.toFixed(4)}% → UP`);
      console.log(
        `  Coinbase (low): ${expectedLow < lowSource ? "-" : "+"}${Math.abs(lowTiny).toFixed(4)}% → ${expectedLow > lowSource ? "UP" : "DOWN"}`,
      );
      console.log(`  Risk: ⚠️  POTENTIAL DISAGREEMENT on flat markets`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("CONCLUSION");
  console.log("=".repeat(60));
  console.log(`Price spread of $${spread.toFixed(2)} creates BASIS RISK:`);
  console.log(`- Large moves (>$${spread * 2}): Both sources agree ✅`);
  console.log(`- Small moves (<$${spread}): Risk of opposite outcomes ⚠️`);
  console.log(
    `\nSOLUTION: Use Chainlink (Polymarket's actual settlement source)`,
  );
  console.log("=".repeat(60) + "\n");
}

// Run diagnostic
runDiagnostic().catch(console.error);
