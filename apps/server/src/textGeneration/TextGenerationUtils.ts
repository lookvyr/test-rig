import { TextGenerationError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isTextGenerationError = Schema.is(TextGenerationError);
const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/** Convert an Effect Schema to a flat JSON Schema object, inlining `$defs` when present. */
export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return { ...document.schema, $defs: document.definitions };
  }
  return document.schema;
}

/** Truncate a text section to `maxChars`, appending a `[truncated]` marker when needed. */
export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

/** Normalise a raw commit subject to imperative-mood, ≤72 chars, no trailing period. */
export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

/** Normalise a raw PR title to a single line with a sensible fallback. */
export function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

/**
 * Normalize a generated PR body before it crosses into a source-control CLI.
 *
 * Structured-output models occasionally serialize the requested `{ title,
 * body }` object a second time inside the `body` string. The outer response is
 * schema-valid, so without this boundary check the JSON envelope becomes the
 * literal PR description. Only unwrap the exact response shape we requested;
 * arbitrary JSON in a legitimate markdown body is preserved.
 */
export function sanitizePrBody(raw: string, expectedTitle: string): string {
  const trimmed = raw.trim();
  const fenced = /^```json\s*\r?\n([\s\S]*?)\r?\n```$/iu.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  try {
    const parsed = decodeUnknownJson(candidate);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return trimmed;
    }

    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    const body = record.body;
    const title = record.title;
    if (
      typeof body !== "string" ||
      typeof title !== "string" ||
      title.trim() !== expectedTitle.trim() ||
      keys.length !== 2 ||
      !keys.every((key) => key === "title" || key === "body")
    ) {
      return trimmed;
    }

    return body.trim();
  } catch {
    return trimmed;
  }
}

/** Normalise a raw thread title to a compact single-line sidebar-safe label. */
export function sanitizeThreadTitle(raw: string): string {
  const normalized = raw
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized.trim().length === 0) {
    return "New thread";
  }

  if (normalized.length <= 50) {
    return normalized;
  }

  return `${normalized.slice(0, 47).trimEnd()}...`;
}

/** CLI name to human-readable label, e.g. "codex" → "Codex CLI (`codex`)" */
function cliLabel(cliName: string): string {
  const capitalized = cliName.charAt(0).toUpperCase() + cliName.slice(1);
  return `${capitalized} CLI (\`${cliName}\`)`;
}

/**
 * Normalize an unknown error from a CLI text generation process into a
 * typed `TextGenerationError`. Parameterized by CLI name so both Codex
 * and Claude (and future providers) can share the same logic.
 */
export function normalizeCliError(
  cliName: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (isTextGenerationError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${cliName}`) ||
      lower.includes(`spawn ${cliName}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `${cliLabel(cliName)} is required but not available on PATH.`,
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: fallback,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}
