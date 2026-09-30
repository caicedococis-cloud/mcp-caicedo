/** Un swap normalizado de una billetera: compra o venta de un token contra SOL. */
export interface Swap {
  signature: string;
  wallet: string;
  /** Segundos Unix. */
  timestamp: number;
  side: "buy" | "sell";
  mint: string;
  /** Cantidad de tokens (ya ajustada por decimales). */
  tokenAmount: number;
  /** SOL gastado (compra) o recibido (venta). */
  solAmount: number;
  /** DEX o launchpad que reportó el swap (JUPITER, RAYDIUM, PUMP_FUN...). */
  source: string;
  symbol?: string;
}

/** Estadísticas de rentabilidad de una billetera calculadas a partir de sus swaps. */
export interface WalletStats {
  wallet: string;
  swaps: number;
  /** Tokens distintos operados. */
  tokens: number;
  /** Tokens en los que vendió al menos la mitad de lo comprado. */
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnlSol: number;
  /** SOL invertido en las posiciones cerradas. */
  investedSol: number;
  /** realizedPnlSol / investedSol. */
  roi: number;
  /** Ganancia realizada de los últimos 7 días del historial. */
  recentPnlSol: number;
  /** Mediana de segundos entre la primera compra y la primera venta. */
  medianHoldSec: number;
  /** Parte (0-1) de la ganancia bruta que viene de las 2 mejores operaciones. */
  concentration: number;
  firstSeen: number;
  lastSeen: number;
}

export interface RankedWallet extends WalletStats {
  /** Puntuación compuesta usada para ordenar (mayor es mejor). */
  score: number;
  /** Cumple todos los filtros de selección. */
  eligible: boolean;
  /** Motivos por los que no cumple, o avisos. */
  flags: string[];
  /** Origen de la candidata: semilla, birdeye, demo o manual. */
  origin: string;
}

/** Veredicto de la IA sobre una entrada o salida de un trader. */
export interface TradeAnalysis {
  signature: string;
  verdict: "copy" | "skip" | "caution";
  /** 0 a 1. */
  confidence: number;
  summary: string;
  reasons: string[];
  risks: string[];
  /** "ai" si lo generó el modelo, "heuristic" si no había clave o falló. */
  engine: "ai" | "heuristic";
  model?: string;
  createdAt: number;
}

export interface PaperPosition {
  mint: string;
  symbol?: string;
  leader: string;
  tokenAmount: number;
  costSol: number;
  entryPrice: number;
  openedAt: number;
  /** Último precio conocido en SOL por token. */
  lastPrice: number;
  /** Máximo precio visto desde la entrada (para el trailing stop). */
  peakPrice: number;
}

export interface PaperTrade {
  id: string;
  timestamp: number;
  side: "buy" | "sell";
  mint: string;
  symbol?: string;
  leader: string;
  leaderSignature?: string;
  tokenAmount: number;
  solAmount: number;
  price: number;
  /** PnL realizado de esta venta (0 en compras). */
  pnlSol: number;
  reason: string;
}

/** Lo que el bot hizo con una operación de un líder. */
export interface Signal {
  swap: Swap;
  detectedAt: number;
  action: "copied" | "skipped" | "pending";
  reason: string;
  analysis?: TradeAnalysis;
}

export interface TokenQuote {
  /** Precio en SOL por token. */
  priceSol: number;
  priceUsd?: number;
  liquidityUsd?: number;
}
