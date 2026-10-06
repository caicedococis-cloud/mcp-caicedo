import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { RankedWallet, Swap, TokenQuote, TradeAnalysis } from "../types.js";

/** Todo lo que se sabe de una operación de un líder en el momento de analizarla. */
export interface AnalysisInput {
  swap: Swap;
  leader?: RankedWallet;
  quote?: TokenQuote;
  /** Operaciones anteriores del mismo líder en este token, más recientes primero. */
  leaderHistoryOnMint: Swap[];
  /** Nuestra posición abierta en el token, si la hay. */
  position?: { entryPrice: number; costSol: number; openedAtSec: number };
  nowSec: number;
}

export interface Analyst {
  readonly engine: TradeAnalysis["engine"];
  analyze(input: AnalysisInput): Promise<TradeAnalysis>;
}

const pct = (x: number) => `${(x * 100).toFixed(0)} %`;

/** Análisis por reglas: se usa sin clave de Anthropic y como respaldo si la IA falla. */
export function heuristicAnalysis(input: AnalysisInput, note?: string): TradeAnalysis {
  const { swap, leader, quote } = input;
  const reasons: string[] = [];
  const risks: string[] = [];
  let score = 0;

  if (leader) {
    if (leader.eligible) {
      score += 2;
      reasons.push(`Líder apto: ${leader.score} puntos, ${pct(leader.winRate)} de acierto en ${leader.closedTrades} operaciones`);
    } else risks.push(`Líder no cumple filtros: ${leader.flags.join("; ")}`);
    if (leader.recentPnlSol > 0) {
      score += 1;
      reasons.push(`En racha: +${leader.recentPnlSol.toFixed(2)} SOL en 7 días`);
    } else if (leader.recentPnlSol < 0) {
      score -= 1;
      risks.push(`Racha negativa: ${leader.recentPnlSol.toFixed(2)} SOL en 7 días`);
    }
    if (leader.concentration > 0.7) risks.push(`${pct(leader.concentration)} de su ganancia viene de 2 operaciones`);
  } else risks.push("Sin estadísticas del líder");

  if (quote?.liquidityUsd !== undefined) {
    if (quote.liquidityUsd < 10_000) {
      score -= 2;
      risks.push(`Liquidez muy baja: ${Math.round(quote.liquidityUsd).toLocaleString("es")} USD`);
    } else if (quote.liquidityUsd > 100_000) {
      score += 1;
      reasons.push(`Liquidez sólida: ${Math.round(quote.liquidityUsd).toLocaleString("es")} USD`);
    }
  } else risks.push("Liquidez desconocida");

  if (swap.source === "PUMP_FUN") risks.push("Token todavía en bonding curve");

  const leaderPrice = swap.solAmount / swap.tokenAmount;
  if (swap.side === "buy" && quote && quote.priceSol > leaderPrice * 1.1) {
    score -= 1;
    risks.push(`El precio ya subió ${pct(quote.priceSol / leaderPrice - 1)} desde la compra del líder`);
  }
  if (swap.side === "buy" && input.leaderHistoryOnMint.some((s) => s.side === "buy")) {
    reasons.push("El líder está ampliando una posición que ya tenía");
  }
  if (swap.side === "sell") {
    score += 1;
    reasons.push("Seguir la salida del líder protege frente a que venda sobre sus copiadores");
    if (input.position && quote) {
      const ch = quote.priceSol / input.position.entryPrice - 1;
      reasons.push(`Nuestra posición va ${ch >= 0 ? "+" : ""}${pct(ch)}`);
    }
  }

  const verdict: TradeAnalysis["verdict"] = score >= 2 ? "copy" : score <= -1 ? "skip" : "caution";
  const summary =
    swap.side === "buy"
      ? verdict === "copy"
        ? "Entrada respaldada por un líder consistente y condiciones de mercado aceptables."
        : verdict === "skip"
          ? "Entrada con más riesgos que señales a favor."
          : "Entrada dudosa: hay señales a favor pero también riesgos claros."
      : "Salida del líder: conviene acompañarla salvo que tengas una razón para mantener.";
  return {
    signature: swap.signature,
    verdict,
    confidence: Math.min(0.9, 0.4 + Math.abs(score) * 0.1),
    summary: note ? `${summary} (${note})` : summary,
    reasons,
    risks,
    engine: "heuristic",
    createdAt: Date.now(),
  };
}

export class HeuristicAnalyst implements Analyst {
  readonly engine = "heuristic" as const;
  async analyze(input: AnalysisInput): Promise<TradeAnalysis> {
    return heuristicAnalysis(input);
  }
}

const Output = z.object({
  verdict: z.enum(["copy", "skip", "caution"]),
  confidence: z.number(),
  summary: z.string(),
  reasons: z.array(z.string()),
  risks: z.array(z.string()),
});

const SYSTEM = `Eres un trader profesional de memecoins en Solana que revisa, operación por operación, lo que hacen las billeteras más rentables para decidir si copiarlas.
Recibes una operación de un "líder" (compra o venta de un token contra SOL), sus estadísticas históricas, datos del token y nuestra posición si existe.
Decide:
- copy: seguir la operación (en una venta, salir también).
- caution: se puede seguir, pero con un riesgo concreto que el usuario debe conocer.
- skip: no seguirla.
Ten en cuenta: copiar llega tarde, así que un precio que ya se movió mucho empeora la entrada; los tokens con poca liquidez o en bonding curve son difíciles de vender; un líder cuya ganancia viene de 1 o 2 golpes no es un patrón fiable; los scalpers de segundos no se pueden copiar; los líderes pueden vender sobre sus copiadores.
Responde en español, con frases cortas y concretas que citen los datos. confidence va de 0 a 1. Da de 1 a 4 razones y de 0 a 4 riesgos. No inventes datos que no estén en la entrada.`;

function describeInput(i: AnalysisInput): string {
  const { swap, leader, quote } = i;
  const price = swap.solAmount / swap.tokenAmount;
  return JSON.stringify(
    {
      operacion: {
        tipo: swap.side === "buy" ? "compra" : "venta",
        token: swap.symbol ?? swap.mint,
        mint: swap.mint,
        sol: +swap.solAmount.toFixed(4),
        precio_sol_por_token: price,
        dex: swap.source,
        segundos_desde_la_operacion: Math.round(i.nowSec - swap.timestamp),
      },
      lider: leader
        ? {
            puntuacion_0_100: leader.score,
            apto_para_copiar: leader.eligible,
            motivos_no_apto: leader.flags,
            pnl_realizado_sol: +leader.realizedPnlSol.toFixed(2),
            roi: +leader.roi.toFixed(2),
            tasa_acierto: +leader.winRate.toFixed(2),
            operaciones_cerradas: leader.closedTrades,
            pnl_7_dias_sol: +leader.recentPnlSol.toFixed(2),
            concentracion_ganancia_top2: +leader.concentration.toFixed(2),
            tenencia_mediana_segundos: Math.round(leader.medianHoldSec),
          }
        : null,
      token_ahora: quote
        ? { precio_sol: quote.priceSol, liquidez_usd: quote.liquidityUsd ?? null, cambio_vs_lider: +(quote.priceSol / price - 1).toFixed(3) }
        : null,
      historial_del_lider_en_este_token: i.leaderHistoryOnMint.slice(0, 10).map((s) => ({
        tipo: s.side,
        sol: +s.solAmount.toFixed(4),
        hace_minutos: Math.round((i.nowSec - s.timestamp) / 60),
      })),
      nuestra_posicion: i.position
        ? {
            precio_entrada: i.position.entryPrice,
            coste_sol: +i.position.costSol.toFixed(4),
            minutos_abierta: Math.round((i.nowSec - i.position.openedAtSec) / 60),
          }
        : null,
    },
    null,
    1,
  );
}

/** Análisis con Claude usando salida estructurada. Si falla, cae al análisis por reglas. */
export class ClaudeAnalyst implements Analyst {
  readonly engine = "ai" as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly effort: "low" | "medium" | "high" | "xhigh" | "max",
    clientOptions: { baseURL?: string; fetch?: typeof fetch; maxRetries?: number } = {},
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, ...clientOptions });
  }

  async analyze(input: AnalysisInput): Promise<TradeAnalysis> {
    try {
      const res = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 4000,
        system: SYSTEM,
        messages: [{ role: "user", content: describeInput(input) }],
        output_config: { effort: this.effort, format: betaZodOutputFormat(Output) },
        // Si el modelo declina por política, la API reintenta con otro modelo en la misma llamada.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (res.stop_reason === "refusal" || !res.parsed_output) {
        return heuristicAnalysis(input, "la IA no devolvió un análisis");
      }
      const o = res.parsed_output;
      return {
        signature: input.swap.signature,
        verdict: o.verdict,
        confidence: Math.max(0, Math.min(1, o.confidence)),
        summary: o.summary,
        reasons: o.reasons.slice(0, 4),
        risks: o.risks.slice(0, 4),
        engine: "ai",
        model: res.model,
        createdAt: Date.now(),
      };
    } catch (err) {
      const msg = err instanceof Anthropic.APIError ? `error ${err.status ?? ""} de la API` : "sin conexión con la IA";
      return heuristicAnalysis(input, msg);
    }
  }
}
