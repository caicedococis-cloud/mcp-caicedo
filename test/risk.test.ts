import { describe, expect, it } from "vitest";
import { effectiveSettings, entryBlocker, exitReason, sizingRule, type EntryContext } from "../src/copy/risk.js";
import { defaultSettings } from "../src/settings.js";

const ctx = (over: Partial<EntryContext> = {}): EntryContext => ({
  settings: { ...defaultSettings(), minLiquidityUsd: 10_000 },
  swap: { signature: "s", wallet: "L", timestamp: 1000, side: "buy", mint: "M", tokenAmount: 1, solAmount: 1, source: "JUPITER" },
  nowSec: 1010,
  leaderCopied: true,
  openPositions: 0,
  holdingMint: false,
  lossTodaySol: 0,
  quote: { priceSol: 1, liquidityUsd: 50_000 },
  ...over,
});

describe("entryBlocker", () => {
  it("deja pasar una señal limpia", () => {
    expect(entryBlocker(ctx())).toBeNull();
  });

  it.each([
    [{ settings: { ...defaultSettings(), paused: true } }, /pausa/],
    [{ leaderCopied: false }, /copiadas/],
    [{ lossTodaySol: 5 }, /pérdida diaria/],
    [{ openPositions: 99 }, /posiciones abiertas/],
    [{ holdingMint: true }, /Ya hay/],
    [{ nowSec: 5000 }, /tarde/],
    [{ quote: { priceSol: 1, liquidityUsd: 100 } }, /Liquidez/],
    [{ quote: undefined }, /desconocida/],
  ] as [Partial<EntryContext>, RegExp][])("bloquea %#", (over, re) => {
    expect(entryBlocker(ctx(over))).toMatch(re);
  });

  it("evita tokens en bonding curve si está activado", () => {
    const c = ctx();
    c.swap.source = "PUMP_FUN";
    expect(entryBlocker(c)).toMatch(/bonding/);
    expect(entryBlocker({ ...c, settings: { ...c.settings, skipBondingCurve: false } })).toBeNull();
  });
});

describe("exitReason", () => {
  const s = { ...defaultSettings(), stopLossPct: 30, takeProfitPct: 100, trailingStopPct: 20, maxHoldMinutes: 60 };
  const p = { entryPrice: 1, price: 1, peakPrice: 1, openedAtSec: 0, nowSec: 60 };
  it("dispara stop loss, take profit, trailing y tiempo máximo", () => {
    expect(exitReason(s, { ...p, price: 0.6 })).toMatch(/Stop loss/);
    expect(exitReason(s, { ...p, price: 2.1, peakPrice: 2.1 })).toMatch(/Take profit/);
    expect(exitReason(s, { ...p, price: 1.5, peakPrice: 1.9 })).toMatch(/Trailing/);
    expect(exitReason(s, { ...p, nowSec: 3600 })).toMatch(/Tiempo/);
    expect(exitReason(s, { ...p, price: 1.1, peakPrice: 1.2 })).toBeNull();
  });
});

describe("sizing y piloto automático", () => {
  it("traduce el modo de tamaño", () => {
    expect(sizingRule({ ...defaultSettings(), sizeMode: "percentOfLeader", sizePercent: 10 })).toEqual({ mode: "proportional", ratio: 0.1 });
  });

  it("pasa a modo defensivo al perder la mitad del límite diario", () => {
    const s = { ...defaultSettings(), preset: "agresivo" as const, maxDailyLossSol: 2, maxOpenPositions: 15 };
    expect(effectiveSettings(s, 0.5).defensive).toBe(false);
    const d = effectiveSettings(s, 1);
    expect(d.defensive).toBe(true);
    expect(d.settings.aiGate).toBe(true);
    expect(d.settings.maxOpenPositions).toBe(4);
    expect(effectiveSettings({ ...s, autoPilot: false }, 1).defensive).toBe(false);
  });
});
