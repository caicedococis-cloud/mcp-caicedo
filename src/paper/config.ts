import type { PaperConfig } from "./types.js";

export const DEFAULT_PAPER_CONFIG: PaperConfig = {
  startingBalanceSol: 10,
  sizing: { mode: "fixed", sol: 0.1 },
  maxPerTradeSol: 0.5,
  dailyCapSol: 2,
  minTradeSol: 0.01,
  slippageBps: 100,
  feeSol: 0.000_105,
};

/** Merges overrides onto the defaults and validates the result. Throws on invalid values. */
export function resolvePaperConfig(overrides: Partial<PaperConfig> = {}): PaperConfig {
  const config: PaperConfig = { ...DEFAULT_PAPER_CONFIG, ...overrides };
  const errors = validatePaperConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid paper config: ${errors.join("; ")}`);
  }
  return config;
}

export function validatePaperConfig(config: PaperConfig): string[] {
  const errors: string[] = [];
  const positive = (name: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) errors.push(`${name} must be > 0`);
  };
  const nonNegative = (name: string, value: number) => {
    if (!Number.isFinite(value) || value < 0) errors.push(`${name} must be >= 0`);
  };

  positive("startingBalanceSol", config.startingBalanceSol);
  positive("maxPerTradeSol", config.maxPerTradeSol);
  positive("dailyCapSol", config.dailyCapSol);
  nonNegative("minTradeSol", config.minTradeSol);
  nonNegative("slippageBps", config.slippageBps);
  nonNegative("feeSol", config.feeSol);
  if (config.slippageBps >= 10_000) errors.push("slippageBps must be < 10000");
  if (config.minTradeSol > config.maxPerTradeSol) errors.push("minTradeSol must be <= maxPerTradeSol");

  const { sizing } = config;
  switch (sizing.mode) {
    case "fixed":
      positive("sizing.sol", sizing.sol);
      break;
    case "proportional":
      positive("sizing.ratio", sizing.ratio);
      break;
    case "percentOfBalance":
      positive("sizing.percent", sizing.percent);
      if (sizing.percent > 100) errors.push("sizing.percent must be <= 100");
      break;
    default:
      errors.push(`unknown sizing mode ${(sizing as { mode: string }).mode}`);
  }
  return errors;
}
