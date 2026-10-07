import { assert, describe, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import type { ProviderReplayTranscript } from "@t3tools/contracts";
import * as CodexReplay from "effect-codex-app-server/replay";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ORCHESTRATOR_REPLAY_FIXTURES } from "./fixtures/index.ts";
import { readProviderReplayTranscript } from "./ReplayTranscriptNdjson.ts";

const PROVIDER_THREAD_RESUME_FIRST_FINAL = "provider thread resume fixture first turn complete";
const PROVIDER_THREAD_RESUME_SECOND_FINAL = "provider thread resume fixture second turn complete";

type ProtocolReplayEntry = Extract<
  ProviderReplayTranscript["entries"][number],
  { readonly type: "expect_outbound" | "emit_inbound" }
>;

interface CodexReplayFixtureRegistration {
  readonly registrationScenario: string;
  readonly recordedScenario: string;
  readonly transcriptFile: URL;
}

const CODEX_REPLAY_FIXTURE_REGISTRATIONS = ORCHESTRATOR_REPLAY_FIXTURES.flatMap((fixture) =>
  fixture.providers
    .filter((provider) => provider.driver === "codex")
    .map((provider) => ({
      registrationScenario: fixture.name,
      recordedScenario: provider.recordedScenario ?? fixture.name,
      transcriptFile: provider.transcriptFile,
    })),
).concat([
  {
    registrationScenario: "provider_thread_resume",
    recordedScenario: "provider_thread_resume",
    transcriptFile: new URL(
      "./fixtures/provider_thread_resume/codex_transcript.ndjson",
      import.meta.url,
    ),
  },
  // Rewind is excluded from command replay; its captured native history remains readable.
  ...["thread_rollback", "thread_rollback_after_restart", "thread_rollback_to_stopped_turn"].map(
    (scenario) => ({
      registrationScenario: scenario,
      recordedScenario: scenario,
      transcriptFile: new URL(`./fixtures/${scenario}/codex_transcript.ndjson`, import.meta.url),
    }),
  ),
]);

function uniqueCanonicalTranscripts(
  registrations: ReadonlyArray<CodexReplayFixtureRegistration>,
): ReadonlyArray<CodexReplayFixtureRegistration> {
  const canonicalTranscripts = new Map<string, CodexReplayFixtureRegistration>();
  for (const registration of registrations) {
    const canonicalUrl = registration.transcriptFile.href;
    const existing = canonicalTranscripts.get(canonicalUrl);
    if (existing !== undefined && existing.recordedScenario !== registration.recordedScenario) {
      throw new Error(
        `Codex replay transcript ${canonicalUrl} has conflicting recorded scenarios ${existing.recordedScenario} (${existing.registrationScenario}) and ${registration.recordedScenario} (${registration.registrationScenario}).`,
      );
    }
    canonicalTranscripts.set(canonicalUrl, existing ?? registration);
  }
  return Array.from(canonicalTranscripts.values());
}

const CODEX_REPLAY_TRANSCRIPTS = uniqueCanonicalTranscripts(CODEX_REPLAY_FIXTURE_REGISTRATIONS);

const scenarioExpectations = {
  simple: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["thread/started", "turn/started", "turn/completed"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
  tool_call_read_only_on_request: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["item/commandExecution/requestApproval", "serverRequest/resolved", "turn/completed"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 1,
  },
  tool_call_workspace_never: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/completed"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
  tool_call_restricted_granular: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["item/fileChange/requestApproval", "serverRequest/resolved", "turn/completed"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 1,
  },
  subagent: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "turn/completed", "item/agentMessage/delta"],
    turnStartCount: 1,
    turnCompletedCount: 3,
    approvalRequestCount: 0,
  },
  subagent_continue: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "item/completed", "turn/completed"],
    turnStartCount: 2,
    turnCompletedCount: 4,
    approvalRequestCount: 0,
  },
  subagent_v2: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "item/completed", "item/agentMessage/delta", "turn/completed"],
    turnStartCount: 1,
    turnCompletedCount: 2,
    approvalRequestCount: 0,
  },
  subagent_v2_approval: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: [
      "item/commandExecution/requestApproval",
      "serverRequest/resolved",
      "item/completed",
      "turn/completed",
    ],
    turnStartCount: 1,
    turnCompletedCount: 2,
    approvalRequestCount: 1,
  },
  subagent_v2_nested: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "item/completed", "item/agentMessage/delta", "turn/completed"],
    turnStartCount: 1,
    turnCompletedCount: 4,
    approvalRequestCount: 0,
  },
  subagent_v2_nested_approval: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: [
      "item/commandExecution/requestApproval",
      "serverRequest/resolved",
      "item/completed",
      "turn/completed",
    ],
    turnStartCount: 1,
    turnCompletedCount: 3,
    approvalRequestCount: 1,
  },
  multi_turn: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "turn/completed", "item/agentMessage/delta"],
    turnStartCount: 2,
    turnCompletedCount: 2,
    approvalRequestCount: 0,
  },
  plan_questions: {
    outgoing: [
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "item/tool/requestUserInput",
    ],
    incoming: [
      "turn/started",
      "turn/completed",
      "item/tool/requestUserInput",
      "serverRequest/resolved",
      "item/agentMessage/delta",
    ],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
  proposed_plan: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "turn/completed", "item/plan/delta"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
  provider_thread_resume: {
    outgoing: ["initialize", "initialized", "thread/start", "thread/resume", "turn/start"],
    incoming: ["thread/started", "turn/started", "turn/completed", "item/agentMessage/delta"],
    turnStartCount: 2,
    turnCompletedCount: 2,
    approvalRequestCount: 0,
  },
  queued_turn: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "turn/completed", "item/agentMessage/delta"],
    turnStartCount: 2,
    turnCompletedCount: 2,
    approvalRequestCount: 0,
  },
  message_steering: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start", "turn/steer"],
    incoming: ["turn/started", "turn/completed", "item/agentMessage/delta"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
  turn_interrupt: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start", "turn/interrupt"],
    incoming: ["turn/started", "turn/completed"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
  turn_interrupt_mid_tool: {
    outgoing: [
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "turn/interrupt",
      "thread/backgroundTerminals/terminate",
    ],
    incoming: ["turn/started", "item/started", "turn/completed"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
  thread_rollback: {
    outgoing: [
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "thread/read",
      "thread/turns/list",
      "thread/revert",
    ],
    incoming: ["turn/started", "turn/completed", "item/agentMessage/delta"],
    turnStartCount: 3,
    turnCompletedCount: 3,
    approvalRequestCount: 0,
  },
  thread_rollback_after_restart: {
    outgoing: [
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "thread/read",
      "thread/resume",
      "thread/turns/list",
      "thread/revert",
    ],
    incoming: ["turn/started", "turn/completed", "item/agentMessage/delta", "thread/reverted"],
    turnStartCount: 3,
    turnCompletedCount: 3,
    approvalRequestCount: 0,
  },
  thread_rollback_to_stopped_turn: {
    outgoing: [
      "initialize",
      "initialized",
      "thread/start",
      "turn/start",
      "turn/interrupt",
      "thread/backgroundTerminals/terminate",
      "thread/read",
      "thread/turns/list",
      "thread/revert",
    ],
    incoming: ["turn/started", "item/started", "turn/completed", "thread/reverted"],
    turnStartCount: 4,
    turnCompletedCount: 4,
    approvalRequestCount: 0,
  },
  todo_list: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "turn/completed", "turn/plan/updated", "item/agentMessage/delta"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
  web_search: {
    outgoing: ["initialize", "initialized", "thread/start", "turn/start"],
    incoming: ["turn/started", "turn/completed", "item/agentMessage/delta"],
    turnStartCount: 1,
    turnCompletedCount: 1,
    approvalRequestCount: 0,
  },
} as const;

const decodeCodexTranscript = Schema.decodeUnknownEffect(
  CodexReplay.CodexAppServerReplayTranscript,
);
const readTranscript = Effect.fn("readCodexReplayFixture")(function* (file: URL) {
  return yield* readProviderReplayTranscript(file);
}, Effect.provide(NodeServices.layer));

function labels(
  transcript: ProviderReplayTranscript,
  type: "expect_outbound" | "emit_inbound",
): ReadonlyArray<string> {
  return transcript.entries.flatMap((entry) => {
    if (entry.type !== type || entry.label === undefined) {
      return [];
    }
    return [entry.label];
  });
}

function countLabel(
  transcript: ProviderReplayTranscript,
  type: "expect_outbound" | "emit_inbound",
  label: string,
) {
  return labels(transcript, type).filter((entryLabel) => entryLabel === label).length;
}

function countApprovalRequests(transcript: ProviderReplayTranscript) {
  return labels(transcript, "emit_inbound").filter((label) => label.endsWith("/requestApproval"))
    .length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPath(value: unknown, path: ReadonlyArray<string | number>): unknown {
  let current = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(current)) {
        throw new Error(`Expected array while reading ${path.join(".")}.`);
      }
      current = current[segment];
      continue;
    }

    if (!isRecord(current)) {
      throw new Error(`Expected object while reading ${path.join(".")}.`);
    }
    current = current[segment];
  }
  return current;
}

function readString(value: unknown, path: ReadonlyArray<string | number>): string {
  const current = readPath(value, path);
  if (typeof current !== "string") {
    throw new Error(`Expected string at ${path.join(".")}.`);
  }
  return current;
}

function readArray(value: unknown, path: ReadonlyArray<string | number>): ReadonlyArray<unknown> {
  const current = readPath(value, path);
  if (!Array.isArray(current)) {
    throw new Error(`Expected array at ${path.join(".")}.`);
  }
  return current;
}

function findProtocolEntry(
  transcript: ProviderReplayTranscript,
  type: "expect_outbound" | "emit_inbound",
  label: string,
  occurrence = 0,
): ProtocolReplayEntry {
  const matches = transcript.entries.filter(
    (entry): entry is ProtocolReplayEntry => entry.type === type && entry.label === label,
  );
  const entry = matches[occurrence];
  if (!entry) {
    throw new Error(`Missing ${type} ${label} occurrence ${occurrence}.`);
  }
  return entry;
}

function agentMessageTexts(transcript: ProviderReplayTranscript): ReadonlyArray<string> {
  return transcript.entries.flatMap((entry) => {
    if (entry.type !== "emit_inbound" || entry.label !== "item/completed") {
      return [];
    }

    const item = readPath(entry.frame, ["params", "item"]);
    if (!isRecord(item) || item.type !== "agentMessage" || typeof item.text !== "string") {
      return [];
    }
    return [item.text];
  });
}

function assertScenarioExpectations(transcript: ProviderReplayTranscript) {
  const expectation =
    scenarioExpectations[transcript.scenario as keyof typeof scenarioExpectations];
  const outgoingLabels = labels(transcript, "expect_outbound");
  const incomingLabels = labels(transcript, "emit_inbound");

  assert.isDefined(expectation, `missing scenario expectation for ${transcript.scenario}`);
  for (const label of expectation.outgoing) {
    assert.include(outgoingLabels, label, `${transcript.scenario} missing outgoing ${label}`);
  }
  for (const label of expectation.incoming) {
    assert.include(incomingLabels, label, `${transcript.scenario} missing incoming ${label}`);
  }

  assert.equal(countLabel(transcript, "expect_outbound", "turn/start"), expectation.turnStartCount);
  assert.equal(
    countLabel(transcript, "emit_inbound", "turn/completed"),
    expectation.turnCompletedCount,
  );
  assert.equal(countApprovalRequests(transcript), expectation.approvalRequestCount);
}

function assertProviderThreadResumeSemantics(transcript: ProviderReplayTranscript) {
  if (transcript.scenario !== "provider_thread_resume") {
    return;
  }

  const startThreadId = readString(
    findProtocolEntry(transcript, "emit_inbound", "thread/start").frame,
    ["result", "thread", "id"],
  );
  const resumeRequestedThreadId = readString(
    findProtocolEntry(transcript, "expect_outbound", "thread/resume").frame,
    ["params", "threadId"],
  );
  const resumeRequest = findProtocolEntry(transcript, "expect_outbound", "thread/resume").frame;
  const resumedThreadFrame = findProtocolEntry(transcript, "emit_inbound", "thread/resume").frame;
  const resumedThreadId = readString(resumedThreadFrame, ["result", "thread", "id"]);
  const secondTurnThreadId = readString(
    findProtocolEntry(transcript, "expect_outbound", "turn/start", 1).frame,
    ["params", "threadId"],
  );
  const texts = agentMessageTexts(transcript);
  const secondFinalText = texts[1] ?? "";

  assert.equal(
    resumeRequestedThreadId,
    startThreadId,
    "thread/resume must request the provider thread created by thread/start",
  );
  assert.equal(
    resumedThreadId,
    startThreadId,
    "thread/resume must return the same provider thread id",
  );
  assert.equal(
    secondTurnThreadId,
    startThreadId,
    "turn after resume must run on the resumed provider thread",
  );
  // The adapter resumes with excludeTurns, so history reaches the model, not the response.
  assert.equal(readPath(resumeRequest, ["params", "excludeTurns"]), true);
  assert.lengthOf(readArray(resumedThreadFrame, ["result", "thread", "turns"]), 0);
  assert.equal(texts[0], PROVIDER_THREAD_RESUME_FIRST_FINAL);
  assert.include(
    secondFinalText,
    PROVIDER_THREAD_RESUME_FIRST_FINAL,
    "second turn must demonstrate access to resumed conversation history",
  );
  assert.include(
    secondFinalText,
    PROVIDER_THREAD_RESUME_SECOND_FINAL,
    "second turn must include its own completion marker",
  );
}

/**
 * Codex announces a v2 child with the parent's `subAgentActivity(started)`
 * before the child's first `turn/started`; the adapter registers children
 * from that activity.
 */
function assertSubagentActivityPrecedesChildTurns(transcript: ProviderReplayTranscript) {
  if (transcript.scenario !== "subagent_v2" && transcript.scenario !== "subagent_v2_nested") {
    return;
  }

  const announcedChildren = new Set<string>();
  const startedChildren = new Set<string>();
  const rootThreadId = readString(
    findProtocolEntry(transcript, "emit_inbound", "thread/start").frame,
    ["result", "thread", "id"],
  );
  for (const entry of transcript.entries) {
    if (entry.type !== "emit_inbound") continue;
    const method = readPath(entry.frame, ["method"]);
    if (method === "item/started") {
      const item = readPath(entry.frame, ["params", "item"]);
      if (isRecord(item) && item.type === "subAgentActivity" && item.kind === "started") {
        announcedChildren.add(readString(item, ["agentThreadId"]));
      }
    }
    if (method === "turn/started") {
      const threadId = readString(entry.frame, ["params", "threadId"]);
      if (threadId === rootThreadId) continue;
      assert.isTrue(
        announcedChildren.has(threadId),
        `${transcript.scenario}: child ${threadId} started a turn before its subAgentActivity`,
      );
      startedChildren.add(threadId);
    }
  }
  assert.equal(
    startedChildren.size,
    transcript.scenario === "subagent_v2" ? 1 : 3,
    `${transcript.scenario}: unexpected number of child turns`,
  );
}

describe("Codex replay fixtures", () => {
  it.effect("loads each canonical Codex fixture as an app-server replay transcript", () =>
    Effect.gen(function* () {
      for (const fixture of CODEX_REPLAY_TRANSCRIPTS) {
        const transcript = yield* readTranscript(fixture.transcriptFile);
        const codexTranscript = yield* decodeCodexTranscript(transcript);
        const first = transcript.entries[0];

        assert.equal(codexTranscript.provider, "codex");
        assert.equal(codexTranscript.protocol, "codex.app-server");
        assert.equal(codexTranscript.scenario, fixture.recordedScenario);
        assert.deepEqual(codexTranscript.entries.at(-1), {
          type: "runtime_exit",
          status: "success",
        });
        assert.equal(first?.type, "expect_outbound");
        if (first?.type !== "expect_outbound") {
          throw new Error(
            `Expected ${fixture.recordedScenario} to start with initialize outbound frame.`,
          );
        }
        assert.equal(first.label, "initialize");

        assertScenarioExpectations(transcript);
        assertProviderThreadResumeSemantics(transcript);
        assertSubagentActivityPrecedesChildTurns(transcript);
      }
    }),
  );

  it("covers the expected replay suite exactly", () => {
    assert.deepEqual(
      CODEX_REPLAY_TRANSCRIPTS.map((fixture) => fixture.recordedScenario).toSorted(),
      Object.keys(scenarioExpectations).toSorted(),
    );
  });
});
