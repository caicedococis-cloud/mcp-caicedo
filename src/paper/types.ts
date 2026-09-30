/** A swap observed on-chain from a tracked (leader) wallet. Amounts are in whole units (SOL, tokens). */
export interface WalletTrade {
  /** Transaction signature; used to ignore duplicates. */
  signature: string;
  /** Leader wallet address. */
  wallet: string;
  /** SPL token mint that was bought or sold against SOL. */
  tokenMint: string;
  side: "buy" | "sell";
  /** Tokens the leader received (buy) or sent (sell). */
  tokenAmount: number;
  /** SOL the leader spent (buy) or received (sell). */
  solAmount: number;
  /** Unix epoch milliseconds. */
  timestamp: number;
}

/** How a leader buy is translated into our own buy size. */
export type SizingRule =
  /** Always spend the same SOL amount per copied buy. */
  | { mode: "fixed"; sol: number }
  /** Spend a fraction of what the leader spent (0.1 = 10% of their size). */
  | { mode: "proportional"; ratio: number }
  /** Spend a percentage of our current paper balance (5 = 5%). */
  | { mode: "percentOfBalance"; percent: number };

export interface PaperConfig {
  /** Paper SOL balance the simulation starts with. */
  startingBalanceSol: number;
  sizing: SizingRule;
  /** Hard ceiling for a single copied buy, in SOL. */
  maxPerTradeSol: number;
  /** Total SOL that may be spent on buys per UTC day. */
  dailyCapSol: number;
  /** Buys smaller than this after limits are applied are skipped. */
  minTradeSol: number;
  /** Simulated slippage against the leader's price, in basis points. */
  slippageBps: number;
  /** Flat simulated network + priority fee per fill, in SOL. */
  feeSol: number;
}

export type SkipReason =
  | "duplicate"
  | "invalid_trade"
  | "daily_cap_reached"
  | "below_min_size"
  | "insufficient_balance"
  | "no_position";

export interface Fill {
  id: number;
  sourceSignature: string;
  wallet: string;
  tokenMint: string;
  side: "buy" | "sell";
  tokenAmount: number;
  /** SOL spent (buy, excluding fee) or received (sell, before fee). */
  solAmount: number;
  /** Fill price in SOL per token, slippage included. */
  price: number;
  /** Leader's price in SOL per token. */
  leaderPrice: number;
  feeSol: number;
  /** Realized PnL of this fill in SOL, net of fees. Buys carry -fee. */
  realizedPnlSol: number;
  /** Which limits reduced the requested size, if any. */
  limitedBy: Array<"max_per_trade" | "daily_cap" | "balance">;
  timestamp: number;
}

export interface Skip {
  sourceSignature: string;
  wallet: string;
  tokenMint: string;
  side: "buy" | "sell";
  reason: SkipReason;
  timestamp: number;
}

export type ProcessResult = { status: "filled"; fill: Fill } | { status: "skipped"; skip: Skip };

export interface Position {
  wallet: string;
  tokenMint: string;
  tokenAmount: number;
  /** SOL paid for the tokens still held, fees excluded. */
  costBasisSol: number;
}

export interface PositionView extends Position {
  avgPrice: number;
  lastPrice: number | undefined;
  marketValueSol: number | undefined;
  unrealizedPnlSol: number | undefined;
}

export interface PaperSummary {
  balanceSol: number;
  startingBalanceSol: number;
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  equitySol: number;
  totalPnlSol: number;
  feesPaidSol: number;
  fills: number;
  skips: number;
  closedTrades: number;
  winningTrades: number;
  winRate: number | undefined;
  spentTodaySol: number;
  openPositions: number;
}

export interface PaperSnapshot {
  version: 1;
  config: PaperConfig;
  balanceSol: number;
  fills: Fill[];
  skips: Skip[];
  positions: Position[];
  leaderHoldings: Array<{ wallet: string; tokenMint: string; tokenAmount: number }>;
  lastPrices: Array<{ tokenMint: string; price: number }>;
  dailySpend: Array<{ day: string; sol: number }>;
  seenSignatures: string[];
}
