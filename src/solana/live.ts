import type { Config } from "../config.js";
import { HeliusClient } from "../tracker/helius.js";
import { normalizeTransactions, SOL_MINT } from "../tracker/normalize.js";
import type { NormalizedTrade } from "../tracker/types.js";
import type { Swap, TokenQuote } from "../types.js";
import { getJson, type MarketData } from "./market.js";

/** Convierte un trade del tracker en compra o venta contra SOL; ignora los que no son contra SOL. */
export function tradeToSwap(t: NormalizedTrade): Swap | null {
  if (t.side === "swap" || t.size?.mint !== SOL_MINT) return null;
  const token = t.side === "buy" ? t.tokenOut : t.tokenIn;
  return {
    signature: t.signature,
    wallet: t.wallet,
    timestamp: Math.floor(Date.parse(t.timestamp) / 1000),
    side: t.side,
    mint: token.mint,
    tokenAmount: token.amount,
    solAmount: t.size.amount,
    source: t.source,
    symbol: token.symbol,
  };
}

/**
 * Datos reales de Solana:
 * - Helius Enhanced Transactions (vía el tracker): historial de swaps por billetera.
 * - Birdeye /trader/gainers-losers: ranking de billeteras por PnL (candidatas).
 * - Jupiter Price API v3: precio en USD y liquidez de cada token.
 */
export class LiveMarket implements MarketData {
  readonly name = "Solana mainnet (Helius + Birdeye + Jupiter)";
  private readonly helius: HeliusClient;

  constructor(private readonly config: Config) {
    this.helius = new HeliusClient(config.heliusApiKey ?? "", fetch, config.heliusApiBase);
  }

  async fetchSwaps(wallet: string, opts: { limit?: number; pages?: number; untilSignature?: string } = {}): Promise<Swap[]> {
    const limit = Math.min(opts.limit ?? 100, 100);
    const out: Swap[] = [];
    let before: string | undefined;
    for (let page = 0; page < (opts.pages ?? 1); page++) {
      const txs = await this.helius.getSwapTransactions(wallet, { limit, before });
      if (txs.length === 0) break;
      const stop = txs.findIndex((tx) => tx.signature === opts.untilSignature);
      for (const t of normalizeTransactions(stop >= 0 ? txs.slice(0, stop) : txs, wallet)) {
        const swap = tradeToSwap(t);
        if (swap) out.push(swap);
      }
      if (stop >= 0 || txs.length < limit) break;
      before = txs[txs.length - 1]!.signature;
    }
    return out;
  }

  async topTraders(window: "today" | "1W" | "30d", limit: number): Promise<string[]> {
    if (!this.config.birdeyeApiKey) return [];
    const out: string[] = [];
    for (let offset = 0; offset < limit; offset += 10) {
      const url = new URL("https://public-api.birdeye.so/trader/gainers-losers");
      url.searchParams.set("type", window);
      url.searchParams.set("sort_by", "PnL");
      url.searchParams.set("sort_type", "desc");
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", "10");
      const res = await getJson<{ data?: { items?: { address?: string }[] } }>(url.toString(), {
        headers: { "X-API-KEY": this.config.birdeyeApiKey, "x-chain": "solana", accept: "application/json" },
      });
      const items = res.data?.items ?? [];
      for (const i of items) if (i.address) out.push(i.address);
      if (items.length < 10) break;
    }
    return out.slice(0, limit);
  }

  async quotes(mints: string[]): Promise<Map<string, TokenQuote>> {
    const out = new Map<string, TokenQuote>();
    const unique = [...new Set(mints)].filter((m) => m !== SOL_MINT);
    if (unique.length === 0) return out;
    const headers: Record<string, string> = this.config.jupiterApiKey ? { "x-api-key": this.config.jupiterApiKey } : {};
    const base = this.config.jupiterApiKey ? "https://api.jup.ag/price/v3" : "https://lite-api.jup.ag/price/v3";
    for (let i = 0; i < unique.length; i += 49) {
      const ids = [SOL_MINT, ...unique.slice(i, i + 49)];
      const res = await getJson<Record<string, { usdPrice?: number; liquidity?: number }>>(`${base}?ids=${ids.join(",")}`, {
        headers,
      });
      const solUsd = res[SOL_MINT]?.usdPrice;
      if (!solUsd) continue;
      for (const mint of ids.slice(1)) {
        const q = res[mint];
        if (q?.usdPrice) out.set(mint, { priceSol: q.usdPrice / solUsd, priceUsd: q.usdPrice, liquidityUsd: q.liquidity });
      }
    }
    return out;
  }
}
