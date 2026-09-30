import { z } from "zod";

/**
 * Estrategia del bot. Se edita en caliente desde el dashboard y se guarda en
 * data/settings.json. `SETTINGS_META` es la única fuente de las etiquetas y
 * explicaciones que muestra la interfaz al pasar el puntero.
 */
export const PRESET_NAMES = ["conservador", "equilibrado", "agresivo"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export const SettingsSchema = z.object({
  // --- Modo ---
  preset: z.enum([...PRESET_NAMES, "personalizado"]),
  autoPilot: z.boolean(),
  paused: z.boolean(),

  // --- Capital y tamaño ---
  paperStartSol: z.number().positive().max(1_000_000),
  sizeMode: z.enum(["fixed", "percentOfLeader", "percentOfCapital"]),
  tradeSizeSol: z.number().positive(),
  sizePercent: z.number().positive().max(100),
  maxBuySol: z.number().positive(),

  // --- Riesgo ---
  maxOpenPositions: z.number().int().min(1).max(100),
  maxDailyLossSol: z.number().positive(),
  stopLossPct: z.number().min(0).max(100),
  takeProfitPct: z.number().min(0).max(10_000),
  trailingStopPct: z.number().min(0).max(100),
  maxHoldMinutes: z.number().min(0),
  slippageBps: z.number().int().min(0).max(5_000),

  // --- Filtros de entrada ---
  copySells: z.boolean(),
  aiGate: z.boolean(),
  minLiquidityUsd: z.number().min(0),
  skipBondingCurve: z.boolean(),
  maxSignalAgeSec: z.number().int().min(5),

  // --- Selección de billeteras ---
  copyTopN: z.number().int().min(1).max(50),
  minClosedTrades: z.number().int().min(1),
  minWinRatePct: z.number().min(0).max(100),
  minPnlSol: z.number(),
  maxConcentrationPct: z.number().min(0).max(100),
  minMedianHoldSec: z.number().min(0),
  maxInactiveDays: z.number().min(0),
  discoveryWindow: z.enum(["today", "1W", "30d"]),
  rediscoverMinutes: z.number().int().min(5),
  pollSeconds: z.number().int().min(5).max(600),
});

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

type PresetValues = Omit<Settings, "preset" | "autoPilot" | "paused" | "paperStartSol">;

export const PRESETS: Record<PresetName, PresetValues> = {
  conservador: {
    sizeMode: "percentOfCapital",
    tradeSizeSol: 0.1,
    sizePercent: 1.5,
    maxBuySol: 0.25,
    maxOpenPositions: 4,
    maxDailyLossSol: 0.5,
    stopLossPct: 20,
    takeProfitPct: 60,
    trailingStopPct: 15,
    maxHoldMinutes: 720,
    slippageBps: 100,
    copySells: true,
    aiGate: true,
    minLiquidityUsd: 50_000,
    skipBondingCurve: true,
    maxSignalAgeSec: 60,
    copyTopN: 3,
    minClosedTrades: 15,
    minWinRatePct: 55,
    minPnlSol: 5,
    maxConcentrationPct: 50,
    minMedianHoldSec: 300,
    maxInactiveDays: 3,
    discoveryWindow: "30d",
    rediscoverMinutes: 60,
    pollSeconds: 20,
  },
  equilibrado: {
    sizeMode: "percentOfCapital",
    tradeSizeSol: 0.25,
    sizePercent: 2.5,
    maxBuySol: 0.5,
    maxOpenPositions: 8,
    maxDailyLossSol: 1,
    stopLossPct: 30,
    takeProfitPct: 100,
    trailingStopPct: 20,
    maxHoldMinutes: 1440,
    slippageBps: 150,
    copySells: true,
    aiGate: false,
    minLiquidityUsd: 20_000,
    skipBondingCurve: true,
    maxSignalAgeSec: 90,
    copyTopN: 5,
    minClosedTrades: 10,
    minWinRatePct: 45,
    minPnlSol: 2,
    maxConcentrationPct: 65,
    minMedianHoldSec: 120,
    maxInactiveDays: 7,
    discoveryWindow: "1W",
    rediscoverMinutes: 45,
    pollSeconds: 15,
  },
  agresivo: {
    sizeMode: "percentOfCapital",
    tradeSizeSol: 0.5,
    sizePercent: 5,
    maxBuySol: 1.5,
    maxOpenPositions: 15,
    maxDailyLossSol: 3,
    stopLossPct: 40,
    takeProfitPct: 200,
    trailingStopPct: 25,
    maxHoldMinutes: 0,
    slippageBps: 300,
    copySells: true,
    aiGate: false,
    minLiquidityUsd: 5_000,
    skipBondingCurve: false,
    maxSignalAgeSec: 180,
    copyTopN: 10,
    minClosedTrades: 6,
    minWinRatePct: 35,
    minPnlSol: 1,
    maxConcentrationPct: 80,
    minMedianHoldSec: 30,
    maxInactiveDays: 14,
    discoveryWindow: "1W",
    rediscoverMinutes: 30,
    pollSeconds: 10,
  },
};

export function defaultSettings(): Settings {
  return { preset: "equilibrado", autoPilot: true, paused: false, paperStartSol: 10, ...PRESETS.equilibrado };
}

export function applyPreset(current: Settings, name: PresetName): Settings {
  return SettingsSchema.parse({ ...current, ...PRESETS[name], preset: name });
}

/**
 * Aplica cambios manuales. Tocar cualquier valor de estrategia pasa el preset
 * a "personalizado" para que quede claro que ya no es el perfil original.
 */
export function updateSettings(current: Settings, patch: Partial<Settings>): Settings {
  const next = SettingsSchema.parse({ ...current, ...patch });
  const strategyKeys = Object.keys(patch).filter((k) => !["preset", "autoPilot", "paused", "paperStartSol"].includes(k));
  if (patch.preset === undefined && strategyKeys.length > 0 && next.preset !== "personalizado") {
    const base = PRESETS[next.preset as PresetName];
    const changed = strategyKeys.some((k) => base[k as keyof PresetValues] !== next[k as keyof Settings]);
    if (changed) next.preset = "personalizado";
  }
  return next;
}

/** Tamaño de compra en SOL para una señal, respetando el máximo por compra. */
export function buySizeSol(s: Settings, leaderSolAmount: number, equitySol: number): number {
  const raw =
    s.sizeMode === "fixed"
      ? s.tradeSizeSol
      : s.sizeMode === "percentOfLeader"
        ? (leaderSolAmount * s.sizePercent) / 100
        : (equitySol * s.sizePercent) / 100;
  return Math.max(0, Math.min(raw, s.maxBuySol));
}

export interface SettingMeta {
  label: string;
  help: string;
  group: "modo" | "tamaño" | "riesgo" | "filtros" | "billeteras";
  level: "basic" | "advanced";
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
}

export const SETTINGS_META: Record<SettingKey, SettingMeta> = {
  preset: {
    label: "Perfil",
    help: "Conjunto de valores recomendados. Conservador arriesga poco y exige billeteras muy probadas; Agresivo copia más billeteras con posiciones mayores. Si cambias un valor a mano pasa a Personalizado.",
    group: "modo",
    level: "basic",
  },
  autoPilot: {
    label: "Piloto automático",
    help: "El bot elige solo las mejores billeteras y ajusta el perfil según el resultado del día: si pierdes más de la mitad del límite diario baja a Conservador, y vuelve a tu perfil al día siguiente.",
    group: "modo",
    level: "basic",
  },
  paused: {
    label: "Pausado",
    help: "Detiene nuevas compras. Las posiciones abiertas siguen vigiladas por stop loss y take profit.",
    group: "modo",
    level: "basic",
  },
  paperStartSol: {
    label: "Capital simulado",
    help: "SOL virtuales con los que empieza la cartera en modo papel. Cambiarlo no reinicia la cartera: usa Reiniciar cartera para empezar de cero.",
    group: "tamaño",
    level: "basic",
    unit: "SOL",
    min: 0.1,
    step: 0.1,
  },
  sizeMode: {
    label: "Cómo calcular cada compra",
    help: "Fijo: siempre la misma cantidad de SOL. % del líder: una fracción de lo que compró el trader copiado. % del capital: una fracción de tu cartera, crece o baja con tus resultados.",
    group: "tamaño",
    level: "basic",
    options: [
      { value: "fixed", label: "Cantidad fija" },
      { value: "percentOfLeader", label: "% de lo que compra el líder" },
      { value: "percentOfCapital", label: "% de mi capital" },
    ],
  },
  tradeSizeSol: {
    label: "Compra fija",
    help: "SOL por operación cuando el modo es Cantidad fija.",
    group: "tamaño",
    level: "basic",
    unit: "SOL",
    min: 0.01,
    step: 0.01,
  },
  sizePercent: {
    label: "Porcentaje",
    help: "Porcentaje usado por los modos % del líder y % del capital. Los profesionales rara vez arriesgan más del 2 al 5 % del capital por operación.",
    group: "tamaño",
    level: "basic",
    unit: "%",
    min: 0.1,
    max: 100,
    step: 0.1,
  },
  maxBuySol: {
    label: "Máximo por compra",
    help: "Tope de SOL para una sola compra, sea cual sea el modo. Evita que un líder que compra mucho te haga entrar demasiado grande.",
    group: "tamaño",
    level: "advanced",
    unit: "SOL",
    min: 0.01,
    step: 0.01,
  },
  maxOpenPositions: {
    label: "Posiciones abiertas máx.",
    help: "Cuántos tokens distintos puedes tener a la vez. Limita la exposición total.",
    group: "riesgo",
    level: "basic",
    min: 1,
    max: 100,
    step: 1,
  },
  maxDailyLossSol: {
    label: "Pérdida diaria máx.",
    help: "Si las pérdidas realizadas del día llegan a este valor, el bot deja de abrir posiciones hasta mañana (hora UTC).",
    group: "riesgo",
    level: "basic",
    unit: "SOL",
    min: 0.01,
    step: 0.01,
  },
  stopLossPct: {
    label: "Stop loss",
    help: "Vende automáticamente si la posición cae este porcentaje desde la entrada. 0 lo desactiva.",
    group: "riesgo",
    level: "basic",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
  },
  takeProfitPct: {
    label: "Take profit",
    help: "Vende automáticamente si la posición sube este porcentaje. 0 lo desactiva y deja que salgas cuando salga el líder.",
    group: "riesgo",
    level: "basic",
    unit: "%",
    min: 0,
    step: 5,
  },
  trailingStopPct: {
    label: "Trailing stop",
    help: "Protege ganancias: si el precio cae este porcentaje desde el máximo alcanzado mientras estás en ganancia, vende. 0 lo desactiva.",
    group: "riesgo",
    level: "advanced",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
  },
  maxHoldMinutes: {
    label: "Tiempo máximo en posición",
    help: "Cierra la posición pasado este tiempo aunque el líder no haya vendido. 0 lo desactiva.",
    group: "riesgo",
    level: "advanced",
    unit: "min",
    min: 0,
    step: 10,
  },
  slippageBps: {
    label: "Deslizamiento simulado",
    help: "Cuánto peor que el líder se asume que entras y sales (100 bps = 1 %). Copiar llega segundos tarde, así que un valor realista evita resultados de papel demasiado optimistas.",
    group: "riesgo",
    level: "advanced",
    unit: "bps",
    min: 0,
    max: 5000,
    step: 10,
  },
  copySells: {
    label: "Copiar ventas",
    help: "Cuando el líder vende, vendes la misma proporción de tu posición.",
    group: "filtros",
    level: "basic",
  },
  aiGate: {
    label: "La IA decide las entradas",
    help: "Solo se copia una compra si el análisis de IA la aprueba. Sin clave de Anthropic se usa un análisis por reglas.",
    group: "filtros",
    level: "basic",
  },
  minLiquidityUsd: {
    label: "Liquidez mínima",
    help: "No compra tokens con menos liquidez que esto (en USD, según Jupiter). Poca liquidez significa que es difícil salir sin mover el precio.",
    group: "filtros",
    level: "advanced",
    unit: "USD",
    min: 0,
    step: 1000,
  },
  skipBondingCurve: {
    label: "Evitar tokens en bonding curve",
    help: "Ignora compras hechas en launchpads (por ejemplo pump.fun) antes de que el token migre a un DEX. Son las más arriesgadas.",
    group: "filtros",
    level: "advanced",
  },
  maxSignalAgeSec: {
    label: "Antigüedad máx. de la señal",
    help: "Si detectas la compra del líder más tarde que esto, no la copias: el precio probablemente ya se movió.",
    group: "filtros",
    level: "advanced",
    unit: "s",
    min: 5,
    step: 5,
  },
  copyTopN: {
    label: "Billeteras a copiar",
    help: "Cuántas de las mejor puntuadas copiar. Se recomienda empezar con 2 o 3 y ampliar cuando veas resultados.",
    group: "billeteras",
    level: "basic",
    min: 1,
    max: 50,
    step: 1,
  },
  minClosedTrades: {
    label: "Operaciones cerradas mín.",
    help: "Descarta billeteras con pocas operaciones: con 3 aciertos cualquiera parece un genio.",
    group: "billeteras",
    level: "advanced",
    min: 1,
    step: 1,
  },
  minWinRatePct: {
    label: "Tasa de acierto mín.",
    help: "Porcentaje mínimo de operaciones cerradas con ganancia. Valores realistas y sostenibles están entre 40 y 70 %.",
    group: "billeteras",
    level: "advanced",
    unit: "%",
    min: 0,
    max: 100,
    step: 1,
  },
  minPnlSol: {
    label: "Ganancia realizada mín.",
    help: "SOL ganados (realizados) mínimos en el historial analizado.",
    group: "billeteras",
    level: "advanced",
    unit: "SOL",
    step: 0.5,
  },
  maxConcentrationPct: {
    label: "Concentración máx. de ganancias",
    help: "Qué parte de la ganancia puede venir de sus 2 mejores operaciones. Si casi todo viene de 1 o 2 golpes de suerte, no es un patrón copiable.",
    group: "billeteras",
    level: "advanced",
    unit: "%",
    min: 0,
    max: 100,
    step: 5,
  },
  minMedianHoldSec: {
    label: "Tiempo de tenencia mín.",
    help: "Descarta scalpers que entran y salen en segundos: al copiarlos llegas tarde y terminas siendo su liquidez de salida.",
    group: "billeteras",
    level: "advanced",
    unit: "s",
    min: 0,
    step: 10,
  },
  maxInactiveDays: {
    label: "Inactividad máx.",
    help: "Descarta billeteras que no operan desde hace más de estos días.",
    group: "billeteras",
    level: "advanced",
    unit: "días",
    min: 0,
    step: 1,
  },
  discoveryWindow: {
    label: "Ventana de búsqueda",
    help: "Periodo del ranking de Birdeye usado para encontrar candidatas: hoy, 7 días o 30 días. Ventanas largas favorecen la constancia.",
    group: "billeteras",
    level: "advanced",
    options: [
      { value: "today", label: "Hoy" },
      { value: "1W", label: "7 días" },
      { value: "30d", label: "30 días" },
    ],
  },
  rediscoverMinutes: {
    label: "Re-evaluar billeteras cada",
    help: "Cada cuánto se recalcula el ranking. Las billeteras se desgastan: la que ganó el mes pasado puede no ganar este.",
    group: "billeteras",
    level: "advanced",
    unit: "min",
    min: 5,
    step: 5,
  },
  pollSeconds: {
    label: "Revisar operaciones cada",
    help: "Frecuencia con la que se consultan las nuevas operaciones de las billeteras copiadas. Más rápido consume más créditos de la API.",
    group: "billeteras",
    level: "advanced",
    unit: "s",
    min: 5,
    max: 600,
    step: 5,
  },
};
