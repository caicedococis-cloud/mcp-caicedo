import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerTrackerTools, type TrackerDeps } from "./tracker/tools.js";

export const SERVER_NAME = "mcp-caicedo";
export const SERVER_VERSION = "0.1.0";

export const healthOutputSchema = {
  status: z.literal("ok"),
  name: z.string(),
  version: z.string(),
  uptimeSeconds: z.number(),
  timestamp: z.string(),
};

export interface ServerDeps {
  /** Read-only wallet tracker tools; omitted in tests that only need health. */
  tracker?: TrackerDeps;
}

export function createServer(deps: ServerDeps = {}): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "health",
    {
      title: "Health check",
      description: "Reports that the server is running, with its version and uptime.",
      inputSchema: {},
      outputSchema: healthOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const result = {
        status: "ok" as const,
        name: SERVER_NAME,
        version: SERVER_VERSION,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );

  if (deps.tracker) registerTrackerTools(server, deps.tracker);

  return server;
}
