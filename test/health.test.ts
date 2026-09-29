import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "../src/server.js";

describe("health tool", () => {
  let client: Client;

  beforeEach(async () => {
    const server = createServer();
    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterEach(async () => {
    await client.close();
  });

  it("is listed as a tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("health");
  });

  it("reports ok with name and version", async () => {
    const result = await client.callTool({ name: "health", arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent as Record<string, unknown>;
    expect(data.status).toBe("ok");
    expect(data.name).toBe(SERVER_NAME);
    expect(data.version).toBe(SERVER_VERSION);
    expect(typeof data.uptimeSeconds).toBe("number");
    expect(Number.isNaN(Date.parse(data.timestamp as string))).toBe(false);
  });
});
