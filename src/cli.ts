#!/usr/bin/env node
import { loadConfig, loadDotEnv, type Config } from "./config.js";
import { discoverWallets } from "./discovery/discover.js";
import { defaultSettings } from "./settings.js";
import { DemoMarket } from "./solana/demo.js";
import { LiveMarket } from "./solana/live.js";
import type { MarketData } from "./solana/market.js";
import { Watchlist } from "./tracker/watchlist.js";

const HELP = `mcp-caicedo: bot de copy trading en Solana

Uso:
  mcp-caicedo start [--demo]   Arranca el bot y abre el dashboard en el navegador
  mcp-caicedo discover         Muestra el ranking de billeteras en la terminal
  mcp-caicedo help             Muestra esta ayuda
`;

export function createMarket(config: Config): MarketData {
  return config.demo ? new DemoMarket() : new LiveMarket(config);
}

async function discover(config: Config): Promise<void> {
  const market = createMarket(config);
  console.error(`Fuente de datos: ${market.name}`);
  const { ranked, errors } = await discoverWallets({
    market,
    settings: defaultSettings(),
    manual: (await new Watchlist(config.watchlistPath).list()).map((w) => w.address),
    onProgress: (d, t) => process.stderr.write(`\rAnalizando billeteras ${d}/${t}`),
  });
  process.stderr.write("\n");
  for (const e of errors) console.error(`Aviso: ${e}`);
  console.table(
    ranked.slice(0, 20).map((w) => ({
      billetera: w.wallet,
      puntuación: w.score,
      apta: w.eligible ? "sí" : "no",
      "PnL SOL": w.realizedPnlSol.toFixed(2),
      "acierto %": (w.winRate * 100).toFixed(0),
      cerradas: w.closedTrades,
      motivos: w.flags.join("; "),
    })),
  );
}

async function main(argv: string[]): Promise<void> {
  loadDotEnv();
  const [cmd = "help", ...rest] = argv;
  if (rest.includes("--demo")) process.env.DEMO = "true";
  const config = loadConfig();
  switch (cmd) {
    case "discover":
      return discover(config);
    default:
      console.log(HELP);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
