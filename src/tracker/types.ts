export interface WatchedWallet {
  address: string;
  label?: string;
  addedAt: string;
}

export interface TokenAmount {
  mint: string;
  /** Known ticker for common mints (SOL, USDC, USDT); undefined otherwise. */
  symbol?: string;
  /** Human-readable amount (already divided by decimals). */
  amount: number;
}

/**
 * One swap seen from the tracked wallet's point of view.
 * tokenIn is what the wallet gave up, tokenOut is what it received.
 */
export interface NormalizedTrade {
  wallet: string;
  signature: string;
  timestamp: string;
  /** DEX or aggregator reported by the data API (e.g. JUPITER, RAYDIUM). */
  source: string;
  /** buy = spent SOL/stablecoin for a token, sell = the reverse, swap = token to token. */
  side: "buy" | "sell" | "swap";
  tokenIn: TokenAmount;
  tokenOut: TokenAmount;
  /** Trade size in the quote asset (SOL or stablecoin) when one side is a quote asset. */
  size?: TokenAmount;
}

/** Subset of a Helius enhanced transaction that the normalizer reads. */
export interface HeliusTransaction {
  signature: string;
  timestamp: number;
  type?: string;
  source?: string;
  feePayer?: string;
  transactionError?: unknown;
  nativeTransfers?: Array<{
    fromUserAccount: string | null;
    toUserAccount: string | null;
    amount: number;
  }>;
  tokenTransfers?: Array<{
    fromUserAccount: string | null;
    toUserAccount: string | null;
    mint: string;
    tokenAmount: number;
  }>;
  events?: {
    swap?: HeliusSwapEvent;
  };
}

export interface HeliusSwapEvent {
  nativeInput?: { account: string; amount: string | number } | null;
  nativeOutput?: { account: string; amount: string | number } | null;
  tokenInputs?: HeliusSwapTokenAmount[];
  tokenOutputs?: HeliusSwapTokenAmount[];
}

export interface HeliusSwapTokenAmount {
  userAccount: string;
  mint: string;
  rawTokenAmount: { tokenAmount: string; decimals: number };
}
