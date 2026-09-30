import { describe, expect, it } from "vitest";
import {
  applyPreset,
  defaultSettings,
  PRESETS,
  SETTINGS_META,
  SettingsSchema,
  updateSettings,
} from "../src/settings.js";

describe("settings", () => {
  it("todos los presets son válidos y todas las opciones tienen explicación", () => {
    for (const name of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      expect(() => applyPreset(defaultSettings(), name)).not.toThrow();
    }
    for (const key of Object.keys(SettingsSchema.shape)) {
      const meta = SETTINGS_META[key as keyof typeof SETTINGS_META];
      expect(meta?.help.length, key).toBeGreaterThan(20);
    }
  });

  it("un cambio manual pasa el perfil a personalizado", () => {
    const s = updateSettings(defaultSettings(), { stopLossPct: 12 });
    expect(s.preset).toBe("personalizado");
    expect(updateSettings(defaultSettings(), { paused: true }).preset).toBe("equilibrado");
  });

  it("rechaza valores fuera de rango", () => {
    expect(() => updateSettings(defaultSettings(), { stopLossPct: 150 })).toThrow();
  });
});
