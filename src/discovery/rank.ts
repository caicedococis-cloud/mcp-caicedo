import type { Settings } from "../settings.js";
import type { RankedWallet, WalletStats } from "../types.js";

/**
 * Puntuación de 0 a 100 que combina lo que buscan los traders profesionales al
 * elegir a quién copiar:
 * - ROI realizado (30 %), acotado para que un solo golpe no domine.
 * - Tasa de acierto (25 %).
 * - Constancia: poca concentración en 1-2 operaciones (20 %).
 * - Muestra suficiente de operaciones cerradas (15 %).
 * - Forma reciente: ganancia en los últimos 7 días (10 %).
 */
export function scoreWallet(s: WalletStats): number {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const roi = clamp(s.roi / 2); // ROI del 200 % o más puntúa completo
  const win = clamp(s.winRate);
  const consistency = clamp(1 - s.concentration);
  const sample = clamp(Math.log10(1 + s.closedTrades) / Math.log10(51)); // 50 operaciones = completo
  const recent = s.recentPnlSol > 0 ? 1 : s.recentPnlSol === 0 ? 0.5 : 0;
  const score = 100 * (0.3 * roi + 0.25 * win + 0.2 * consistency + 0.15 * sample + 0.1 * recent);
  return s.realizedPnlSol > 0 ? Math.round(score * 10) / 10 : 0;
}

export function eligibilityFlags(s: WalletStats, cfg: Settings, now = Date.now() / 1000): string[] {
  const flags: string[] = [];
  if (s.realizedPnlSol < cfg.minPnlSol) flags.push(`Ganancia ${s.realizedPnlSol.toFixed(2)} SOL < ${cfg.minPnlSol}`);
  if (s.closedTrades < cfg.minClosedTrades) flags.push(`Solo ${s.closedTrades} operaciones cerradas`);
  if (s.winRate * 100 < cfg.minWinRatePct) flags.push(`Acierto ${(s.winRate * 100).toFixed(0)} % < ${cfg.minWinRatePct} %`);
  if (s.concentration * 100 > cfg.maxConcentrationPct)
    flags.push(`${(s.concentration * 100).toFixed(0)} % de la ganancia viene de 2 operaciones`);
  if (s.closedTrades > 0 && s.medianHoldSec < cfg.minMedianHoldSec)
    flags.push(`Scalper: mantiene ${Math.round(s.medianHoldSec)} s de mediana`);
  if (cfg.maxInactiveDays > 0 && now - s.lastSeen > cfg.maxInactiveDays * 86_400)
    flags.push(`Inactiva hace ${Math.floor((now - s.lastSeen) / 86_400)} días`);
  return flags;
}

export function rankWallets(
  stats: { stats: WalletStats; origin: string }[],
  cfg: Settings,
  now = Date.now() / 1000,
): RankedWallet[] {
  return stats
    .map(({ stats: s, origin }) => {
      const flags = eligibilityFlags(s, cfg, now);
      return { ...s, origin, score: scoreWallet(s), flags, eligible: flags.length === 0 };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}
