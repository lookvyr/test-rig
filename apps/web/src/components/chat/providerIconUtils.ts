import { ProviderDriverKind } from "@t3tools/contracts";
import { ClaudeAI, Icon, OpenAI } from "../Icons";

export const PROVIDER_ICON_BY_PROVIDER: Partial<Record<ProviderDriverKind, Icon>> = {
  [ProviderDriverKind.make("codex")]: OpenAI,
  [ProviderDriverKind.make("claudeAgent")]: ClaudeAI,
};

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  isLegacy?: boolean | undefined;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingQualifier(value: string, qualifier: string | null | undefined): string {
  const trimmedQualifier = qualifier?.trim();
  if (!trimmedQualifier) {
    return value;
  }

  const pattern = new RegExp(`^${escapeRegExp(trimmedQualifier)}(?:\\s*[.:/-]\\s*|\\s+)`, "iu");
  return value.replace(pattern, "").trim() || value;
}

export function getDisplayModelName(
  model: ModelEsque,
  options?: { preferShortName?: boolean },
): string {
  const name = options?.preferShortName && model.shortName ? model.shortName : model.name;
  return stripLeadingQualifier(name, model.subProvider);
}

const MODEL_FAMILY_PREFIXES = ["Claude ", "GPT-", "GPT "] as const;
const MODEL_VERSION_WORD = /^v?\d+(?:\.\d+)*[a-z]?$/i;

/**
 * The composer model button's name: the provider icon beside it already says the family, so
 * "Claude Opus 5.5" reads "Opus 5.5" and "GPT-6-Sol" reads "6 Sol". A name that is only a
 * version after its family ("GPT-5.5") keeps the family. Mirrors upstream's `modelShortName`.
 */
export function getCompactModelName(model: ModelEsque): string {
  if (model.shortName) return getDisplayModelName(model, { preferShortName: true });
  const name = getDisplayModelName(model);
  const prefix = MODEL_FAMILY_PREFIXES.find((candidate) => name.startsWith(candidate));
  if (!prefix) return name;
  const rest = name.slice(prefix.length).trim();
  const namesModel = rest
    .replace(/\(.*?\)/g, " ")
    .split(/[\s-]+/)
    .some((word) => word.length > 0 && !MODEL_VERSION_WORD.test(word));
  if (!namesModel) return name;
  return /\s/.test(rest) ? rest : rest.replaceAll("-", " ");
}

export function getTriggerDisplayModelName(model: ModelEsque): string {
  return getDisplayModelName(model, { preferShortName: true });
}

export function getTriggerDisplayModelLabel(model: ModelEsque): string {
  return getTriggerDisplayModelName(model);
}
