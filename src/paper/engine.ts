import { resolvePaperConfig } from "./config.js";
import type {
  Fill,
  PaperConfig,
  PaperSnapshot,
  PaperSummary,
  Position,
  PositionView,
  ProcessResult,
  Skip,
  SkipReason,
  WalletTrade,
} from "./types.js";

/** Rounds to lamport precision (1e-9 SOL) to keep float noise out of balances. */
const round9 = (n: number) => Math.round(n * 1e9) / 1e9;
const key = (wallet: string, mint: string) => `${wallet}:${mint}`;
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** A leader sell of at least this share of their holdings closes our whole position (avoids dust). */
const FULL_EXIT_THRESHOLD = 0.999;

/**
 * Simulates copying leader wallet trades with paper SOL. Never signs or sends anything:
 * it only turns observed trades into simulated fills, enforcing sizing and risk limits.
 *
 * Positions are tracked per leader wallet and token, so each leader's sells only close
 * what was copied from that leader.
 */
export class PaperTrader {
  readonly config: PaperConfig;
  private balanceSol: number;
  private readonly fills: Fill[] = [];
  private readonly skips: Skip[] = [];
  private readonly positions = new Map<string, Position>();
  /** What each leader holds of each token, as far as we have observed. Used to size sells. */
  private readonly leaderHoldings = new Map<string, number>();
  private readonly lastPrices = new Map<string, number>();
  private readonly dailySpend = new Map<string, number>();
  private readonly seenSignatures = new Set<string>();

  constructor(config: Partial<PaperConfig> = {}) {
    this.config = resolvePaperConfig(config);
    this.balanceSol = this.config.startingBalanceSol;
  }

  /** Processes one leader trade and returns the simulated fill or why it was skipped. */
  process(trade: WalletTrade): ProcessResult {
    if (this.seenSignatures.has(trade.signature)) {
      return this.skip(trade, "duplicate");
    }
    if (!isValidTrade(trade)) {
      return this.skip(trade, "invalid_trade");
    }
    this.seenSignatures.add(trade.signature);

    const leaderPrice = trade.solAmount / trade.tokenAmount;
    this.lastPrices.set(trade.tokenMint, leaderPrice);

    return trade.side === "buy" ? this.copyBuy(trade, leaderPrice) : this.copySell(trade, leaderPrice);
  }

  /** Changes sizing and limits for future trades. Balances and positions are kept. */
  updateConfig(overrides: Partial<Omit<PaperConfig, "startingBalanceSol">>): void {
    Object.assign(this.config, resolvePaperConfig({ ...this.config, ...overrides }));
  }

  /**
   * Closes our whole position in a token copied from `wallet` at `priceSol`, without
   * a leader trade (stop loss, take profit, manual close). Leader holdings are untouched.
   */
  closePosition(wallet: string, tokenMint: string, priceSol: number, atMs: number, reference: string): ProcessResult {
    const k = key(wallet, tokenMint);
    const position = this.positions.get(k);
    const trade: WalletTrade = { signature: reference, wallet, tokenMint, side: "sell", tokenAmount: 0, solAmount: 0, timestamp: atMs };
    if (!position || !(priceSol > 0)) return this.skip(trade, "no_position");
    this.lastPrices.set(tokenMint, priceSol);
    const price = priceSol * (1 - this.config.slippageBps / 10_000);
    const proceeds = round9(position.tokenAmount * price);
    const fee = this.config.feeSol;
    this.balanceSol = round9(this.balanceSol + proceeds - fee);
    this.positions.delete(k);
    return this.fill(trade, {
      side: "sell",
      tokenAmount: position.tokenAmount,
      solAmount: proceeds,
      price,
      leaderPrice: priceSol,
      realizedPnlSol: round9(proceeds - position.costBasisSol - fee),
      limitedBy: [],
    });
  }

  /** Processes trades in timestamp order. */
  processAll(trades: WalletTrade[]): ProcessResult[] {
    return [...trades].sort((a, b) => a.timestamp - b.timestamp).map((t) => this.process(t));
  }

  /** Updates the mark price of a token (e.g. from a price feed) for unrealized PnL. */
  markPrice(tokenMint: string, priceSol: number): void {
    if (Number.isFinite(priceSol) && priceSol > 0) this.lastPrices.set(tokenMint, priceSol);
  }

  getFills(): readonly Fill[] {
    return this.fills;
  }

  getSkips(): readonly Skip[] {
    return this.skips;
  }

  getPositions(): PositionView[] {
    return [...this.positions.values()].map((p) => {
      const lastPrice = this.lastPrices.get(p.tokenMint);
      const marketValueSol = lastPrice === undefined ? undefined : round9(p.tokenAmount * lastPrice);
      return {
        ...p,
        avgPrice: p.costBasisSol / p.tokenAmount,
        lastPrice,
        marketValueSol,
        unrealizedPnlSol: marketValueSol === undefined ? undefined : round9(marketValueSol - p.costBasisSol),
      };
    });
  }

  /** Remaining SOL that may be spent on buys on the UTC day of `atMs`. */
  remainingDailyCapSol(atMs: number): number {
    return round9(Math.max(0, this.config.dailyCapSol - (this.dailySpend.get(utcDay(atMs)) ?? 0)));
  }

  summary(nowMs: number = Date.now()): PaperSummary {
    const positions = this.getPositions();
    // Positions without a known price are valued at cost.
    const unrealizedPnlSol = round9(positions.reduce((sum, p) => sum + (p.unrealizedPnlSol ?? 0), 0));
    const marketValue = positions.reduce((sum, p) => sum + (p.marketValueSol ?? p.costBasisSol), 0);
    const realizedPnlSol = round9(this.fills.reduce((sum, f) => sum + f.realizedPnlSol, 0));
    const feesPaidSol = round9(this.fills.reduce((sum, f) => sum + f.feeSol, 0));
    const sells = this.fills.filter((f) => f.side === "sell");
    const winningTrades = sells.filter((f) => f.realizedPnlSol > 0).length;
    const equitySol = round9(this.balanceSol + marketValue);

    return {
      balanceSol: this.balanceSol,
      startingBalanceSol: this.config.startingBalanceSol,
      realizedPnlSol,
      unrealizedPnlSol,
      equitySol,
      totalPnlSol: round9(equitySol - this.config.startingBalanceSol),
      feesPaidSol,
      fills: this.fills.length,
      skips: this.skips.length,
      closedTrades: sells.length,
      winningTrades,
      winRate: sells.length === 0 ? undefined : winningTrades / sells.length,
      spentTodaySol: round9(this.config.dailyCapSol - this.remainingDailyCapSol(nowMs)),
      openPositions: positions.length,
    };
  }

  toJSON(): PaperSnapshot {
    return {
      version: 1,
      config: this.config,
      balanceSol: this.balanceSol,
      fills: [...this.fills],
      skips: [...this.skips],
      positions: [...this.positions.values()].map((p) => ({ ...p })),
      leaderHoldings: [...this.leaderHoldings].map(([k, tokenAmount]) => {
        const [wallet = "", tokenMint = ""] = k.split(":");
        return { wallet, tokenMint, tokenAmount };
      }),
      lastPrices: [...this.lastPrices].map(([tokenMint, price]) => ({ tokenMint, price })),
      dailySpend: [...this.dailySpend].map(([day, sol]) => ({ day, sol })),
      seenSignatures: [...this.seenSignatures],
    };
  }

  static fromJSON(snapshot: PaperSnapshot): PaperTrader {
    if (snapshot.version !== 1) throw new Error(`Unsupported paper snapshot version ${snapshot.version}`);
    const trader = new PaperTrader(snapshot.config);
    trader.balanceSol = snapshot.balanceSol;
    trader.fills.push(...snapshot.fills);
    trader.skips.push(...snapshot.skips);
    for (const p of snapshot.positions) trader.positions.set(key(p.wallet, p.tokenMint), { ...p });
    for (const h of snapshot.leaderHoldings) trader.leaderHoldings.set(key(h.wallet, h.tokenMint), h.tokenAmount);
    for (const p of snapshot.lastPrices) trader.lastPrices.set(p.tokenMint, p.price);
    for (const d of snapshot.dailySpend) trader.dailySpend.set(d.day, d.sol);
    for (const s of snapshot.seenSignatures) trader.seenSignatures.add(s);
    return trader;
  }

  private copyBuy(trade: WalletTrade, leaderPrice: number): ProcessResult {
    const k = key(trade.wallet, trade.tokenMint);
    this.leaderHoldings.set(k, (this.leaderHoldings.get(k) ?? 0) + trade.tokenAmount);

    const { config } = this;
    const limitedBy: Fill["limitedBy"] = [];
    let size = this.requestedSize(trade);

    if (size > config.maxPerTradeSol) {
      size = config.maxPerTradeSol;
      limitedBy.push("max_per_trade");
    }
    const dailyRemaining = this.remainingDailyCapSol(trade.timestamp);
    if (dailyRemaining <= 0) return this.skip(trade, "daily_cap_reached");
    if (size > dailyRemaining) {
      size = dailyRemaining;
      limitedBy.push("daily_cap");
    }
    const spendable = round9(this.balanceSol - config.feeSol);
    if (size > spendable) {
      size = Math.max(0, spendable);
      limitedBy.push("balance");
    }
    size = round9(size);
    if (size < config.minTradeSol || size <= 0) {
      const last = limitedBy[limitedBy.length - 1];
      const reason: SkipReason =
        last === "balance" ? "insufficient_balance" : last === "daily_cap" ? "daily_cap_reached" : "below_min_size";
      return this.skip(trade, reason);
    }

    const price = leaderPrice * (1 + config.slippageBps / 10_000);
    const tokenAmount = size / price;
    const day = utcDay(trade.timestamp);
    this.dailySpend.set(day, round9((this.dailySpend.get(day) ?? 0) + size));
    this.balanceSol = round9(this.balanceSol - size - config.feeSol);

    const position = this.positions.get(k) ?? {
      wallet: trade.wallet,
      tokenMint: trade.tokenMint,
      tokenAmount: 0,
      costBasisSol: 0,
    };
    position.tokenAmount += tokenAmount;
    position.costBasisSol = round9(position.costBasisSol + size);
    this.positions.set(k, position);

    return this.fill(trade, {
      side: "buy",
      tokenAmount,
      solAmount: size,
      price,
      leaderPrice,
      realizedPnlSol: -config.feeSol,
      limitedBy,
    });
  }

  private copySell(trade: WalletTrade, leaderPrice: number): ProcessResult {
    const k = key(trade.wallet, trade.tokenMint);
    const leaderHeld = this.leaderHoldings.get(k) ?? 0;
    // If we never saw the leader buy, we can't tell what share they sold: treat it as a full exit.
    const fraction = leaderHeld > 0 ? Math.min(1, trade.tokenAmount / leaderHeld) : 1;
    const leaderLeft = leaderHeld - trade.tokenAmount;
    if (leaderLeft > 0) this.leaderHoldings.set(k, leaderLeft);
    else this.leaderHoldings.delete(k);

    const position = this.positions.get(k);
    if (!position) return this.skip(trade, "no_position");

    const fullExit = fraction >= FULL_EXIT_THRESHOLD;
    const tokenAmount = fullExit ? position.tokenAmount : position.tokenAmount * fraction;
    const costSold = fullExit ? position.costBasisSol : round9(position.costBasisSol * fraction);
    const price = leaderPrice * (1 - this.config.slippageBps / 10_000);
    const proceeds = round9(tokenAmount * price);
    const fee = this.config.feeSol;

    this.balanceSol = round9(this.balanceSol + proceeds - fee);
    if (fullExit) {
      this.positions.delete(k);
    } else {
      position.tokenAmount -= tokenAmount;
      position.costBasisSol = round9(position.costBasisSol - costSold);
    }

    return this.fill(trade, {
      side: "sell",
      tokenAmount,
      solAmount: proceeds,
      price,
      leaderPrice,
      realizedPnlSol: round9(proceeds - costSold - fee),
      limitedBy: [],
    });
  }

  private requestedSize(trade: WalletTrade): number {
    const { sizing } = this.config;
    switch (sizing.mode) {
      case "fixed":
        return sizing.sol;
      case "proportional":
        return trade.solAmount * sizing.ratio;
      case "percentOfBalance":
        return (this.balanceSol * sizing.percent) / 100;
    }
  }

  private fill(
    trade: WalletTrade,
    f: Omit<Fill, "id" | "sourceSignature" | "wallet" | "tokenMint" | "feeSol" | "timestamp">,
  ): ProcessResult {
    const fill: Fill = {
      id: this.fills.length + 1,
      sourceSignature: trade.signature,
      wallet: trade.wallet,
      tokenMint: trade.tokenMint,
      feeSol: this.config.feeSol,
      timestamp: trade.timestamp,
      ...f,
    };
    this.fills.push(fill);
    return { status: "filled", fill };
  }

  private skip(trade: WalletTrade, reason: SkipReason): ProcessResult {
    const skip: Skip = {
      sourceSignature: trade.signature,
      wallet: trade.wallet,
      tokenMint: trade.tokenMint,
      side: trade.side,
      reason,
      timestamp: trade.timestamp,
    };
    this.skips.push(skip);
    return { status: "skipped", skip };
  }
}

function isValidTrade(t: WalletTrade): boolean {
  return (
    typeof t.signature === "string" &&
    t.signature.length > 0 &&
    typeof t.wallet === "string" &&
    t.wallet.length > 0 &&
    typeof t.tokenMint === "string" &&
    t.tokenMint.length > 0 &&
    (t.side === "buy" || t.side === "sell") &&
    Number.isFinite(t.tokenAmount) &&
    t.tokenAmount > 0 &&
    Number.isFinite(t.solAmount) &&
    t.solAmount > 0 &&
    Number.isFinite(t.timestamp)
  );
}
