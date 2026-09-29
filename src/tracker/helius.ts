import type { HeliusTransaction } from "./types.js";

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface SwapHistorySource {
  getSwapTransactions(
    address: string,
    opts?: { limit?: number; before?: string },
  ): Promise<HeliusTransaction[]>;
}

/** Read-only client for the Helius Enhanced Transactions API. Never signs anything. */
export class HeliusClient implements SwapHistorySource {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = "https://api.helius.xyz",
  ) {
    if (!apiKey) throw new Error("HELIUS_API_KEY is not set");
  }

  async getSwapTransactions(
    address: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<HeliusTransaction[]> {
    const params = new URLSearchParams({ "api-key": this.apiKey, type: "SWAP" });
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.before) params.set("before", opts.before);
    const url = `${this.baseUrl}/v0/addresses/${encodeURIComponent(address)}/transactions?${params}`;

    const res = await this.fetchImpl(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Helius request failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error("Helius returned an unexpected response shape");
    return data as HeliusTransaction[];
  }
}
