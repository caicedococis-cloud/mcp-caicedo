import { describe, expect, it } from "vitest";
import fixture from "./fixtures/helius-swaps.json" with { type: "json" };
import { normalizeTransaction, normalizeTransactions, SOL_MINT, USDC_MINT } from "../src/tracker/normalize.js";
import type { HeliusTransaction } from "../src/tracker/types.js";

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const WIF = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
const txs = fixture as unknown as HeliusTransaction[];

describe("normalizeTransaction", () => {
  it("reads a buy from the parsed swap event", () => {
    expect(normalizeTransaction(txs[0], WALLET)).toEqual({
      wallet: WALLET,
      signature: txs[0].signature,
      timestamp: "2026-09-21T14:18:20.000Z",
      source: "JUPITER",
      side: "buy",
      tokenIn: { mint: SOL_MINT, symbol: "SOL", amount: 1.5 },
      tokenOut: { mint: BONK, symbol: undefined, amount: 12345678.5 },
      size: { mint: SOL_MINT, symbol: "SOL", amount: 1.5 },
    });
  });

  it("falls back to transfers and treats WSOL as SOL without double counting the wrap", () => {
    const trade = normalizeTransaction(txs[1], WALLET)!;
    expect(trade.side).toBe("sell");
    expect(trade.tokenIn).toEqual({ mint: BONK, symbol: undefined, amount: 5000000 });
    expect(trade.tokenOut).toEqual({ mint: SOL_MINT, symbol: "SOL", amount: 0.62 });
    expect(trade.size?.amount).toBe(0.62);
  });

  it("ignores failed transactions", () => {
    expect(normalizeTransaction(txs[2], WALLET)).toBeNull();
  });

  it("reads a stablecoin sell", () => {
    const trade = normalizeTransaction(txs[3], WALLET)!;
    expect(trade.side).toBe("sell");
    expect(trade.tokenIn).toMatchObject({ mint: WIF, amount: 250 });
    expect(trade.tokenOut).toEqual({ mint: USDC_MINT, symbol: "USDC", amount: 512.34 });
  });

  it("skips transactions where the wallet only received", () => {
    expect(normalizeTransaction(txs[4], WALLET)).toBeNull();
  });

  it("ignores swap legs that belong to another wallet", () => {
    expect(normalizeTransaction(txs[0], "Other111111111111111111111111111111111111111")).toBeNull();
  });

  it("labels token-to-token swaps as swap with no quote size", () => {
    const tx: HeliusTransaction = {
      signature: "x",
      timestamp: 1790000000,
      tokenTransfers: [
        { fromUserAccount: WALLET, toUserAccount: "p", mint: BONK, tokenAmount: 100 },
        { fromUserAccount: "p", toUserAccount: WALLET, mint: WIF, tokenAmount: 2 },
      ],
    };
    const trade = normalizeTransaction(tx, WALLET)!;
    expect(trade.side).toBe("swap");
    expect(trade.size).toBeUndefined();
    expect(trade.source).toBe("UNKNOWN");
  });

  it("keeps only real trades from a batch", () => {
    expect(normalizeTransactions(txs, WALLET).map((t) => t.signature)).toEqual([
      txs[0].signature,
      txs[1].signature,
      txs[3].signature,
    ]);
  });
});
