import { normalizePreviewUrl } from "@t3tools/shared/preview";

/** Resolve human address-bar input without changing URL-only agent or server APIs. */
export function resolvePreviewAddress(input: string): string {
  const value = input.trim();
  const host = value.split(/[/?#]/, 1)[0] ?? "";
  const hostname = host.split(":", 1)[0] ?? "";
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(value);
  const hasSchemeWithoutSlashes = /^(?:https?|about|blob|data|file|javascript|mailto|tel):/i.test(
    value,
  );
  const looksLikeHost =
    !/\s/.test(host) &&
    (host.includes("@") ||
      hostname.includes(".") ||
      hostname.toLowerCase() === "localhost" ||
      /^\[.*\](?::\d+)?$/.test(host) ||
      /^[^:]+:\d+$/.test(host));

  if (hasSchemeWithoutSlashes && !hasScheme) {
    throw new Error("Enter a full http:// or https:// address.");
  }
  if (value.length === 0 || hasScheme || looksLikeHost) {
    return normalizePreviewUrl(value);
  }
  return `https://www.google.com/search?${new URLSearchParams({ q: value })}`;
}
