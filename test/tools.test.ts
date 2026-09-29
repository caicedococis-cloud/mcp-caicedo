import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixture from "./fixtures/helius-swaps.json" with { type: "json" };
import type { SwapHistorySource } from "../src/tracker/helius.js";
import { registerTrackerTools } from "../src/tracker/tools.js";
import type { HeliusTransaction } from "../src/tracker/types.js";
import { Watchlist } from "../src/tracker/watchlist.js";

const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BROKEN = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

let dir: string;
let client: Client;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ text: string }>)[0].text;
  return { isError: res.isError === true, text, data: res.isError ? undefined : JSON.parse(text) };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tracker-"));
  const source: SwapHistorySource = {
    async getSwapTransactions(address) {
      if (address === BROKEN) throw new Error("Helius request failed (500)");
      return fixture as unknown as HeliusTransaction[];
    },
  };
  const server = new McpServer({ name: "test", version: "0" });
  registerTrackerTools(server, { watchlist: new Watchlist(join(dir, "watchlist.json")), getSource: () => source });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterEach(async () => {
  await client.close();
  await rm(dir, { recursive: true, force: true });
});

describe("tracker tools", () => {
  it("exposes the five read-only tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "wallet_recent_swaps",
      "watchlist_add",
      "watchlist_list",
      "watchlist_recent_swaps",
      "watchlist_remove",
    ]);
  });

  it("adds, relabels, lists and removes wallets", async () => {
    expect((await call("watchlist_add", { address: WALLET, label: "whale" })).data.added).toBe(true);
    const again = await call("watchlist_add", { address: WALLET, label: "top trader" });
    expect(again.data).toMatchObject({ added: false, wallet: { label: "top trader" } });
    expect((await call("watchlist_list")).data).toHaveLength(1);
    expect((await call("watchlist_remove", { address: WALLET })).data.removed).toBe(true);
    expect((await call("watchlist_list")).data).toEqual([]);
    expect((await call("watchlist_remove", { address: WALLET })).data.removed).toBe(false);
  });

  it("rejects invalid addresses", async () => {
    const res = await call("watchlist_add", { address: "not-a-wallet" });
    expect(res.isError).toBe(true);
  });

  it("returns normalized trades for one wallet", async () => {
    const { data } = await call("wallet_recent_swaps", { address: WALLET, limit: 5 });
    expect(data).toHaveLength(3);
    expect(data[0]).toMatchObject({ side: "buy", tokenIn: { symbol: "SOL", amount: 1.5 } });
  });

  it("aggregates the watchlist newest first and reports per-wallet errors", async () => {
    await call("watchlist_add", { address: WALLET, label: "whale" });
    await call("watchlist_add", { address: BROKEN });
    const { data } = await call("watchlist_recent_swaps", {});
    expect(data.trades).toHaveLength(3);
    expect(data.trades.every((t: { label: string }) => t.label === "whale")).toBe(true);
    const times = data.trades.map((t: { timestamp: string }) => t.timestamp);
    expect([...times].sort().reverse()).toEqual(times);
    expect(data.errors).toEqual([{ address: BROKEN, error: "Helius request failed (500)" }]);
  });

  it("reports a missing API key as a tool error", async () => {
    const server = new McpServer({ name: "t", version: "0" });
    registerTrackerTools(server, {
      watchlist: new Watchlist(join(dir, "w.json")),
      getSource: () => {
        throw new Error("HELIUS_API_KEY is not set");
      },
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "c", version: "0" });
    await Promise.all([server.connect(a), c.connect(b)]);
    const res = await c.callTool({ name: "wallet_recent_swaps", arguments: { address: WALLET } });
    expect(res.isError).toBe(true);
    await c.close();
  });
});
