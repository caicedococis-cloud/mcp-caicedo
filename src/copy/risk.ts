import type { SizingRule } from "../paper/types.js";
import { PRESETS, type Settings } from "../settings.js";
import type { Swap, TokenQuote } from "../types.js";

export interface EntryContext {
  settings: Settings;
  swap: Swap;
  nowSec: number;
  /** El líder está entre las billeteras que se copian. */
  leaderCopied: boolean;
  openPositions: number;
  /** Ya hay una posición en este token (de cualquier líder). */
  holdingMint: boolean;
  /** Pérdida realizada del día en SOL (positiva = pérdida). */
  lossTodaySol: number;
  quote?: TokenQuote;
}

/** Launchpads cuyo swap indica que el token sigue en bonding curve. */
const BONDING_CURVE_SOURCES = new Set(["PUMP_FUN", "MOONSHOT", "BOOP", "LAUNCHLAB"]);

/** Motivo por el que NO se copia una compra, o null si pasa todos los filtros. */
export function entryBlocker(c: EntryContext): string | null {
  const s = c.settings;
  if (s.paused) return "Bot en pausa";
  if (!c.leaderCopied) return "La billetera ya no está entre las copiadas";
  if (c.lossTodaySol >= s.maxDailyLossSol) return `Límite de pérdida diaria alcanzado (${c.lossTodaySol.toFixed(2)} SOL)`;
  if (c.openPositions >= s.maxOpenPositions) return `Máximo de ${s.maxOpenPositions} posiciones abiertas`;
  if (c.holdingMint) return "Ya hay una posición abierta en este token";
  const age = c.nowSec - c.swap.timestamp;
  if (age > s.maxSignalAgeSec) return `Señal detectada tarde (${Math.round(age)} s)`;
  if (s.skipBondingCurve && BONDING_CURVE_SOURCES.has(c.swap.source)) return `Token en bonding curve (${c.swap.source})`;
  if (s.minLiquidityUsd > 0) {
    if (c.quote?.liquidityUsd === undefined) return "Liquidez desconocida";
    if (c.quote.liquidityUsd < s.minLiquidityUsd)
      return `Liquidez ${Math.round(c.quote.liquidityUsd).toLocaleString("es")} USD < ${s.minLiquidityUsd.toLocaleString("es")}`;
  }
  return null;
}

export interface ExitCheck {
  entryPrice: number;
  price: number;
  peakPrice: number;
  openedAtSec: number;
  nowSec: number;
}

/** Motivo para cerrar una posición abierta (stop loss, take profit...), o null. */
export function exitReason(s: Settings, p: ExitCheck): string | null {
  if (!(p.entryPrice > 0) || !(p.price > 0)) return null;
  const change = (p.price / p.entryPrice - 1) * 100;
  if (s.stopLossPct > 0 && change <= -s.stopLossPct) return `Stop loss (${change.toFixed(1)} %)`;
  if (s.takeProfitPct > 0 && change >= s.takeProfitPct) return `Take profit (+${change.toFixed(1)} %)`;
  if (s.trailingStopPct > 0 && p.price > p.entryPrice && p.price <= p.peakPrice * (1 - s.trailingStopPct / 100))
    return `Trailing stop (−${((1 - p.price / p.peakPrice) * 100).toFixed(1)} % desde el máximo)`;
  if (s.maxHoldMinutes > 0 && p.nowSec - p.openedAtSec >= s.maxHoldMinutes * 60) return `Tiempo máximo en posición (${s.maxHoldMinutes} min)`;
  return null;
}

/** Traduce la estrategia al formato de tamaño del simulador de papel. */
export function sizingRule(s: Settings): SizingRule {
  switch (s.sizeMode) {
    case "fixed":
      return { mode: "fixed", sol: s.tradeSizeSol };
    case "percentOfLeader":
      return { mode: "proportional", ratio: s.sizePercent / 100 };
    case "percentOfCapital":
      return { mode: "percentOfBalance", percent: s.sizePercent };
  }
}

/**
 * Piloto automático: si la pérdida del día supera la mitad del límite, opera con
 * los valores de riesgo del perfil Conservador hasta el día siguiente.
 */
export function effectiveSettings(s: Settings, lossTodaySol: number): { settings: Settings; defensive: boolean } {
  if (!s.autoPilot || lossTodaySol < s.maxDailyLossSol / 2 || s.preset === "conservador") return { settings: s, defensive: false };
  const c = PRESETS.conservador;
  return {
    defensive: true,
    settings: {
      ...s,
      sizeMode: c.sizeMode,
      sizePercent: Math.min(s.sizePercent, c.sizePercent),
      tradeSizeSol: Math.min(s.tradeSizeSol, c.tradeSizeSol),
      maxBuySol: Math.min(s.maxBuySol, c.maxBuySol),
      maxOpenPositions: Math.min(s.maxOpenPositions, c.maxOpenPositions),
      stopLossPct: s.stopLossPct > 0 ? Math.min(s.stopLossPct, c.stopLossPct) : c.stopLossPct,
      aiGate: true,
      skipBondingCurve: true,
      minLiquidityUsd: Math.max(s.minLiquidityUsd, c.minLiquidityUsd),
    },
  };
}
