import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Configuración de infraestructura (claves y puertos). La estrategia de trading
 * vive en `settings.ts` y se edita desde el dashboard.
 */
const bool = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : ["1", "true", "yes", "si", "sí"].includes(v.toLowerCase())));

const num = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().finite());

const EnvSchema = z.object({
  HELIUS_API_KEY: z.string().optional(),
  HELIUS_API_BASE: z.string().optional(),
  BIRDEYE_API_KEY: z.string().optional(),
  JUPITER_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().optional(),
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional().or(z.literal("").transform(() => undefined)),
  WATCHLIST_PATH: z.string().optional(),
  DEMO: bool,
  PORT: num(4747),
  HOST: z.string().optional(),
  OPEN_BROWSER: bool,
  DATA_DIR: z.string().optional(),
});

export interface Config {
  heliusApiKey?: string;
  heliusApiBase: string;
  birdeyeApiKey?: string;
  jupiterApiKey?: string;
  anthropicApiKey?: string;
  anthropicModel: string;
  anthropicEffort: "low" | "medium" | "high" | "xhigh" | "max";
  /** Billeteras añadidas a mano, compartidas con las herramientas MCP del tracker. */
  watchlistPath: string;
  /** Modo demo: datos simulados, útil sin claves o para probar la interfaz. */
  demo: boolean;
  port: number;
  host: string;
  openBrowser: boolean;
  dataDir: string;
}

/** Lee un archivo .env sencillo (CLAVE=valor) sin pisar variables ya definidas. */
export function loadDotEnv(path = ".env", env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.replace(/^["']|["']$/g, "");
    if (env[key] === undefined) env[key] = value;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  const blank = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  const heliusApiKey = blank(e.HELIUS_API_KEY);
  return {
    heliusApiKey,
    heliusApiBase: blank(e.HELIUS_API_BASE) ?? "https://api.helius.xyz",
    birdeyeApiKey: blank(e.BIRDEYE_API_KEY),
    jupiterApiKey: blank(e.JUPITER_API_KEY),
    anthropicApiKey: blank(e.ANTHROPIC_API_KEY),
    anthropicModel: blank(e.ANTHROPIC_MODEL) ?? "claude-opus-5-5",
    anthropicEffort: e.ANTHROPIC_EFFORT ?? "low",
    watchlistPath: blank(e.WATCHLIST_PATH) ?? "data/watchlist.json",
    // Sin clave de Helius no hay datos reales: el bot arranca en demo.
    demo: e.DEMO ?? !heliusApiKey,
    port: e.PORT,
    host: blank(e.HOST) ?? "127.0.0.1",
    openBrowser: e.OPEN_BROWSER ?? true,
    dataDir: blank(e.DATA_DIR) ?? "data",
  };
}
