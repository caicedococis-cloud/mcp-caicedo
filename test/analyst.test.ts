import { describe, expect, it } from "vitest";
import { ClaudeAnalyst, heuristicAnalysis, type AnalysisInput } from "../src/ai/analyst.js";
import type { RankedWallet } from "../src/types.js";

const leader: RankedWallet = {
  wallet: "L",
  swaps: 60,
  tokens: 30,
  closedTrades: 25,
  wins: 16,
  losses: 9,
  winRate: 0.64,
  realizedPnlSol: 40,
  investedSol: 50,
  roi: 0.8,
  recentPnlSol: 6,
  medianHoldSec: 1800,
  concentration: 0.3,
  firstSeen: 0,
  lastSeen: 100,
  score: 70,
  eligible: true,
  flags: [],
  origin: "demo",
};

const input = (over: Partial<AnalysisInput> = {}): AnalysisInput => ({
  swap: { signature: "sig", wallet: "L", timestamp: 100, side: "buy", mint: "M", tokenAmount: 1000, solAmount: 1, source: "JUPITER", symbol: "WIF" },
  leader,
  quote: { priceSol: 0.001, liquidityUsd: 500_000 },
  leaderHistoryOnMint: [],
  nowSec: 110,
  ...over,
});

describe("heuristicAnalysis", () => {
  it("aprueba un líder sólido con buena liquidez", () => {
    const a = heuristicAnalysis(input());
    expect(a.verdict).toBe("copy");
    expect(a.engine).toBe("heuristic");
    expect(a.reasons.length).toBeGreaterThan(0);
  });

  it("rechaza poca liquidez y precio ya disparado", () => {
    const a = heuristicAnalysis(input({ leader: { ...leader, eligible: false, flags: ["x"] }, quote: { priceSol: 0.002, liquidityUsd: 3000 } }));
    expect(a.verdict).toBe("skip");
    expect(a.risks.join(" ")).toMatch(/Liquidez muy baja/);
    expect(a.risks.join(" ")).toMatch(/subió/);
  });
});

describe("ClaudeAnalyst", () => {
  const reply = (body: unknown, status = 200) => async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("devuelve el análisis estructurado del modelo", async () => {
    let sent: any;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return reply({
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [{ type: "text", text: JSON.stringify({ verdict: "caution", confidence: 0.7, summary: "ok", reasons: ["a"], risks: ["b"] }) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1 },
      })();
    }) as unknown as typeof fetch;
    const a = await new ClaudeAnalyst("k", "claude-opus-5-5", "low", { fetch: fetchImpl, maxRetries: 0 }).analyze(input());
    expect(a).toMatchObject({ verdict: "caution", confidence: 0.7, engine: "ai", model: "claude-opus-5-5" });
    expect(sent.output_config.effort).toBe("low");
    expect(sent.fallbacks).toBe("default");
  });

  it("cae al análisis por reglas si la API falla", async () => {
    const fetchImpl = reply({ type: "error", error: { type: "overloaded_error", message: "x" } }, 529) as unknown as typeof fetch;
    const a = await new ClaudeAnalyst("k", "m", "low", { fetch: fetchImpl, maxRetries: 0 }).analyze(input());
    expect(a.engine).toBe("heuristic");
    expect(a.summary).toMatch(/API/);
  });
});
