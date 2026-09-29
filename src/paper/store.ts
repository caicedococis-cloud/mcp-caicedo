import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PaperTrader } from "./engine.js";
import type { PaperConfig, PaperSnapshot } from "./types.js";

/** Writes the full paper state (fills, positions, limits) to a JSON file atomically. */
export async function savePaperState(trader: PaperTrader, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(trader.toJSON(), null, 2));
  await rename(tmp, path);
}

/** Loads paper state from `path`, or starts a fresh simulation with `config` if the file does not exist. */
export async function loadPaperState(path: string, config: Partial<PaperConfig> = {}): Promise<PaperTrader> {
  try {
    const snapshot = JSON.parse(await readFile(path, "utf8")) as PaperSnapshot;
    return PaperTrader.fromJSON(snapshot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new PaperTrader(config);
    throw err;
  }
}
