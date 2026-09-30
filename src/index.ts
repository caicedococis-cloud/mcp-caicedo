#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { HeliusClient } from "./tracker/helius.js";
import { Watchlist } from "./tracker/watchlist.js";

async function main(): Promise<void> {
  let helius: HeliusClient | undefined;
  const server = createServer({
    tracker: {
      watchlist: new Watchlist(process.env.WATCHLIST_PATH ?? "data/watchlist.json"),
      getSource: () => (helius ??= new HeliusClient(process.env.HELIUS_API_KEY ?? "")),
    },
  });
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol, so logs go to stderr.
  console.error("mcp-caicedo running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
