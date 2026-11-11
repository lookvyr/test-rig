import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  ProviderThreadId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { formatClaudeResumeCompactionQuestion } from "@t3tools/shared/claudeCompaction";
import { describe, expect, it } from "vite-plus/test";

import { v2Projection } from "../test/threadFixtures";
import {
  COMPACT_COMMAND_PATTERN,
  hasDismissedResumeCompaction,
  resumeCompactionTokens,
} from "./compactBeforeSend";

type Projection = OrchestrationV2ThreadProjection;

const claude = ProviderInstanceId.make("claudeAgent");
const providerThreadId = ProviderThreadId.make("provider-thread-claude");
const reportedAt = "2026-06-20T10:00:00.000Z";
const minutesAfterReport = (minutes: number) => Date.parse(reportedAt) + minutes * 60_000;

const projectionWith = (
  overrides: {
    readonly usedTokens?: number;
    readonly promptCacheTtlMs?: number;
    readonly promptCacheExpiresAt?: string;
    readonly runs?: ReadonlyArray<Partial<Projection["runs"][number]>>;
    readonly runtimeRequests?: ReadonlyArray<Partial<Projection["runtimeRequests"][number]>>;
    readonly messageText?: string;
  } = {},
): Projection =>
  ({
    ...v2Projection,
    thread: { ...v2Projection.thread, activeProviderThreadId: providerThreadId },
    providerThreads: [{ id: providerThreadId, driver: "claudeAgent", providerInstanceId: claude }],
    providerTurns: [
      {
        providerThreadId,
        tokenUsage: {
          usedTokens: overrides.usedTokens ?? 210_000,
          updatedAt: reportedAt,
          ...(overrides.promptCacheTtlMs === undefined
            ? {}
            : { promptCacheTtlMs: overrides.promptCacheTtlMs }),
          ...(overrides.promptCacheExpiresAt === undefined
            ? {}
            : { promptCacheExpiresAt: overrides.promptCacheExpiresAt }),
        },
      },
    ],
    runs: overrides.runs ?? [{ status: "completed" }],
    runtimeRequests: overrides.runtimeRequests ?? [],
    messages: [{ role: "user", text: overrides.messageText ?? "Fix the build", attachments: [] }],
  }) as unknown as Projection;

const offer = (
  projection: Projection,
  options: {
    readonly nowMs?: number;
    readonly dismissed?: boolean;
    readonly instanceId?: ProviderInstanceId;
    readonly settings?: Partial<typeof DEFAULT_SERVER_SETTINGS>;
  } = {},
) =>
  resumeCompactionTokens({
    projection,
    selection: { instanceId: options.instanceId ?? claude, model: "claude-opus-4-8" },
    settings: { ...DEFAULT_SERVER_SETTINGS, ...options.settings },
    dismissed: options.dismissed ?? false,
    nowMs: options.nowMs ?? minutesAfterReport(90),
  });

describe("resumeCompactionTokens", () => {
  it("offers to compact a large Claude thread once its prompt cache has expired", () => {
    expect(offer(projectionWith())).toBe(210_000);
    expect(offer(projectionWith(), { nowMs: minutesAfterReport(30) })).toBeNull();
  });

  it("follows the cache lifetime Claude reported", () => {
    const fiveMinute = projectionWith({ promptCacheTtlMs: 5 * 60_000 });
    expect(offer(fiveMinute, { nowMs: minutesAfterReport(4) })).toBeNull();
    expect(offer(fiveMinute, { nowMs: minutesAfterReport(5) })).toBe(210_000);

    const expiresAt = projectionWith({ promptCacheExpiresAt: "2026-06-20T10:03:00.000Z" });
    expect(offer(expiresAt, { nowMs: minutesAfterReport(2) })).toBeNull();
    expect(offer(expiresAt, { nowMs: minutesAfterReport(3) })).toBe(210_000);
  });

  it("stays out of the way when compacting would not help or cannot run", () => {
    expect(offer(projectionWith({ usedTokens: 150_000 }))).toBeNull();
    expect(offer(projectionWith({ runs: [{ status: "running" }] }))).toBeNull();
    expect(offer(projectionWith({ runs: [{ status: "queued", queueHeld: true }] }))).toBeNull();
    expect(offer(projectionWith({ runtimeRequests: [{ status: "pending" }] }))).toBeNull();
    // Nothing but a compaction so far: there is no conversation to shrink.
    expect(offer(projectionWith({ messageText: "/compact" }))).toBeNull();
  });

  it("does not compact a session the send would hand off from", () => {
    expect(offer(projectionWith(), { instanceId: ProviderInstanceId.make("codex") })).toBeNull();
  });

  it("respects Never and Don't ask again", () => {
    expect(offer(projectionWith(), { settings: { compactIdleThreads: "off" } })).toBeNull();
    expect(
      offer(projectionWith(), { settings: { compactIdleThreads: "beforeCacheExpires" } }),
    ).toBe(210_000);
    expect(offer(projectionWith(), { dismissed: true })).toBeNull();
    const question = formatClaudeResumeCompactionQuestion({
      ageMinutes: 75,
      estimatedTokens: 210_000,
    });
    expect(
      offer(
        projectionWith({
          runtimeRequests: [
            {
              kind: "user_input",
              status: "resolved",
              answers: { [question]: "Don't ask again" },
            },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("hasDismissedResumeCompaction", () => {
  it("only counts Claude's resume question answered Don't ask again", () => {
    const question = formatClaudeResumeCompactionQuestion({ ageMinutes: 5, estimatedTokens: 1 });
    const resolved = (answers: Record<string, unknown>) =>
      [
        { kind: "user_input", status: "resolved", answers },
      ] as unknown as Projection["runtimeRequests"];
    expect(hasDismissedResumeCompaction(resolved({ [question]: ["Don't ask again"] }))).toBe(true);
    expect(hasDismissedResumeCompaction(resolved({ [question]: "Keep full history" }))).toBe(false);
    expect(hasDismissedResumeCompaction(resolved({ "Pick one": "Don't ask again" }))).toBe(false);
  });
});

describe("COMPACT_COMMAND_PATTERN", () => {
  it("matches /compact with or without instructions", () => {
    expect(COMPACT_COMMAND_PATTERN.test("/compact")).toBe(true);
    expect(COMPACT_COMMAND_PATTERN.test("/compact keep the API notes")).toBe(true);
    expect(COMPACT_COMMAND_PATTERN.test("/compaction")).toBe(false);
  });
});
