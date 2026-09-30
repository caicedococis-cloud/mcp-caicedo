import { describe, expect, it } from "vitest";
import { tradeToSwap } from "../src/solana/live.js";
import { SOL_MINT, USDC_MINT } from "../src/tracker/normalize.js";
import type { NormalizedTrade } from "../src/tracker/types.js";

const base = { wallet: "W", signature: "s", timestamp: "2026-09-21T14:18:20.000Z", source: "JUPITER" };

describe("tradeToSwap", () => {
  it("convierte una compra contra SOL", () => {
    const t: NormalizedTrade = {
      ...base,
      side: "buy",
      tokenIn: { mint: SOL_MINT, symbol: "SOL", amount: 1.5 },
      tokenOut: { mint: "BONK", amount: 1000 },
      size: { mint: SOL_MINT, symbol: "SOL", amount: 1.5 },
    };
    expect(tradeToSwap(t)).toMatchObject({ side: "buy", mint: "BONK", tokenAmount: 1000, solAmount: 1.5, timestamp: 1790000300 });
  });

  it("ignora ventas contra stablecoins y swaps token-token", () => {
    const usdc: NormalizedTrade = {
      ...base,
      side: "sell",
      tokenIn: { mint: "WIF", amount: 1 },
      tokenOut: { mint: USDC_MINT, amount: 2 },
      size: { mint: USDC_MINT, amount: 2 },
    };
    expect(tradeToSwap(usdc)).toBeNull();
    expect(tradeToSwap({ ...usdc, side: "swap", size: undefined })).toBeNull();
  });
});
