import type { HeliusTransaction, NormalizedTrade, TokenAmount } from "./types.js";

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const LAMPORTS_PER_SOL = 1_000_000_000;

const SYMBOLS: Record<string, string> = {
  [SOL_MINT]: "SOL",
  [USDC_MINT]: "USDC",
  [USDT_MINT]: "USDT",
};

/** Quote assets, in order of preference when picking the trade size. */
const QUOTE_MINTS = [SOL_MINT, USDC_MINT, USDT_MINT];

type NetFlows = Map<string, number>;

function add(flows: NetFlows, mint: string, delta: number): void {
  flows.set(mint, (flows.get(mint) ?? 0) + delta);
}

/** Net flows from the parsed swap event, counting only legs that belong to the wallet. */
function flowsFromSwapEvent(tx: HeliusTransaction, wallet: string): NetFlows {
  const flows: NetFlows = new Map();
  const swap = tx.events?.swap;
  if (!swap) return flows;

  if (swap.nativeInput?.account === wallet) {
    add(flows, SOL_MINT, -Number(swap.nativeInput.amount) / LAMPORTS_PER_SOL);
  }
  if (swap.nativeOutput?.account === wallet) {
    add(flows, SOL_MINT, Number(swap.nativeOutput.amount) / LAMPORTS_PER_SOL);
  }
  for (const t of swap.tokenInputs ?? []) {
    if (t.userAccount !== wallet) continue;
    add(flows, t.mint, -Number(t.rawTokenAmount.tokenAmount) / 10 ** t.rawTokenAmount.decimals);
  }
  for (const t of swap.tokenOutputs ?? []) {
    if (t.userAccount !== wallet) continue;
    add(flows, t.mint, Number(t.rawTokenAmount.tokenAmount) / 10 ** t.rawTokenAmount.decimals);
  }
  return flows;
}

/**
 * Net flows from raw transfers. Wrapped SOL is merged into SOL. Native SOL
 * transfers are only used when no wrapped SOL moved, because wrapping shows up
 * as both a native transfer and a WSOL token transfer and would double count.
 */
function flowsFromTransfers(tx: HeliusTransaction, wallet: string): NetFlows {
  const flows: NetFlows = new Map();
  let movedWsol = false;

  for (const t of tx.tokenTransfers ?? []) {
    if (t.fromUserAccount === wallet) add(flows, t.mint, -t.tokenAmount);
    if (t.toUserAccount === wallet) add(flows, t.mint, t.tokenAmount);
    if (t.mint === SOL_MINT && (t.fromUserAccount === wallet || t.toUserAccount === wallet)) {
      movedWsol = true;
    }
  }

  if (!movedWsol) {
    for (const t of tx.nativeTransfers ?? []) {
      if (t.fromUserAccount === wallet) add(flows, SOL_MINT, -t.amount / LAMPORTS_PER_SOL);
      if (t.toUserAccount === wallet) add(flows, SOL_MINT, t.amount / LAMPORTS_PER_SOL);
    }
  }
  return flows;
}

function pickSide(flows: NetFlows, sign: 1 | -1): TokenAmount | undefined {
  const candidates = [...flows.entries()].filter(([, v]) => v * sign > 0);
  if (candidates.length === 0) return undefined;
  // Prefer a quote asset if it is on this side; otherwise the largest absolute amount.
  const quote = candidates.find(([mint]) => QUOTE_MINTS.includes(mint));
  const [mint, value] = quote ?? candidates.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  return { mint, symbol: SYMBOLS[mint], amount: Math.abs(value) };
}

function hasBothSides(flows: NetFlows): boolean {
  const values = [...flows.values()];
  return values.some((v) => v < 0) && values.some((v) => v > 0);
}

/**
 * Turns one enhanced transaction into a trade from `wallet`'s point of view.
 * Returns null for failed transactions or ones where the wallet did not both
 * send and receive a token.
 */
export function normalizeTransaction(tx: HeliusTransaction, wallet: string): NormalizedTrade | null {
  if (tx.transactionError) return null;

  let flows = flowsFromSwapEvent(tx, wallet);
  if (!hasBothSides(flows)) flows = flowsFromTransfers(tx, wallet);
  if (!hasBothSides(flows)) return null;

  const tokenIn = pickSide(flows, -1)!;
  const tokenOut = pickSide(flows, 1)!;
  if (tokenIn.mint === tokenOut.mint) return null;

  const inIsQuote = QUOTE_MINTS.includes(tokenIn.mint);
  const outIsQuote = QUOTE_MINTS.includes(tokenOut.mint);
  const side = inIsQuote && !outIsQuote ? "buy" : outIsQuote && !inIsQuote ? "sell" : "swap";
  const size = inIsQuote ? tokenIn : outIsQuote ? tokenOut : undefined;

  return {
    wallet,
    signature: tx.signature,
    timestamp: new Date(tx.timestamp * 1000).toISOString(),
    source: tx.source ?? "UNKNOWN",
    side,
    tokenIn,
    tokenOut,
    ...(size ? { size } : {}),
  };
}

export function normalizeTransactions(txs: HeliusTransaction[], wallet: string): NormalizedTrade[] {
  return txs
    .map((tx) => normalizeTransaction(tx, wallet))
    .filter((t): t is NormalizedTrade => t !== null);
}
