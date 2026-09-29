import { describe, expect, it, vi } from "vitest";
import { HeliusClient } from "../src/tracker/helius.js";

describe("HeliusClient", () => {
  it("requests only SWAP transactions with limit and before", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => [], text: async () => "" }));
    await new HeliusClient("k", fetchImpl).getSwapTransactions("Addr", { limit: 5, before: "sig" });
    const url = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://api.helius.xyz/v0/addresses/Addr/transactions");
    expect(Object.fromEntries(url.searchParams)).toEqual({ "api-key": "k", type: "SWAP", limit: "5", before: "sig" });
  });

  it("surfaces HTTP errors", async () => {
    const fetchImpl = async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => "rate limited" });
    await expect(new HeliusClient("k", fetchImpl).getSwapTransactions("Addr")).rejects.toThrow("429");
  });

  it("refuses to start without an API key", () => {
    expect(() => new HeliusClient("")).toThrow("HELIUS_API_KEY");
  });
});
