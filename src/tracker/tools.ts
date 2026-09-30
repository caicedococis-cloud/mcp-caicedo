import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { SwapHistorySource } from "./helius.js";
import { normalizeTransactions } from "./normalize.js";
import type { NormalizedTrade } from "./types.js";
import { isSolanaAddress, Watchlist } from "./watchlist.js";

export interface TrackerDeps {
  watchlist: Watchlist;
  /** Created lazily so the server starts even before an API key is configured. */
  getSource: () => SwapHistorySource;
}

const address = z
  .string()
  .refine(isSolanaAddress, "Must be a base58 Solana wallet address")
  .describe("Solana wallet address (base58)");

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function toolError(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function recentSwaps(
  deps: TrackerDeps,
  wallet: string,
  limit: number,
  before?: string,
): Promise<NormalizedTrade[]> {
  const txs = await deps.getSource().getSwapTransactions(wallet, { limit, before });
  return normalizeTransactions(txs, wallet);
}

/** Read-only wallet tracking tools. None of them hold or use signing keys. */
export function registerTrackerTools(server: McpServer, deps: TrackerDeps): void {
  server.registerTool(
    "watchlist_add",
    {
      description: "Add a Solana wallet to the copy-trading watchlist, or update its label.",
      inputSchema: { address, label: z.string().max(64).optional().describe("Optional nickname") },
    },
    async ({ address, label }) => {
      try {
        return json(await deps.watchlist.add(address, label));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "watchlist_remove",
    {
      description: "Remove a wallet from the watchlist.",
      inputSchema: { address },
    },
    async ({ address }) => {
      try {
        return json({ address, removed: await deps.watchlist.remove(address) });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "watchlist_list",
    {
      description: "List the wallets on the watchlist.",
      inputSchema: {},
    },
    async () => {
      try {
        return json(await deps.watchlist.list());
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "wallet_recent_swaps",
    {
      description:
        "Recent swaps of one Solana wallet as normalized trades: token in (what it gave), " +
        "token out (what it got), size in SOL or stablecoin, and time. Read-only.",
      inputSchema: {
        address,
        limit: z.number().int().min(1).max(100).default(20).describe("Transactions to scan (max 100)"),
        before: z.string().optional().describe("Only return swaps older than this signature (pagination)"),
      },
    },
    async ({ address, limit, before }) => {
      try {
        return json(await recentSwaps(deps, address, limit, before));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.registerTool(
    "watchlist_recent_swaps",
    {
      description:
        "Recent swaps across every watchlisted wallet, newest first. " +
        "Wallets that fail to load are listed under errors instead of failing the whole call.",
      inputSchema: {
        limitPerWallet: z.number().int().min(1).max(100).default(10).describe("Transactions to scan per wallet"),
      },
    },
    async ({ limitPerWallet }) => {
      try {
        const wallets = await deps.watchlist.list();
        const results = await Promise.allSettled(
          wallets.map((w) => recentSwaps(deps, w.address, limitPerWallet)),
        );
        const trades: Array<NormalizedTrade & { label?: string }> = [];
        const errors: Array<{ address: string; error: string }> = [];
        results.forEach((r, i) => {
          const w = wallets[i];
          if (r.status === "fulfilled") {
            trades.push(...r.value.map((t) => (w.label ? { ...t, label: w.label } : t)));
          } else {
            errors.push({ address: w.address, error: String(r.reason?.message ?? r.reason) });
          }
        });
        trades.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        return json({ trades, errors });
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
