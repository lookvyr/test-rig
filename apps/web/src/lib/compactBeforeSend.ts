import {
  isCompactionCommandMessage,
  resolveIdleCompaction,
  type ModelSelection,
  type OrchestrationV2ThreadProjection,
  type ServerSettings,
} from "@t3tools/contracts";
import {
  CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
  COMPACTION_SUGGESTION_MIN_TOKENS,
  isClaudeResumeCompactionQuestion,
} from "@t3tools/shared/claudeCompaction";

/** `/compact` with or without instructions. Sending one never compacts first. */
export const COMPACT_COMMAND_PATTERN = /^\/compact(?:\s|$)/i;

// Used when Claude did not report its cache lifetime: its 1h cache plus slack.
const CLAUDE_RESUME_COMPACTION_FALLBACK_MS = 70 * 60_000;

const BUSY_RUN_STATUSES = new Set<OrchestrationV2ThreadProjection["runs"][number]["status"]>([
  "queued",
  "preparing",
  "starting",
  "running",
  "waiting",
]);

/** The user answered Claude's own "compact before continuing?" question with "Don't ask again". */
export function hasDismissedResumeCompaction(
  requests: OrchestrationV2ThreadProjection["runtimeRequests"],
): boolean {
  return requests.some(
    (request) =>
      request.kind === "user_input" &&
      request.status === "resolved" &&
      request.answers !== undefined &&
      Object.entries(request.answers).some(
        ([question, answer]) =>
          isClaudeResumeCompactionQuestion(question) &&
          (Array.isArray(answer) ? answer : [answer]).includes(
            CLAUDE_RESUME_COMPACTION_NEVER_ANSWER,
          ),
      ),
  );
}

/**
 * Tokens of history the next send compacts first, or null when it sends as usual.
 *
 * A Claude thread whose prompt cache has expired re-reads its whole history
 * uncached on the next turn. Unless idle compaction is off, the composer
 * offers to compact it first. A send that switches provider starts the other
 * one fresh, so only the session the message would resume counts.
 */
export function resumeCompactionTokens(input: {
  readonly projection: OrchestrationV2ThreadProjection | null | undefined;
  readonly selection: ModelSelection | null | undefined;
  readonly settings: Pick<ServerSettings, "providerInstances" | "providers" | "compactIdleThreads">;
  /** Claude's question was answered "Don't ask again" in this or an earlier thread. */
  readonly dismissed: boolean;
  readonly nowMs: number;
}): number | null {
  const { projection, selection } = input;
  if (projection == null || selection == null || input.dismissed) return null;
  if (resolveIdleCompaction(input.settings, selection.instanceId) === "off") return null;
  const providerThread = projection.providerThreads.find(
    (thread) => thread.id === projection.thread.activeProviderThreadId,
  );
  if (
    providerThread === undefined ||
    providerThread.driver !== "claudeAgent" ||
    providerThread.providerInstanceId !== selection.instanceId
  ) {
    return null;
  }
  if (
    projection.runs.some((run) => BUSY_RUN_STATUSES.has(run.status)) ||
    projection.runtimeRequests.some((request) => request.status === "pending") ||
    hasDismissedResumeCompaction(projection.runtimeRequests) ||
    !projection.messages.some(
      (message) => message.role === "user" && !isCompactionCommandMessage(message),
    )
  ) {
    return null;
  }
  const usage = projection.providerTurns
    .filter((turn) => turn.providerThreadId === providerThread.id)
    .map((turn) => turn.tokenUsage)
    .filter((tokenUsage) => tokenUsage !== undefined)
    .reduce<(typeof projection.providerTurns)[number]["tokenUsage"]>(
      (latest, tokenUsage) =>
        latest === undefined || Date.parse(tokenUsage.updatedAt) >= Date.parse(latest.updatedAt)
          ? tokenUsage
          : latest,
      undefined,
    );
  if (usage === undefined || usage.usedTokens < COMPACTION_SUGGESTION_MIN_TOKENS) return null;
  const expiresAtMs =
    usage.promptCacheExpiresAt !== undefined
      ? Date.parse(usage.promptCacheExpiresAt)
      : Date.parse(usage.updatedAt) +
        (usage.promptCacheTtlMs ?? CLAUDE_RESUME_COMPACTION_FALLBACK_MS);
  if (!Number.isFinite(expiresAtMs) || input.nowMs < expiresAtMs) return null;
  return usage.usedTokens;
}
