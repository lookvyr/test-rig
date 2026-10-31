import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  applyThemeColorPreview,
  applyThemePalette,
  contextChipVariables,
  createVividThemeColors,
  EMBER_THEME,
  getStandardPaintedThemeColors,
  getThemeColorsForMode,
  GROVE_THEME,
  IRIS_THEME,
  OCEAN_THEME,
  T3_CHAT_THEME,
} from "../themePalette";
import { CONTEXT_CHIP_ACCENTS } from "./contextChipAccents";

function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) =>
    [1, 3, 5].reduce((sum, offset, index) => {
      const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
    }, 0);
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

afterEach(() => vi.unstubAllGlobals());

describe("context chip contrast", () => {
  const palettes = [T3_CHAT_THEME, GROVE_THEME, OCEAN_THEME, EMBER_THEME, IRIS_THEME];
  for (const appearance of ["light", "dark"] as const) {
    for (const theme of palettes) {
      it(`keeps every chip readable on ${theme.id} ${appearance} surfaces`, () => {
        const colors = getThemeColorsForMode(theme, appearance)!;
        const variables = contextChipVariables(colors);
        for (const kind of [...Object.keys(CONTEXT_CHIP_ACCENTS), "invalid"]) {
          const ink = variables[`--context-chip-${kind}`]!;
          for (const surface of [colors.canvas, colors.surface, colors.surfaceRaised]) {
            expect(contrastRatio(ink, surface), `${kind} on ${surface}`).toBeGreaterThanOrEqual(
              4.5,
            );
          }
          expect(
            contrastRatio(variables["--context-chip-message"] ?? ink, colors.messageSurface),
            `${kind} in a message`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    for (const redesign of [false, true]) {
      it(`covers standard ${appearance} ${redesign ? "new" : "classic"} design`, () => {
        // The standard solve covers both designs without recalculating on a beta toggle.
        const variables = contextChipVariables(getStandardPaintedThemeColors(appearance, true));
        const colors = getStandardPaintedThemeColors(appearance, redesign);
        for (const kind of Object.keys(CONTEXT_CHIP_ACCENTS)) {
          for (const surface of [
            colors.canvas,
            colors.surface,
            colors.surfaceRaised,
            colors.messageSurface,
          ]) {
            expect(
              contrastRatio(variables[`--context-chip-${kind}`]!, surface),
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  }

  it("follows the actual canvas when a custom palette inverts its appearance slot", () => {
    for (const [appearance, canvas, accent] of [
      ["light", "#111827", "#8ab4f8"],
      ["dark", "#fdf6ec", "#c2571b"],
    ] as const) {
      const colors = createVividThemeColors(appearance, canvas, accent);
      for (const ink of Object.values(contextChipVariables(colors))) {
        for (const surface of [
          colors.canvas,
          colors.surface,
          colors.surfaceRaised,
          colors.messageSurface,
        ]) {
          expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("measures translucent raised surfaces after compositing them over the canvas", () => {
    const colors = {
      ...getStandardPaintedThemeColors("dark", true),
      surface: "#fff1",
      surfaceRaised: "#ffffff10",
    };
    for (const ink of Object.values(contextChipVariables(colors))) {
      for (const surface of ["#000000", "#111111", "#101010", "#1e1e1e"]) {
        expect(contrastRatio(ink, surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("uses the message foreground for a bubble opposite to the canvas", () => {
    const colors = {
      ...getStandardPaintedThemeColors("dark", true),
      messageSurface: "#ffffff",
      messageForeground: "#181818",
    };
    const variables = contextChipVariables(colors);
    expect(variables["--context-chip-message"]).toBe(colors.messageForeground);
    expect(
      contrastRatio(variables["--context-chip-mention"]!, colors.canvas),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(variables["--context-chip-message"]!, colors.messageSurface),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("updates accents during previews and clears an inverted-bubble override on reset", () => {
    const properties = new Map<string, string>();
    const root = {
      dataset: {},
      classList: { toggle: vi.fn() },
      style: {
        setProperty: (name: string, value: string) => properties.set(name, value),
        removeProperty: (name: string) => properties.delete(name),
        getPropertyValue: (name: string) => properties.get(name) ?? "",
      },
    };
    vi.stubGlobal("document", { documentElement: root });
    const colors = {
      ...getStandardPaintedThemeColors("dark", true),
      messageSurface: "#ffffff",
      messageForeground: "#181818",
    };
    applyThemeColorPreview(colors, "dark");
    expect(properties.get("--context-chip-message")).toBe("#181818");
    const previousInk = properties.get("--context-chip-mention");
    applyThemeColorPreview({ ...colors, surface: "#" }, "dark");
    expect(properties.get("--context-chip-mention")).toBe(previousInk);

    applyThemePalette("light", "light");
    expect(properties.has("--context-chip-message")).toBe(false);
    expect(properties.get("--context-chip-mention")).not.toBe(previousInk);
    expect(properties.get("--context-chip-mention")).toBe(
      contextChipVariables(getStandardPaintedThemeColors("light", true))["--context-chip-mention"],
    );
  });
});
