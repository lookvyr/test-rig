import {
  MessageId,
  NodeId,
  ProviderSessionId,
  ProviderThreadId,
  RunAttemptId,
  RunId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { v2Projection } from "./orchestrationV2TestFixtures.ts";
import { canSendThreadFollowUp } from "./threadWorkflows.ts";

// Only steering-relevant fields vary in these projection fixtures.
function runningProjection(): OrchestrationV2ThreadProjection {
  const providerThreadId = ProviderThreadId.make("active-thread");
  const providerSessionId = ProviderSessionId.make("active-session");
  const rootNodeId = NodeId.make("root");
  const activeAttemptId = RunAttemptId.make("attempt");
  return {
    ...v2Projection,
    runs: [
      {
        id: RunId.make("run"),
        status: "running",
        providerThreadId,
        rootNodeId,
        activeAttemptId,
        userMessageId: MessageId.make("message"),
      },
    ],
    providerThreads: [{ id: providerThreadId, providerSessionId }],
    providerSessions: [
      {
        id: providerSessionId,
        status: "running",
        capabilities: {
          turns: { supportsActiveSteering: true, supportsSteeringByInterruptRestart: true },
        },
      },
    ],
    providerTurns: [
      { providerThreadId, nodeId: rootNodeId, runAttemptId: activeAttemptId, status: "running" },
    ],
  } as unknown as OrchestrationV2ThreadProjection;
}

describe("interactive thread follow-up readiness", () => {
  it("allows unknown and idle projections", () => {
    expect(canSendThreadFollowUp(null)).toBe(true);
    expect(canSendThreadFollowUp(undefined)).toBe(true);
    expect(canSendThreadFollowUp(v2Projection)).toBe(true);
    const p = runningProjection();
    expect(canSendThreadFollowUp({ ...p, runs: [{ ...p.runs[0]!, status: "queued" }] })).toBe(true);
  });
  it("allows native steering on the active root turn", () => {
    expect(canSendThreadFollowUp(runningProjection())).toBe(true);
  });
  it.each(["preparing", "starting", "waiting"] as const)("blocks an active %s run", (status) => {
    const p = runningProjection();
    expect(canSendThreadFollowUp({ ...p, runs: [{ ...p.runs[0]!, status }] })).toBe(false);
  });
  it("does not treat interrupt/restart as native steering", () => {
    const p = runningProjection();
    const session = p.providerSessions[0]!;
    expect(
      canSendThreadFollowUp({
        ...p,
        providerSessions: [
          {
            ...session,
            capabilities: {
              ...session.capabilities,
              turns: { ...session.capabilities.turns, supportsActiveSteering: false },
            },
          },
        ],
      }),
    ).toBe(false);
  });
  it.each(["starting", "stopped", "error"] as const)(
    "blocks an unavailable %s session",
    (status) => {
      const p = runningProjection();
      expect(
        canSendThreadFollowUp({ ...p, providerSessions: [{ ...p.providerSessions[0]!, status }] }),
      ).toBe(false);
    },
  );
  it("requires the active run's exact session", () => {
    const p = runningProjection();
    expect(canSendThreadFollowUp({ ...p, providerThreads: [] })).toBe(false);
    expect(
      canSendThreadFollowUp({
        ...p,
        providerThreads: [{ ...p.providerThreads[0]!, providerSessionId: null }],
      }),
    ).toBe(false);
    expect(
      canSendThreadFollowUp({
        ...p,
        providerSessions: [{ ...p.providerSessions[0]!, id: ProviderSessionId.make("unrelated") }],
      }),
    ).toBe(false);
  });
  it("requires a running provider turn on the active root and attempt", () => {
    const p = runningProjection();
    const turn = p.providerTurns[0]!;
    expect(canSendThreadFollowUp({ ...p, providerTurns: [] })).toBe(false);
    for (const replacement of [
      { ...turn, status: "completed" as const },
      { ...turn, runAttemptId: RunAttemptId.make("previous") },
      { ...turn, nodeId: NodeId.make("subagent") },
      { ...turn, providerThreadId: ProviderThreadId.make("other") },
    ])
      expect(canSendThreadFollowUp({ ...p, providerTurns: [replacement] })).toBe(false);
    expect(canSendThreadFollowUp({ ...p, runs: [{ ...p.runs[0]!, activeAttemptId: null }] })).toBe(
      false,
    );
    expect(canSendThreadFollowUp({ ...p, runs: [{ ...p.runs[0]!, rootNodeId: null }] })).toBe(
      false,
    );
  });
  it.each(["/compact", "  /LOGOUT  "])("blocks native maintenance %s", (text) => {
    const p = runningProjection();
    const withMaintenance = {
      ...p,
      messages: [{ id: p.runs[0]!.userMessageId, text, attachments: [] }],
    } as unknown as OrchestrationV2ThreadProjection;
    expect(canSendThreadFollowUp(withMaintenance)).toBe(false);
    expect(canSendThreadFollowUp({ ...withMaintenance, runs: [] })).toBe(true);
  });
});
