import type { Swap, WalletStats } from "../types.js";

interface MintBook {
  boughtTokens: number;
  boughtSol: number;
  soldTokens: number;
  soldSol: number;
  /** Coste de los tokens vendidos (a coste medio). */
  costOfSold: number;
  firstBuy?: number;
  firstSell?: number;
  lastSellTs?: number;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * Calcula la rentabilidad realizada de una billetera con coste medio por token.
 * Las ventas de tokens comprados antes del historial disponible se ignoran,
 * porque su coste es desconocido.
 */
export function computeWalletStats(wallet: string, swaps: Swap[], now = Date.now() / 1000): WalletStats {
  const sorted = [...swaps].sort((a, b) => a.timestamp - b.timestamp);
  const books = new Map<string, MintBook>();
  const recentCutoff = now - 7 * 86_400;
  let recentPnlSol = 0;

  for (const s of sorted) {
    let b = books.get(s.mint);
    if (!b) {
      b = { boughtTokens: 0, boughtSol: 0, soldTokens: 0, soldSol: 0, costOfSold: 0 };
      books.set(s.mint, b);
    }
    if (s.side === "buy") {
      b.boughtTokens += s.tokenAmount;
      b.boughtSol += s.solAmount;
      b.firstBuy ??= s.timestamp;
    } else {
      const held = b.boughtTokens - b.soldTokens;
      if (held <= 0) continue;
      const qty = Math.min(s.tokenAmount, held);
      const avgCost = b.boughtSol / b.boughtTokens;
      const proceeds = s.solAmount * (qty / s.tokenAmount);
      b.soldTokens += qty;
      b.soldSol += proceeds;
      b.costOfSold += qty * avgCost;
      b.firstSell ??= s.timestamp;
      b.lastSellTs = s.timestamp;
      if (s.timestamp >= recentCutoff) recentPnlSol += proceeds - qty * avgCost;
    }
  }

  let wins = 0;
  let losses = 0;
  let realized = 0;
  let invested = 0;
  const pnls: number[] = [];
  const holds: number[] = [];
  for (const b of books.values()) {
    if (b.boughtTokens === 0 || b.soldTokens < b.boughtTokens * 0.5) continue;
    const pnl = b.soldSol - b.costOfSold;
    realized += pnl;
    invested += b.costOfSold;
    pnls.push(pnl);
    if (pnl > 0) wins++;
    else losses++;
    if (b.firstBuy !== undefined && b.firstSell !== undefined) holds.push(b.firstSell - b.firstBuy);
  }

  const closed = wins + losses;
  const grossProfit = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const top2 = pnls
    .filter((p) => p > 0)
    .sort((a, b) => b - a)
    .slice(0, 2)
    .reduce((a, b) => a + b, 0);

  return {
    wallet,
    swaps: swaps.length,
    tokens: books.size,
    closedTrades: closed,
    wins,
    losses,
    winRate: closed ? wins / closed : 0,
    realizedPnlSol: realized,
    investedSol: invested,
    roi: invested > 0 ? realized / invested : 0,
    recentPnlSol,
    medianHoldSec: median(holds),
    concentration: grossProfit > 0 ? top2 / grossProfit : 1,
    firstSeen: sorted[0]?.timestamp ?? 0,
    lastSeen: sorted[sorted.length - 1]?.timestamp ?? 0,
  };
}
