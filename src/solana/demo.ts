import type { Swap, TokenQuote } from "../types.js";
import type { MarketData } from "./market.js";

/** Generador pseudoaleatorio con semilla, para que la demo sea reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const NAMES = [
  "BONK", "WIF", "POPCAT", "MEW", "GIGA", "MOODENG", "FWOG", "PNUT", "GOAT", "CHILLGUY",
  "SLERF", "MICHI", "RETARDIO", "PONKE", "BILLY", "SIGMA", "WEN", "MYRO", "SC", "LOCKIN",
  "ZEREBRO", "AI16Z", "GRIFFAIN", "ARC", "FARTCOIN",
];

interface DemoToken {
  mint: string;
  symbol: string;
  price: number;
  liquidityUsd: number;
  /** Tendencia oculta por segundo; los buenos traders la "intuyen". */
  drift: number;
  bondingCurve: boolean;
}

interface DemoWallet {
  address: string;
  /** 0 = azar, 1 = casi siempre acierta la tendencia. */
  skill: number;
  /** Segundos típicos que mantiene una posición. */
  holdSec: number;
  sizeSol: number;
  swaps: Swap[];
  open?: { mint: string; tokens: number; since: number };
}

/**
 * Mercado simulado para probar el bot sin claves ni dinero. Genera un
 * historial de 14 días y, en tiempo real, nuevas operaciones de traders con
 * distinta habilidad, así que el ranking y la copia tienen algo que mostrar.
 */
export class DemoMarket implements MarketData {
  readonly name = "Demo (datos simulados)";
  private readonly rand: () => number;
  private readonly tokens: DemoToken[];
  private readonly wallets: DemoWallet[];
  private simTime: number;
  private sig = 0;

  constructor(seed = 42, now = Math.floor(Date.now() / 1000)) {
    this.rand = rng(seed);
    const addr = () => Array.from({ length: 44 }, () => B58[Math.floor(this.rand() * B58.length)]).join("");
    this.tokens = NAMES.map((symbol) => ({
      mint: addr(),
      symbol,
      price: 1e-7 + this.rand() * 1e-4,
      liquidityUsd: Math.round(2_000 + this.rand() ** 2 * 900_000),
      drift: 0,
      bondingCurve: this.rand() < 0.2,
    }));
    this.wallets = Array.from({ length: 24 }, (_, i) => ({
      address: addr(),
      skill: i < 5 ? 0.75 + this.rand() * 0.2 : i < 12 ? 0.4 + this.rand() * 0.3 : this.rand() * 0.35,
      holdSec: i % 7 === 6 ? 8 + this.rand() * 20 : 300 + this.rand() * 5000,
      sizeSol: 0.5 + this.rand() * 8,
      swaps: [],
    }));
    this.simTime = now - 14 * 86_400;
    this.simulateTo(now, 60);
  }

  /** Billeteras simuladas ordenadas por habilidad real (solo para tests). */
  get truth() {
    return this.wallets.map((w) => ({ address: w.address, skill: w.skill }));
  }

  private simulateTo(target: number, step: number): void {
    while (this.simTime < target) {
      const dt = Math.min(step, target - this.simTime);
      this.simTime += dt;
      for (const t of this.tokens) {
        if (this.rand() < dt / 900) t.drift = (this.rand() - 0.5) * 0.0004;
        const noise = (this.rand() - 0.5) * 0.04 * Math.sqrt(dt / 60);
        t.price = Math.max(1e-9, t.price * Math.exp(t.drift * dt + noise));
      }
      for (const w of this.wallets) this.act(w, dt);
    }
  }

  private act(w: DemoWallet, dt: number): void {
    const now = this.simTime;
    if (w.open) {
      if (now - w.open.since < w.holdSec * (0.5 + this.rand())) return;
      const t = this.tokens.find((x) => x.mint === w.open!.mint)!;
      // Los hábiles salen antes si la tendencia se gira.
      if (t.drift > 0 && this.rand() < w.skill && now - w.open.since < w.holdSec * 3) return;
      w.swaps.push(this.swap(w, "sell", t, w.open.tokens, w.open.tokens * t.price * 0.99));
      w.open = undefined;
      return;
    }
    if (this.rand() > dt / Math.max(60, w.holdSec * 0.8)) return;
    const pick = this.rand() < w.skill ? [...this.tokens].sort((a, b) => b.drift - a.drift)[Math.floor(this.rand() * 3)]! : this.tokens[Math.floor(this.rand() * this.tokens.length)]!;
    const sol = w.sizeSol * (0.5 + this.rand());
    const tokens = (sol / pick.price) * 0.99;
    w.swaps.push(this.swap(w, "buy", pick, tokens, sol));
    w.open = { mint: pick.mint, tokens, since: now };
  }

  private swap(w: DemoWallet, side: Swap["side"], t: DemoToken, tokenAmount: number, solAmount: number): Swap {
    return {
      signature: `demo${(this.sig++).toString(36).padStart(8, "0")}${w.address.slice(0, 20)}`,
      wallet: w.address,
      timestamp: this.simTime,
      side,
      mint: t.mint,
      tokenAmount,
      solAmount,
      source: t.bondingCurve ? "PUMP_FUN" : this.rand() < 0.6 ? "JUPITER" : "RAYDIUM",
      symbol: t.symbol,
    };
  }

  private catchUp(): void {
    this.simulateTo(Math.floor(Date.now() / 1000), 1);
  }

  async fetchSwaps(wallet: string, opts: { limit?: number; pages?: number; untilSignature?: string } = {}): Promise<Swap[]> {
    this.catchUp();
    const w = this.wallets.find((x) => x.address === wallet);
    if (!w) return [];
    const max = (opts.limit ?? 100) * (opts.pages ?? 1);
    const out: Swap[] = [];
    for (let i = w.swaps.length - 1; i >= 0 && out.length < max; i--) {
      if (w.swaps[i]!.signature === opts.untilSignature) break;
      out.push(w.swaps[i]!);
    }
    return out;
  }

  async topTraders(_window: "today" | "1W" | "30d", limit: number): Promise<string[]> {
    return this.wallets.slice(0, limit).map((w) => w.address);
  }

  async quotes(mints: string[]): Promise<Map<string, TokenQuote>> {
    this.catchUp();
    const out = new Map<string, TokenQuote>();
    for (const m of mints) {
      const t = this.tokens.find((x) => x.mint === m);
      if (t) out.set(m, { priceSol: t.price, priceUsd: t.price * 150, liquidityUsd: t.liquidityUsd });
    }
    return out;
  }
}
