import type { MarketData } from "../solana/market.js";
import type { Settings } from "../settings.js";
import type { RankedWallet, Swap } from "../types.js";
import { rankWallets } from "./rank.js";
import { computeWalletStats } from "./stats.js";

export interface DiscoveryInput {
  market: MarketData;
  settings: Settings;
  /** Billeteras que el usuario añadió a mano (semillas o desde el dashboard). */
  manual: string[];
  /** Billeteras vetadas por el usuario. */
  banned?: Set<string>;
  /** Candidatas a pedir a Birdeye. */
  candidateLimit?: number;
  /** Páginas de 100 swaps por billetera. */
  pages?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface DiscoveryResult {
  ranked: RankedWallet[];
  /** Historial reciente por billetera, para dar contexto a la IA. */
  history: Map<string, Swap[]>;
  errors: string[];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

/** Busca candidatas, descarga su historial, calcula estadísticas y las ordena. */
export async function discoverWallets(input: DiscoveryInput): Promise<DiscoveryResult> {
  const { market, settings, banned = new Set() } = input;
  const errors: string[] = [];
  const origins = new Map<string, string>();
  for (const w of input.manual) origins.set(w, "manual");
  try {
    for (const w of await market.topTraders(settings.discoveryWindow, input.candidateLimit ?? 30)) {
      if (!origins.has(w)) origins.set(w, market.name.startsWith("Demo") ? "demo" : "birdeye");
    }
  } catch (err) {
    errors.push(`Ranking de candidatas: ${(err as Error).message}`);
  }

  const wallets = [...origins.keys()].filter((w) => !banned.has(w));
  const history = new Map<string, Swap[]>();
  let done = 0;
  const stats = await mapLimit(wallets, 4, async (wallet) => {
    try {
      const swaps = await market.fetchSwaps(wallet, { limit: 100, pages: input.pages ?? 3 });
      history.set(wallet, swaps);
      return { stats: computeWalletStats(wallet, swaps), origin: origins.get(wallet)! };
    } catch (err) {
      errors.push(`${wallet.slice(0, 6)}…: ${(err as Error).message}`);
      return null;
    } finally {
      input.onProgress?.(++done, wallets.length);
    }
  });

  const ranked = rankWallets(
    stats.filter((s): s is NonNullable<typeof s> => s !== null),
    settings,
  );
  return { ranked, history, errors };
}
