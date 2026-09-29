#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { HeliusClient } from "./tracker/helius.js";
import { registerTrackerTools } from "./tracker/tools.js";
import { Watchlist } from "./tracker/watchlist.js";

const server = new McpServer({ name: "mcp-caicedo", version: "0.1.0" });

let helius: HeliusClient | undefined;
registerTrackerTools(server, {
  watchlist: new Watchlist(process.env.WATCHLIST_PATH ?? "data/watchlist.json"),
  getSource: () => (helius ??= new HeliusClient(process.env.HELIUS_API_KEY ?? "")),
});

await server.connect(new StdioServerTransport());
