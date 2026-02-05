import type { PaperTrade, TradingSignal, PerformanceMetrics } from "./types.js";

/**
 * Paper trading tracker for dry-run performance evaluation.
 * Simulates real trades with capital management and PnL tracking.
 */
export class PaperTrader {
  private trades: PaperTrade[] = [];
  private startingCapital: number;
  private currentCapital: number;
  private tradeIdCounter = 0;

  constructor(startingCapital: number = 100) {
    this.startingCapital = startingCapital;
    this.currentCapital = startingCapital;
  }

  /**
   * Execute a paper trade from a signal
   */
  executeTrade(
    signal: TradingSignal,
    marketQuestion: string,
  ): PaperTrade | null {
    // Check if we have enough capital
    const cost = signal.price * signal.size;
    if (cost > this.currentCapital) {
      console.log(
        `[Paper Trade] Insufficient capital: need $${cost.toFixed(2)}, have $${this.currentCapital.toFixed(2)}`,
      );
      return null;
    }

    this.tradeIdCounter++;
    const trade: PaperTrade = {
      id: `PT-${this.tradeIdCounter}`,
      market: signal.market,
      marketQuestion,
      outcome: signal.outcome,
      entryPrice: signal.price,
      entryTime: new Date(),
      size: signal.size,
      cost,
      status: "open",
    };

    this.trades.push(trade);
    this.currentCapital -= cost;

    console.log(
      `\n[Paper Trade] EXECUTED ${trade.id}: ${trade.outcome.toUpperCase()} @ ${(trade.entryPrice * 100).toFixed(1)}% for $${trade.size.toFixed(2)}`,
    );
    console.log(
      `[Paper Trade] Capital: $${this.currentCapital.toFixed(2)} / $${this.startingCapital.toFixed(2)}`,
    );

    return trade;
  }

  /**
   * Close a specific trade
   */
  closeTrade(tradeId: string, exitPrice: number, reason = "manual"): void {
    const trade = this.trades.find(
      (t) => t.id === tradeId && t.status === "open",
    );
    if (!trade) {
      console.warn(
        `[Paper Trade] Trade ${tradeId} not found or already closed`,
      );
      return;
    }

    trade.exitPrice = exitPrice;
    trade.exitTime = new Date();
    trade.status = "closed";
    trade.closeReason = reason as any;

    // Calculate PnL
    // If we bought YES at 0.6 and it wins (1.0), we get: size * (1 - entryPrice) = profit
    // If we bought YES at 0.6 and it loses (0.0), we lose: size * entryPrice = loss
    if (exitPrice >= 0.99) {
      // Won
      trade.pnl = trade.size * (1 - trade.entryPrice);
    } else if (exitPrice <= 0.01) {
      // Lost
      trade.pnl = -trade.cost;
    } else {
      // Partial close or still uncertain
      trade.pnl = trade.size * (exitPrice - trade.entryPrice);
    }

    this.currentCapital += trade.cost + trade.pnl;

    console.log(
      `[Paper Trade] CLOSED ${trade.id}: ${trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)} (${((trade.pnl / trade.cost) * 100).toFixed(1)}% ROI)`,
    );
  }

  /**
   * Close all open trades at market expiry
   */
  closeAllTrades(finalOutcome: "yes" | "no"): void {
    const openTrades = this.trades.filter((t) => t.status === "open");

    if (openTrades.length === 0) return;

    console.log(
      `\n[Paper Trade] Market expired - final outcome: ${finalOutcome.toUpperCase()}`,
    );
    console.log(
      `[Paper Trade] Closing ${openTrades.length} open position(s)...`,
    );

    for (const trade of openTrades) {
      // Determine exit price based on final outcome
      const exitPrice = trade.outcome === finalOutcome ? 1.0 : 0.0;
      this.closeTrade(trade.id, exitPrice, "expired");
    }
  }

  /**
   * Calculate performance metrics
   */
  getMetrics(): PerformanceMetrics {
    const closedTrades = this.trades.filter((t) => t.status === "closed");

    if (closedTrades.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        totalCost: 0,
        roi: 0,
        avgWin: 0,
        avgLoss: 0,
        largestWi: 0,
        largestLoss: 0,
        sharpeRatio: 0,
        profitFactor: 0,
        startingCapital: this.startingCapital,
        endingCapital: this.currentCapital,
      };
    }

    const wins = closedTrades.filter((t) => t.pnl! > 0);
    const losses = closedTrades.filter((t) => t.pnl! < 0);

    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalCost = closedTrades.reduce((sum, t) => sum + t.cost, 0);

    const grossProfit = wins.reduce((sum, t) => sum + t.pnl!, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl!, 0));

    // Sharpe ratio (simplified, assuming risk-free rate = 0)
    const returns = closedTrades.map((t) => (t.pnl! / t.cost) * 100);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
        returns.length,
    );
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    return {
      totalTrades: closedTrades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: closedTrades.length > 0 ? wins.length / closedTrades.length : 0,
      totalPnL,
      totalCost,
      roi: totalCost > 0 ? (totalPnL / totalCost) * 100 : 0,
      avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
      avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
      largestWi: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl!)) : 0,
      largestLoss:
        losses.length > 0 ? Math.min(...losses.map((t) => t.pnl!)) : 0,
      sharpeRatio,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
      startingCapital: this.startingCapital,
      endingCapital: this.currentCapital,
    };
  }

  /**
   * Print performance report
   */
  printReport(): void {
    const metrics = this.getMetrics();

    console.log("\n" + "=".repeat(60));
    console.log("PAPER TRADING PERFORMANCE REPORT");
    console.log("=".repeat(60));
    console.log(`Starting Capital: $${metrics.startingCapital.toFixed(2)}`);
    console.log(`Ending Capital:   $${metrics.endingCapital.toFixed(2)}`);
    console.log(
      `Total P&L:        ${metrics.totalPnL >= 0 ? "+" : ""}$${metrics.totalPnL.toFixed(2)}`,
    );
    console.log(
      `ROI:              ${metrics.roi >= 0 ? "+" : ""}${metrics.roi.toFixed(2)}%`,
    );
    console.log("");
    console.log(`Total Trades:     ${metrics.totalTrades}`);
    console.log(
      `Win Rate:         ${(metrics.winRate * 100).toFixed(1)}% (${metrics.winningTrades}W / ${metrics.losingTrades}L)`,
    );

    if (metrics.totalTrades > 0) {
      console.log("");
      console.log(`Avg Win:          +$${metrics.avgWin.toFixed(2)}`);
      console.log(`Avg Loss:         -$${metrics.avgLoss.toFixed(2)}`);
      console.log(`Largest Win:      +$${metrics.largestWi.toFixed(2)}`);
      console.log(`Largest Loss:     $${metrics.largestLoss.toFixed(2)}`);
      console.log(`Profit Factor:    ${metrics.profitFactor.toFixed(2)}x`);
      console.log(`Sharpe Ratio:     ${metrics.sharpeRatio.toFixed(2)}`);
    }

    console.log("=".repeat(60));

    // Print trade history
    if (this.trades.length > 0) {
      console.log("\nTrade History:");
      console.log("-".repeat(60));
      for (const trade of this.trades) {
        const duration = trade.exitTime
          ? Math.round(
              (trade.exitTime.getTime() - trade.entryTime.getTime()) /
                1000 /
                60,
            )
          : "?";
        const pnlStr =
          trade.pnl !== undefined
            ? `${trade.pnl >= 0 ? "+" : ""}$${trade.pnl.toFixed(2)}`
            : "OPEN";
        console.log(
          `${trade.id}: ${trade.outcome.toUpperCase()} @ ${(trade.entryPrice * 100).toFixed(1)}% → ${trade.exitPrice ? (trade.exitPrice * 100).toFixed(1) + "%" : "?"} | $${trade.size.toFixed(2)} | ${pnlStr} | ${duration}m`,
        );
      }
      console.log("-".repeat(60));
    }
    console.log("");
  }

  /**
   * Get all trades
   */
  getTrades(): PaperTrade[] {
    return [...this.trades];
  }

  /**
   * Get open trades
   */
  getOpenTrades(): PaperTrade[] {
    return this.trades.filter((t) => t.status === "open");
  }

  /**
   * Get current capital
   */
  getCurrentCapital(): number {
    return this.currentCapital;
  }

  /**
   * Reset for new market
   */
  reset(newCapital?: number): void {
    this.trades = [];
    this.tradeIdCounter = 0;
    if (newCapital !== undefined) {
      this.startingCapital = newCapital;
    }
    this.currentCapital = this.startingCapital;
  }
}
