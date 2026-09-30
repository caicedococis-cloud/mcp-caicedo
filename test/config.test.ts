import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, loadDotEnv } from "../src/config.js";

describe("loadConfig", () => {
  it("sin clave de Helius arranca en demo, solo en localhost", () => {
    const c = loadConfig({});
    expect(c.demo).toBe(true);
    expect(c.host).toBe("127.0.0.1");
    expect(c.anthropicModel).toBe("claude-opus-5-5");
    expect(c.anthropicEffort).toBe("low");
    expect(c.openBrowser).toBe(true);
  });

  it("con clave de Helius usa datos reales salvo que se pida demo", () => {
    expect(loadConfig({ HELIUS_API_KEY: "k" }).demo).toBe(false);
    expect(loadConfig({ HELIUS_API_KEY: "k", DEMO: "true" }).demo).toBe(true);
  });

  it("lee listas y booleanos e ignora claves vacías", () => {
    const c = loadConfig({ OPEN_BROWSER: "false", HELIUS_API_KEY: "  " });
    expect(c.watchlistPath).toBe("data/watchlist.json");
    expect(c.openBrowser).toBe(false);
    expect(c.heliusApiKey).toBeUndefined();
  });

  it("rechaza números inválidos", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow();
  });
});

describe("loadDotEnv", () => {
  it("carga el archivo sin pisar variables existentes", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfg-"));
    const path = join(dir, ".env");
    writeFileSync(path, "# comentario\nPORT=5000\nWATCHLIST_PATH=\"x.json\"\n");
    const env: NodeJS.ProcessEnv = { PORT: "6000" };
    loadDotEnv(path, env);
    expect(env.PORT).toBe("6000");
    expect(env.WATCHLIST_PATH).toBe("x.json");
  });
});
