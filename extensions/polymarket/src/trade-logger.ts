import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  appendFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import type { PaperTrade } from "./types.js";

interface DailyStats {
  date: string; // YYYY-MM-DD
  trades: number;
  wins: number;
  losses: number;
  totalPnL: number;
  startingCapital: number;
  endingCapital: number;
  roi: number;
  largestWin: number;
  largestLoss: number;
}

interface TradeLogEntry {
  timestamp: string;
  tradeId: string;
  market: string;
  outcome: "yes" | "no";
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  roi: number;
  duration: string;
  result: "win" | "loss" | "breakeven";
}

export class TradeLogger {
  private dataDir: string;
  private tradesFile: string;
  private summaryFile: string;
  private startingCapital: number;

  constructor(startingCapital: number = 100) {
    // Data directory: ~/.openclaw/data/polymarket
    this.dataDir = join(homedir(), ".openclaw", "data", "polymarket");
    this.tradesFile = join(this.dataDir, "trades.jsonl");
    this.summaryFile = join(this.dataDir, "daily-summary.json");
    this.startingCapital = startingCapital;

    // Ensure directory exists
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  /**
   * Log a closed trade
   */
  logTrade(trade: PaperTrade): void {
    if (trade.exitPrice === undefined || !trade.exitTime) {
      console.warn("[Trade Logger] Trade not closed, skipping log");
      return;
    }

    const entry: TradeLogEntry = {
      timestamp: trade.exitTime.toISOString(),
      tradeId: trade.id,
      market: trade.marketQuestion,
      outcome: trade.outcome,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      size: trade.size,
      pnl: trade.pnl || 0,
      roi: trade.pnl && trade.cost ? (trade.pnl / trade.cost) * 100 : 0,
      duration: this.formatDuration(trade.entryTime, trade.exitTime),
      result: this.getTradeResult(trade.pnl || 0),
    };

    // Append to JSONL file
    appendFileSync(this.tradesFile, JSON.stringify(entry) + "\n");

    // Update daily summary
    this.updateDailySummary(entry);
  }

  /**
   * Get today's statistics
   */
  getTodayStats(): DailyStats | null {
    const today = new Date().toISOString().split("T")[0];
    const summary = this.loadDailySummary();
    return summary[today] || null;
  }

  /**
   * Print today's P&L summary
   */
  printTodaySummary(): void {
    const stats = this.getTodayStats();

    if (!stats) {
      console.log("\n📊 Today's Summary: No trades yet");
      return;
    }

    console.log("\n" + "=".repeat(60));
    console.log("📊 TODAY'S TRADING SUMMARY");
    console.log("=".repeat(60));
    console.log(`Date: ${stats.date}`);
    console.log(`Starting Capital: $${stats.startingCapital.toFixed(2)}`);
    console.log(`Ending Capital:   $${stats.endingCapital.toFixed(2)}`);
    console.log(
      `Total P&L:        ${stats.totalPnL >= 0 ? "+" : ""}$${stats.totalPnL.toFixed(2)}`,
    );
    console.log(
      `ROI:              ${stats.totalPnL >= 0 ? "+" : ""}${stats.roi.toFixed(2)}%`,
    );
    console.log();
    console.log(`Total Trades:     ${stats.trades}`);
    console.log(
      `Win Rate:         ${stats.trades > 0 ? ((stats.wins / stats.trades) * 100).toFixed(1) : "0.0"}% (${stats.wins}W / ${stats.losses}L)`,
    );
    console.log();
    console.log(`Largest Win:      +$${stats.largestWin.toFixed(2)}`);
    console.log(`Largest Loss:     $${stats.largestLoss.toFixed(2)}`);
    console.log("=".repeat(60) + "\n");

    // Save location
    console.log(`💾 Trade log: ${this.tradesFile}`);
    console.log(`💾 Daily summary: ${this.summaryFile}\n`);
  }

  /**
   * Get all trades from today
   */
  getTodayTrades(): TradeLogEntry[] {
    if (!existsSync(this.tradesFile)) {
      return [];
    }

    const today = new Date().toISOString().split("T")[0];
    const lines = readFileSync(this.tradesFile, "utf-8")
      .split("\n")
      .filter(Boolean);
    const trades: TradeLogEntry[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as TradeLogEntry;
        if (entry.timestamp.startsWith(today)) {
          trades.push(entry);
        }
      } catch (err) {
        // Skip invalid lines
      }
    }

    return trades;
  }

  /**
   * Load daily summary from file
   */
  private loadDailySummary(): Record<string, DailyStats> {
    if (!existsSync(this.summaryFile)) {
      return {};
    }

    try {
      const content = readFileSync(this.summaryFile, "utf-8");
      return JSON.parse(content);
    } catch (err) {
      return {};
    }
  }

  /**
   * Update daily summary with new trade
   */
  private updateDailySummary(trade: TradeLogEntry): void {
    const summary = this.loadDailySummary();
    const today = new Date().toISOString().split("T")[0];

    if (!summary[today]) {
      // Initialize today's stats
      summary[today] = {
        date: today,
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnL: 0,
        startingCapital: this.startingCapital,
        endingCapital: this.startingCapital,
        roi: 0,
        largestWin: 0,
        largestLoss: 0,
      };
    }

    const stats = summary[today];

    // Update stats
    stats.trades++;
    stats.totalPnL += trade.pnl;
    stats.endingCapital = stats.startingCapital + stats.totalPnL;
    stats.roi = (stats.totalPnL / stats.startingCapital) * 100;

    if (trade.result === "win") {
      stats.wins++;
      stats.largestWin = Math.max(stats.largestWin, trade.pnl);
    } else if (trade.result === "loss") {
      stats.losses++;
      stats.largestLoss = Math.min(stats.largestLoss, trade.pnl);
    }

    // Save updated summary
    writeFileSync(this.summaryFile, JSON.stringify(summary, null, 2));
  }

  /**
   * Format duration between two dates
   */
  private formatDuration(start: Date, end: Date): string {
    const ms = end.getTime() - start.getTime();
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  /**
   * Determine trade result
   */
  private getTradeResult(pnl: number): "win" | "loss" | "breakeven" {
    if (pnl > 0.01) return "win";
    if (pnl < -0.01) return "loss";
    return "breakeven";
  }
}
