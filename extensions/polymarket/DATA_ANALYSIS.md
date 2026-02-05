# Polymarket Data Analysis - What We're Getting vs Missing

## Summary

We discovered that **we ARE receiving orderbook and trade data** via WebSocket, but **we're not parsing it correctly**. Additionally, the **CLOB REST API provides rich orderbook depth**.

---

## 1. WebSocket Data (wss://ws-subscriptions-clob.polymarket.com/ws/market)

### Message 1: Initial Orderbook Snapshot (Array Format)

```json
[
  {
    "market": "0x75b508d9a71fa0b0a2b06614e55d5d07310fe49081d974291c3657f2ae919be0",
    "asset_id": "20029595910313680645703328721798883634783193708678231680243889571719980274044",
    "timestamp": "1770248188014",
    "hash": "e362f0481f6c5be99c7352a6e3440a5010c9cbdb",
    "bids": [
      { "price": "0.01", "size": "13793.62" },
      { "price": "0.02", "size": "5322.75" },
      ...
    ],
    "asks": [...]
  }
]
```

**Status:** ✅ Received but ❌ **NOT PARSED**

- Our code handles `item.event_type` but initial snapshot has no event_type
- We need to detect array format and extract orderbook

### Message 2: Last Trade Price

```json
{
  "market": "0x...",
  "asset_id": "...",
  "price": "0.33",
  "size": "5.151514",
  "fee_rate_bps": "1000",
  "side": "BUY",
  "timestamp": "1770248188041",
  "event_type": "last_trade_price",
  "transaction_hash": "0x..."
}
```

**Status:** ✅ Received, ✅ Parsed as price update

- Currently only updates price, not capturing as trade
- Not storing transaction_hash or fee info

### Messages 3+: Price Changes (Orderbook Updates)

```json
{
  "market": "0x...",
  "price_changes": [
    {
      "asset_id": "...",
      "price": "0.39",
      "size": "1016.39",
      "side": "SELL",
      "hash": "af6b72ed51bcd1243daf90ccb3e8d8820b650086",
      "best_bid": "0.32",
      "best_ask": "0.33"
    }
  ]
}
```

**Status:** ✅ Received but ❌ **NOT PARSED AT ALL**

- No event_type field
- Contains critical data: best_bid, best_ask, trade direction
- This is essentially real-time orderbook depth updates

---

## 2. REST API Data (https://clob.polymarket.com)

### Orderbook Endpoint: `/book?token_id={token_id}`

```json
{
  "market": "0x...",
  "asset_id": "...",
  "timestamp": "1770247522872",
  "hash": "62f80ebfe02dc966260fb58f9400a5a92121d69f",
  "bids": [
    { "price": "0.01", "size": "14225.02" },
    { "price": "0.02", "size": "6461.8" },
    ... (100+ levels)
  ],
  "asks": [
    { "price": "0.99", "size": "12817.44" },
    { "price": "0.98", "size": "3552.96" }
  ],
  "min_order_size": "5",
  "tick_size": "0.01",
  "neg_risk": false,
  "last_trade_price": "0.020"
}
```

**Status:** ✅ Available, ❌ **NOT USED**

- Provides full orderbook depth (100+ price levels)
- Includes last_trade_price
- Can be polled periodically or on-demand

### Trades Endpoint: `/trades?market={market_id}`

**Status:** 🔒 **Requires API Key**

- Returns: `{"error": "Unauthorized/Invalid api key"}`
- Would provide historical trade data if authenticated

---

## 3. What We're Currently Doing

### ✅ Working:

1. **Price updates** from WebSocket (YES/NO prices)
2. **BTC price feed** from Binance
3. **Market detection** via Gamma API
4. **Time decay signals**
5. **Price inefficiency detection**

### ❌ Missing (Data is available but not used):

1. **Orderbook depth** - Initial snapshot ignored
2. **Best bid/ask spread** - In price_changes but not parsed
3. **Trade direction/size** - In price_changes but not parsed
4. **Orderbook imbalance** - Can't calculate without bid/ask depth
5. **Trade momentum** - Can't calculate without trade history

---

## 4. Why Strategy Isn't Trading

### Current Signal Weights:

- Time Decay: 35% (only active <3min to expiry)
- Orderbook Imbalance: 20% ❌ **NO DATA**
- Trade Momentum: 15% ❌ **NO DATA**
- BTC Price Movement: 20% ✅ **WORKING**
- Price Inefficiency: 10% ✅ **WORKING**

### Maximum Possible Composite:

- **65% max** (35% + 20% + 10%) when time decay active
- **30% most of the time** (20% + 10%) before time decay
- **Threshold: 55%** to generate trade signal

### Why 55% is hard to reach:

1. **First 12 minutes:** Only 30% signals active (BTC + Price Inef)
2. **Last 3 minutes:** Time decay adds 35%, reaches 65% potential
3. **BUT:** Markets become efficient near expiry, eliminating price inefficiency edge
4. **Result:** Composite stays around 30-40%, rarely hits 55%

---

## 5. Recommended Fixes

### Priority 1: Parse WebSocket Orderbook Data ⚡

```typescript
// Handle initial array snapshot
if (Array.isArray(parsed)) {
  parsed.forEach((item) => {
    if (item.bids && item.asks) {
      // This is an orderbook snapshot
      this.handleOrderbookSnapshot(item);
    } else if (item.event_type) {
      this.handleEventMessage(item);
    }
  });
}

// Handle price_changes messages
if (parsed.price_changes && Array.isArray(parsed.price_changes)) {
  this.handlePriceChanges(parsed);
}
```

### Priority 2: Poll CLOB API for Orderbook Depth

```typescript
// Every cycle, fetch full orderbook
const response = await fetch(
  `https://clob.polymarket.com/book?token_id=${tokenId}`,
);
const orderbook = await response.json();
// Calculate bid/ask imbalance, depth, spread
```

### Priority 3: Calculate Missing Signals

With orderbook data available:

- **Orderbook Imbalance:** Sum(bid sizes) / Sum(ask sizes) on YES token
- **Trade Momentum:** Track price_changes events with side/size
- **Spread Analysis:** best_ask - best_bid indicates liquidity

### Priority 4: Adjust Thresholds

- **Lower confidence threshold** from 55% to 40-45%
- **OR** Activate time decay earlier (5min instead of 3min)
- **OR** Increase BTC Movement weight from 20% to 30%

---

## 6. Expected Improvement

### With Orderbook + Trade Data:

- **Maximum composite: 100%** (all signals active)
- **Typical composite: 60-80%** throughout market lifecycle
- **Trade frequency: 2-5 trades per 15min market**
- **Better edge detection:** Orderbook imbalance + momentum = smart money signals

### Example Signal Breakdown (with fixes):

```
Time: 10 minutes to expiry
BTC: +0.15% (UP, 80% conf)
Market: YES 45%, NO 55%

Signals:
  Time Decay:      +50% (50% conf) [now active at 10min]
  Orderbook:       +100% (80% conf) [YES bids 3x NO bids]
  Momentum:        +100% (70% conf) [last 10 trades bought YES]
  BTC Move:        +100% (80% conf) [BTC trending up]
  Price Inef:      +100% (70% conf) [YES should be 60%]

  COMPOSITE:       +73% (71% conf) ✅ TRADE SIGNAL!

Action: BUY YES at 0.45 (Kelly size: $15)
```

---

## 7. Next Steps

1. **Phase 1:** Fix WebSocket parsing (add handlers for array snapshots and price_changes)
2. **Phase 2:** Add CLOB API polling every cycle
3. **Phase 3:** Implement orderbook imbalance calculation
4. **Phase 4:** Implement trade momentum tracking
5. **Phase 5:** Adjust threshold or weights based on backtesting
6. **Phase 6:** Run full evaluation with all signals active
