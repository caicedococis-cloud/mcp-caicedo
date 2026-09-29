import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PaperTrader, loadPaperState, resolvePaperConfig, savePaperState } from "../src/paper/index.js";
import type { PaperConfig, WalletTrade } from "../src/paper/index.js";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 29, 12, 0, 0);
const LEADER = "Leader1111111111111111111111111111111111111";
const OTHER = "Leader2222222222222222222222222222222222222";
const MINT = "Mint111111111111111111111111111111111111111";

let seq = 0;
function trade(partial: Partial<WalletTrade>): WalletTrade {
  seq += 1;
  return {
    signature: `sig${seq}`,
    wallet: LEADER,
    tokenMint: MINT,
    side: "buy",
    tokenAmount: 1_000,
    solAmount: 1,
    timestamp: T0 + seq,
    ...partial,
  };
}

/** No slippage and no fees, so the math in assertions stays readable. */
function frictionless(overrides: Partial<PaperConfig> = {}): PaperTrader {
  return new PaperTrader({
    startingBalanceSol: 10,
    sizing: { mode: "fixed", sol: 0.1 },
    maxPerTradeSol: 1,
    dailyCapSol: 5,
    minTradeSol: 0.01,
    slippageBps: 0,
    feeSol: 0,
    ...overrides,
  });
}

describe("sizing", () => {
  it("fixed mode spends the configured SOL regardless of leader size", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 0.2 } });
    const r = t.process(trade({ solAmount: 50, tokenAmount: 50_000 }));
    expect(r.status).toBe("filled");
    if (r.status !== "filled") return;
    expect(r.fill.solAmount).toBe(0.2);
    expect(r.fill.tokenAmount).toBeCloseTo(200);
    expect(t.summary(T0).balanceSol).toBeCloseTo(9.8);
  });

  it("proportional mode scales the leader's SOL amount", () => {
    const t = frictionless({ sizing: { mode: "proportional", ratio: 0.1 } });
    const r = t.process(trade({ solAmount: 3, tokenAmount: 3_000 }));
    expect(r.status === "filled" && r.fill.solAmount).toBeCloseTo(0.3);
  });

  it("percentOfBalance mode uses the current paper balance", () => {
    const t = frictionless({ sizing: { mode: "percentOfBalance", percent: 5 } });
    const first = t.process(trade({}));
    const second = t.process(trade({}));
    expect(first.status === "filled" && first.fill.solAmount).toBeCloseTo(0.5);
    expect(second.status === "filled" && second.fill.solAmount).toBeCloseTo(0.475);
  });
});

describe("risk limits", () => {
  it("caps a single buy at maxPerTradeSol", () => {
    const t = frictionless({ sizing: { mode: "proportional", ratio: 1 }, maxPerTradeSol: 0.5 });
    const r = t.process(trade({ solAmount: 20, tokenAmount: 20_000 }));
    expect(r.status).toBe("filled");
    if (r.status !== "filled") return;
    expect(r.fill.solAmount).toBe(0.5);
    expect(r.fill.limitedBy).toEqual(["max_per_trade"]);
  });

  it("clips to what is left of the daily cap, then skips once it is used up", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 0.4 }, dailyCapSol: 1 });
    const results = [t.process(trade({})), t.process(trade({})), t.process(trade({})), t.process(trade({}))];
    const sizes = results.map((r) => (r.status === "filled" ? r.fill.solAmount : r.skip.reason));
    expect(sizes).toEqual([0.4, 0.4, 0.2, "daily_cap_reached"]);
    expect(results[2]?.status === "filled" && results[2].fill.limitedBy).toEqual(["daily_cap"]);
    expect(t.remainingDailyCapSol(T0)).toBe(0);
  });

  it("resets the daily cap on the next UTC day", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 }, dailyCapSol: 1 });
    expect(t.process(trade({})).status).toBe("filled");
    expect(t.process(trade({})).status).toBe("skipped");
    expect(t.process(trade({ timestamp: T0 + DAY })).status).toBe("filled");
  });

  it("does not count sells against the daily cap", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 }, dailyCapSol: 1 });
    t.process(trade({}));
    t.process(trade({ side: "sell" }));
    expect(t.remainingDailyCapSol(T0)).toBe(0);
  });

  it("skips a clipped buy that falls below minTradeSol", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 0.995 }, dailyCapSol: 1, minTradeSol: 0.01 });
    t.process(trade({}));
    const r = t.process(trade({}));
    expect(r.status === "skipped" && r.skip.reason).toBe("daily_cap_reached");
  });

  it("never spends more than the paper balance", () => {
    const t = frictionless({ startingBalanceSol: 0.15, sizing: { mode: "fixed", sol: 0.1 }, feeSol: 0.001 });
    const first = t.process(trade({}));
    const second = t.process(trade({}));
    const third = t.process(trade({}));
    expect(first.status === "filled" && first.fill.solAmount).toBe(0.1);
    expect(second.status === "filled" && second.fill.solAmount).toBeCloseTo(0.048);
    expect(second.status === "filled" && second.fill.limitedBy).toEqual(["balance"]);
    expect(third.status === "skipped" && third.skip.reason).toBe("insufficient_balance");
    expect(t.summary(T0).balanceSol).toBeGreaterThanOrEqual(0);
  });
});

describe("sells and PnL", () => {
  it("realizes profit when the leader exits at a higher price", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 } });
    t.process(trade({ tokenAmount: 1_000, solAmount: 1 })); // 0.001 SOL/token, we get 1000 tokens
    const r = t.process(trade({ side: "sell", tokenAmount: 1_000, solAmount: 2 })); // price doubles
    expect(r.status).toBe("filled");
    if (r.status !== "filled") return;
    expect(r.fill.solAmount).toBeCloseTo(2);
    expect(r.fill.realizedPnlSol).toBeCloseTo(1);
    const s = t.summary(T0);
    expect(s.realizedPnlSol).toBeCloseTo(1);
    expect(s.balanceSol).toBeCloseTo(11);
    expect(s.openPositions).toBe(0);
    expect(s.winRate).toBe(1);
  });

  it("mirrors a partial exit as the same share of our position", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 } });
    t.process(trade({ tokenAmount: 4_000, solAmount: 4 }));
    const r = t.process(trade({ side: "sell", tokenAmount: 1_000, solAmount: 0.5 })); // leader sells 25% at half price
    expect(r.status === "filled" && r.fill.tokenAmount).toBeCloseTo(250);
    expect(r.status === "filled" && r.fill.realizedPnlSol).toBeCloseTo(-0.125);
    const [pos] = t.getPositions();
    expect(pos?.tokenAmount).toBeCloseTo(750);
    expect(pos?.costBasisSol).toBeCloseTo(0.75);
  });

  it("closes the whole position when the leader sells everything it was seen buying", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 } });
    t.process(trade({ tokenAmount: 1_000, solAmount: 1 }));
    t.process(trade({ tokenAmount: 1_000, solAmount: 1 }));
    t.process(trade({ side: "sell", tokenAmount: 1_500, solAmount: 1.5 }));
    t.process(trade({ side: "sell", tokenAmount: 500, solAmount: 0.5 }));
    expect(t.getPositions()).toHaveLength(0);
    expect(t.summary(T0).balanceSol).toBeCloseTo(10);
  });

  it("keeps positions separate per leader wallet", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 } });
    t.process(trade({ wallet: LEADER }));
    t.process(trade({ wallet: OTHER }));
    t.process(trade({ wallet: OTHER, side: "sell" }));
    const positions = t.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]?.wallet).toBe(LEADER);
  });

  it("skips a sell when nothing was copied from that leader", () => {
    const t = frictionless();
    const r = t.process(trade({ side: "sell" }));
    expect(r.status === "skipped" && r.skip.reason).toBe("no_position");
  });

  it("still tracks leader holdings when our buy was skipped, so later sells size correctly", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 }, dailyCapSol: 1 });
    t.process(trade({ tokenAmount: 1_000, timestamp: T0 })); // copied
    t.process(trade({ tokenAmount: 1_000, timestamp: T0 + 1 })); // skipped: cap
    t.process(trade({ side: "sell", tokenAmount: 1_000, timestamp: T0 + 2 })); // leader sold half
    expect(t.getPositions()[0]?.tokenAmount).toBeCloseTo(500);
  });

  it("applies slippage against us on both sides and charges fees", () => {
    const t = new PaperTrader({
      startingBalanceSol: 10,
      sizing: { mode: "fixed", sol: 1 },
      maxPerTradeSol: 1,
      dailyCapSol: 5,
      minTradeSol: 0.01,
      slippageBps: 100,
      feeSol: 0.001,
    });
    const buy = t.process(trade({ tokenAmount: 1_000, solAmount: 1 }));
    const sell = t.process(trade({ side: "sell", tokenAmount: 1_000, solAmount: 1 }));
    expect(buy.status === "filled" && buy.fill.price).toBeCloseTo(0.00101);
    expect(sell.status === "filled" && sell.fill.price).toBeCloseTo(0.00099);
    const s = t.summary(T0);
    // Flat price round trip loses ~2% to slippage plus two fees.
    expect(s.realizedPnlSol).toBeCloseTo(1 * (0.99 / 1.01) - 1 - 0.002, 6);
    expect(s.feesPaidSol).toBeCloseTo(0.002);
    expect(s.totalPnlSol).toBeCloseTo(s.realizedPnlSol, 6);
  });

  it("reports unrealized PnL from the latest observed or marked price", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 } });
    t.process(trade({ tokenAmount: 1_000, solAmount: 1 }));
    t.markPrice(MINT, 0.003);
    const s = t.summary(T0);
    expect(s.unrealizedPnlSol).toBeCloseTo(2);
    expect(s.equitySol).toBeCloseTo(12);
    expect(s.totalPnlSol).toBeCloseTo(2);
  });
});

describe("input handling", () => {
  it("ignores duplicate signatures", () => {
    const t = frictionless();
    const tr = trade({});
    t.process(tr);
    const r = t.process(tr);
    expect(r.status === "skipped" && r.skip.reason).toBe("duplicate");
    expect(t.getFills()).toHaveLength(1);
  });

  it("rejects malformed trades", () => {
    const t = frictionless();
    const r = t.process(trade({ tokenAmount: 0 }));
    expect(r.status === "skipped" && r.skip.reason).toBe("invalid_trade");
  });

  it("processAll handles trades in timestamp order", () => {
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 } });
    const buy = trade({ timestamp: T0 });
    const sell = trade({ side: "sell", timestamp: T0 + 10 });
    const results = t.processAll([sell, buy]);
    expect(results.map((r) => r.status)).toEqual(["filled", "filled"]);
    expect(t.getFills().map((f) => f.side)).toEqual(["buy", "sell"]);
  });
});

describe("config", () => {
  it("rejects invalid limits", () => {
    expect(() => resolvePaperConfig({ dailyCapSol: 0 })).toThrow(/dailyCapSol/);
    expect(() => resolvePaperConfig({ sizing: { mode: "percentOfBalance", percent: 150 } })).toThrow(/percent/);
    expect(() => resolvePaperConfig({ minTradeSol: 2, maxPerTradeSol: 1 })).toThrow(/minTradeSol/);
  });
});

describe("persistence", () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("round-trips state through a JSON file, keeping limits and dedupe", async () => {
    dir = await mkdtemp(join(tmpdir(), "paper-"));
    const path = join(dir, "nested", "paper.json");
    const t = frictionless({ sizing: { mode: "fixed", sol: 1 }, dailyCapSol: 1 });
    const first = trade({});
    t.process(first);
    await savePaperState(t, path);

    const restored = await loadPaperState(path);
    expect(restored.summary(T0)).toEqual(t.summary(T0));
    expect(restored.process(first).status).toBe("skipped");
    const next = restored.process(trade({}));
    expect(next.status === "skipped" && next.skip.reason).toBe("daily_cap_reached");
    expect(restored.getFills()).toHaveLength(1);
  });

  it("starts fresh when no state file exists", async () => {
    dir = await mkdtemp(join(tmpdir(), "paper-"));
    const t = await loadPaperState(join(dir, "missing.json"), { startingBalanceSol: 3 });
    expect(t.summary(T0).balanceSol).toBe(3);
  });
});
