import { resolveDiffThemeName } from "../lib/diffRendering";
import { useClientSettings } from "./useSettings";

/** Syntax palettes follow settings directly, including before document effects run. */
export function useDiffTheme(theme: "light" | "dark") {
  const redesignEnabled = useClientSettings((settings) => settings.redesignEnabled);
  return resolveDiffThemeName(theme, redesignEnabled);
}
