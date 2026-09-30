import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { WatchedWallet } from "./types.js";

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isSolanaAddress(address: string): boolean {
  return BASE58_ADDRESS.test(address);
}

/** Watchlist persisted as a JSON file so it travels with the portable bot folder. */
export class Watchlist {
  constructor(private readonly path: string) {}

  async list(): Promise<WatchedWallet[]> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async add(address: string, label?: string): Promise<{ wallet: WatchedWallet; added: boolean }> {
    if (!isSolanaAddress(address)) throw new Error(`Not a valid Solana address: ${address}`);
    const wallets = await this.list();
    const existing = wallets.find((w) => w.address === address);
    if (existing) {
      if (label !== undefined && label !== existing.label) {
        existing.label = label;
        await this.save(wallets);
      }
      return { wallet: existing, added: false };
    }
    const wallet: WatchedWallet = {
      address,
      ...(label ? { label } : {}),
      addedAt: new Date().toISOString(),
    };
    wallets.push(wallet);
    await this.save(wallets);
    return { wallet, added: true };
  }

  async remove(address: string): Promise<boolean> {
    const wallets = await this.list();
    const remaining = wallets.filter((w) => w.address !== address);
    if (remaining.length === wallets.length) return false;
    await this.save(remaining);
    return true;
  }

  private async save(wallets: WatchedWallet[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(wallets, null, 2) + "\n", "utf8");
    await rename(tmp, this.path);
  }
}
