import { describe, expect, it } from "vitest";
import { eligibilityFlags, rankWallets, scoreWallet } from "../src/discovery/rank.js";
import { computeWalletStats } from "../src/discovery/stats.js";
import { defaultSettings } from "../src/settings.js";
import type { Swap } from "../src/types.js";

let n = 0;
const swap = (side: Swap["side"], mint: string, tokens: number, sol: number, ts: number): Swap => ({
  signature: `s${n++}`,
  wallet: "W",
  timestamp: ts,
  side,
  mint,
  tokenAmount: tokens,
  solAmount: sol,
  source: "JUPITER",
});

describe("computeWalletStats", () => {
  it("calcula PnL realizado con coste medio y tasa de acierto", () => {
    const now = 1_000_000;
    const s = computeWalletStats(
      "W",
      [
        swap("buy", "A", 100, 1, now - 1000),
        swap("buy", "A", 100, 3, now - 900), // coste medio 0.02
        swap("sell", "A", 200, 6, now - 600), // +2
        swap("buy", "B", 50, 2, now - 500),
        swap("sell", "B", 50, 1, now - 100), // -1
        swap("buy", "C", 10, 1, now - 50), // abierta, no cuenta
        swap("sell", "D", 10, 5, now - 40), // sin compra conocida, se ignora
      ],
      now,
    );
    expect(s.closedTrades).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.realizedPnlSol).toBeCloseTo(1);
    expect(s.investedSol).toBeCloseTo(6);
    expect(s.winRate).toBe(0.5);
    expect(s.medianHoldSec).toBe(400); // mediana de 400 y 400
    expect(s.concentration).toBe(1);
    expect(s.recentPnlSol).toBeCloseTo(1);
  });

  it("una venta parcial por debajo del 50 % no cierra la operación", () => {
    const s = computeWalletStats("W", [swap("buy", "A", 100, 1, 1), swap("sell", "A", 40, 2, 2)], 10);
    expect(s.closedTrades).toBe(0);
  });
});

describe("ranking", () => {
  const good = computeWalletStats(
    "GOOD",
    Array.from({ length: 12 }, (_, i) => [
      swap("buy", `T${i}`, 100, 1, 1000 + i * 1000),
      swap("sell", `T${i}`, 100, i % 4 === 0 ? 0.8 : 1.6, 1000 + i * 1000 + 600),
    ]).flat(),
    20_000,
  );
  const lucky = computeWalletStats(
    "LUCKY",
    [swap("buy", "X", 1, 1, 1000), swap("sell", "X", 1, 40, 1100), swap("buy", "Y", 1, 1, 1200), swap("sell", "Y", 1, 0.5, 1300)],
    20_000,
  );

  it("puntúa mejor la constancia que un golpe de suerte con pocas operaciones", () => {
    const cfg = { ...defaultSettings(), maxInactiveDays: 0 };
    const ranked = rankWallets([{ stats: lucky, origin: "t" }, { stats: good, origin: "t" }], cfg, 20_000);
    expect(ranked[0]!.wallet).toBe("GOOD");
    expect(ranked[0]!.eligible).toBe(true);
    expect(ranked[1]!.eligible).toBe(false);
    expect(ranked[1]!.flags.join(" ")).toMatch(/operaciones cerradas/);
  });

  it("no puntúa billeteras con pérdidas", () => {
    const loser = computeWalletStats("L", [swap("buy", "A", 1, 2, 1), swap("sell", "A", 1, 1, 2)], 10);
    expect(scoreWallet(loser)).toBe(0);
  });

  it("marca scalpers e inactivas", () => {
    const cfg = { ...defaultSettings(), minMedianHoldSec: 1000, maxInactiveDays: 1 };
    const flags = eligibilityFlags(good, cfg, good.lastSeen + 3 * 86_400);
    expect(flags.some((f) => f.startsWith("Scalper"))).toBe(true);
    expect(flags.some((f) => f.startsWith("Inactiva"))).toBe(true);
  });
});
