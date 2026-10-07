import type { EnvironmentId, PreviewRuntime } from "@t3tools/contracts";
import { readEnvironmentSupportsServerBrowser } from "~/state/entities";
export function previewRuntimeFor(environmentId: EnvironmentId): PreviewRuntime | undefined {
  if (typeof window !== "undefined" && window.desktopBridge?.preview) return undefined;
  return readEnvironmentSupportsServerBrowser(environmentId) ? "server" : undefined;
}
