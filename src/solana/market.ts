import type { Swap, TokenQuote } from "../types.js";

/** Fuente de datos de mercado. Hay una real (Helius + Birdeye + Jupiter) y una demo. */
export interface MarketData {
  readonly name: string;
  /** Swaps token/SOL de una billetera, del más reciente al más antiguo. */
  fetchSwaps(wallet: string, opts?: { limit?: number; pages?: number; untilSignature?: string }): Promise<Swap[]>;
  /** Billeteras candidatas ordenadas por ganancia en la ventana dada. */
  topTraders(window: "today" | "1W" | "30d", limit: number): Promise<string[]>;
  /** Precio en SOL y liquidez de varios tokens. */
  quotes(mints: string[]): Promise<Map<string, TokenQuote>>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} en ${url.replace(/api-key=[^&]+/, "api-key=***")}: ${body.slice(0, 200)}`);
  }
}

export async function getJson<T>(url: string, init?: RequestInit, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    if (res.ok) return (await res.json()) as T;
    const body = await res.text();
    if (attempt < retries && (res.status === 429 || res.status >= 500)) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new HttpError(res.status, url, body);
  }
}
