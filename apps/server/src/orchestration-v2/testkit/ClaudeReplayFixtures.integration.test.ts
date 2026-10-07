import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  CommandId,
  isProviderNativeSubagentThread,
  MessageId,
  ProviderDriverKind,
  type ProviderReplayTranscript,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { classifyClaudeNativeTool } from "../Adapters/ClaudeAdapterV2.ts";
import { ClaudeOrchestratorReplayHarness } from "../Adapters/ClaudeAdapterV2.testkit.ts";
import * as IdAllocator from "../IdAllocator.ts";
import * as Orchestrator from "../Orchestrator.ts";
import { userFacingDispatchErrorMessage } from "../UserFacingErrors.ts";
import { provideDeterministicTestRuntime } from "./DeterministicRuntime.ts";
import { ORCHESTRATOR_REPLAY_FIXTURES } from "./fixtures/index.ts";
import { subagentInput } from "./fixtures/subagent/input.ts";
import { runOrchestratorV2Scenario } from "./OrchestratorScenario.ts";
import { makeOrchestratorV2ProviderReplayLayer } from "./ProviderReplayHarness.ts";
import { materializeReplayTranscriptRuntimeInstructions } from "./ReplayTranscriptNdjson.ts";
import { CLAUDE_MODEL_SELECTION, materializeFixtureInput } from "./fixtures/shared.ts";
import { readProviderReplayTranscript } from "./ReplayTranscriptNdjson.ts";

const readTranscript = Effect.fn("readClaudeReplayFixture")(function* (file: URL) {
  return yield* readProviderReplayTranscript(file);
}, Effect.provide(NodeServices.layer));

function readClaudeTranscriptFixture(path: string) {
  return readTranscript(new URL(`./fixtures/${path}/claude_transcript.ndjson`, import.meta.url));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function metadataString(transcript: ProviderReplayTranscript, key: string): string {
  const value = transcript.metadata?.[key];
  if (typeof value !== "string") {
    throw new Error(`${transcript.scenario} metadata.${key} must be a string.`);
  }
  return value;
}

type FramedReplayEntry = Extract<
  ProviderReplayTranscript["entries"][number],
  { readonly frame: unknown }
>;

function frameRecord(entry: FramedReplayEntry): Record<string, unknown> {
  if (!isRecord(entry.frame)) {
    throw new Error("Replay entry frame must be an object.");
  }
  return entry.frame;
}

function findEntryFrame(
  transcript: ProviderReplayTranscript,
  label: string,
): Record<string, unknown> {
  const entry = transcript.entries.find(
    (candidate): candidate is FramedReplayEntry =>
      "label" in candidate && candidate.label === label && "frame" in candidate,
  );
  assert.isDefined(entry, `${transcript.scenario} must include replay entry ${label}`);
  return frameRecord(entry);
}

function successResultTexts(transcript: ProviderReplayTranscript): ReadonlyArray<string> {
  return transcript.entries.flatMap((entry) => {
    if (entry.type !== "emit_inbound" || !isRecord(entry.frame)) {
      return [];
    }
    if (entry.frame.type !== "result" || entry.frame.subtype !== "success") {
      return [];
    }
    return typeof entry.frame.result === "string" ? [entry.frame.result] : [];
  });
}

function claudeToolUseNamesFromTranscript(
  transcript: ProviderReplayTranscript,
): ReadonlyArray<string> {
  return transcript.entries.flatMap((entry) => {
    if (
      entry.type !== "emit_inbound" ||
      !isRecord(entry.frame) ||
      entry.frame.type !== "assistant"
    ) {
      return [];
    }

    const message = entry.frame.message;
    const content = isRecord(message) ? message.content : undefined;
    if (!Array.isArray(content)) {
      return [];
    }

    return content.flatMap((part) =>
      isRecord(part) &&
      typeof part.id === "string" &&
      typeof part.name === "string" &&
      "input" in part
        ? [part.name]
        : [],
    );
  });
}

describe("Claude Agent SDK replay fixtures", () => {
  it.effect("refuses messages to a native subagent thread without touching it", () =>
    Effect.gen(function* () {
      const raw = yield* readClaudeTranscriptFixture("subagent");
      const transcript = yield* ClaudeOrchestratorReplayHarness.decodeTranscript(
        materializeReplayTranscriptRuntimeInstructions(raw, {
          driver: ProviderDriverKind.make("claudeAgent"),
          model: CLAUDE_MODEL_SELECTION.model,
        }),
      );
      const materialized = yield* materializeFixtureInput({
        scenario: "subagent",
        fixtureInput: subagentInput(),
        driver: ProviderDriverKind.make("claudeAgent"),
        modelSelection: CLAUDE_MODEL_SELECTION,
      }).pipe(Effect.provide(IdAllocator.layer), provideDeterministicTestRuntime);
      const scenario = {
        name: "subagent/claudeAgent:read-only-child",
        transcript,
        commands: materialized.commands,
        steps: materialized.steps,
        projectionThreadIds: materialized.projectionThreadIds,
      };
      yield* Effect.gen(function* () {
        const result = yield* runOrchestratorV2Scenario(scenario);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const child = [...result.projections.values()].find((projection) =>
          isProviderNativeSubagentThread(projection.thread),
        );
        assert.isDefined(child);
        const before = yield* orchestrator.getThreadEventSequence(child.thread.id);

        for (const parentState of ["active", "archived", "deleted"] as const) {
          const parentThreadId: ThreadId | null = child.thread.lineage.parentThreadId;
          assert.isNotNull(parentThreadId);
          if (parentState !== "active") {
            yield* orchestrator.dispatch({
              type: parentState === "archived" ? "thread.archive" : "thread.delete",
              commandId: CommandId.make(`command:subagent:parent-${parentState}`),
              threadId: parentThreadId,
            });
          }
          const refused = yield* orchestrator
            .dispatch({
              type: "message.dispatch",
              createdBy: "user",
              creationSource: "web",
              commandId: CommandId.make(`command:subagent:message-native-child:${parentState}`),
              threadId: child.thread.id,
              messageId: MessageId.make(`message:subagent:message-native-child:${parentState}`),
              text: "Also check the tests.",
              attachments: [],
              dispatchMode: { type: "start_immediately" },
            })
            .pipe(Effect.flip);
          assert.equal(refused._tag, "OrchestratorSubagentThreadReadOnlyError");
          // The wire error carries this text to the web toast and mobile outbox.
          assert.equal(
            userFacingDispatchErrorMessage(refused),
            "This subagent is run by its provider and cannot take messages. Message the parent thread instead.",
          );
          assert.equal(yield* orchestrator.getThreadEventSequence(child.thread.id), before);
          const after = yield* orchestrator.getThreadProjection(child.thread.id);
          assert.lengthOf(after.runs, 0);
          assert.deepEqual(after.messages, child.messages);
          assert.deepEqual(after.thread.lineage, child.thread.lineage);
          assert.isNull(after.thread.archivedAt);
          assert.isNull(after.thread.deletedAt);
        }
      }).pipe(
        Effect.provide(
          makeOrchestratorV2ProviderReplayLayer(scenario, ClaudeOrchestratorReplayHarness),
        ),
        provideDeterministicTestRuntime,
        Effect.scoped,
      );
    }),
  );

  it.effect("classifies every Claude fixture tool use through the native tool table", () =>
    Effect.gen(function* () {
      const unknownToolNames = new Set<string>();
      const seenToolNames = new Set<string>();

      for (const fixture of ORCHESTRATOR_REPLAY_FIXTURES) {
        for (const provider of fixture.providers) {
          if (provider.driver !== "claudeAgent") {
            continue;
          }

          const transcript = yield* readTranscript(provider.transcriptFile);
          for (const toolName of claudeToolUseNamesFromTranscript(transcript)) {
            seenToolNames.add(toolName);
            const classification = classifyClaudeNativeTool(toolName);
            // MCP tools are open-ended and deliberately become dynamic tools.
            if (!classification.known && !toolName.startsWith("mcp__")) {
              unknownToolNames.add(`${fixture.name}:${toolName}`);
            }
          }
        }
      }

      assert.isAtLeast(seenToolNames.size, 1, "expected Claude fixtures to contain tool uses");
      assert.deepEqual([...unknownToolNames], []);
    }),
  );

  it.effect("keeps unregistered native conversation-state transcripts reviewable", () =>
    Effect.gen(function* () {
      const rollback = yield* readClaudeTranscriptFixture("thread_rollback");
      assert.equal(rollback.metadata?.queryMode, "resume_at_cursor");
      const rollbackCursor = metadataString(rollback, "resumeSessionAt");
      const rollbackResumeFrame = findEntryFrame(rollback, "query.open:resume_at_cursor");
      const rollbackResumeOptions = rollbackResumeFrame.options;
      if (!isRecord(rollbackResumeOptions)) {
        throw new Error("Rollback resume query.open options must be an object.");
      }
      assert.equal(rollbackResumeOptions.resumeSessionAt, rollbackCursor);
      const rollbackFinalText = successResultTexts(rollback).at(-1) ?? "";
      assert.include(rollbackFinalText, "rollback fixture first turn complete");
      assert.notInclude(rollbackFinalText, "rollback fixture second turn complete");

      const latestFork = yield* readClaudeTranscriptFixture("thread_fork_native");
      assert.equal(latestFork.metadata?.queryMode, "fork_session");
      const latestForkedSessionId = metadataString(latestFork, "forkedNativeSessionId");
      const latestForkedFrame = findEntryFrame(latestFork, "session.forked");
      assert.equal(latestForkedFrame.sessionId, latestForkedSessionId);

      const priorFork = yield* readClaudeTranscriptFixture("thread_fork_native_prior_turn");
      assert.equal(priorFork.metadata?.queryMode, "fork_session_prior_turn");
      const priorForkCursor = metadataString(priorFork, "forkUpToMessageId");
      const priorForkFrame = findEntryFrame(priorFork, "session.fork");
      const priorForkOptions = priorForkFrame.options;
      if (!isRecord(priorForkOptions)) {
        throw new Error("Prior-turn fork options must be an object.");
      }
      assert.equal(priorForkOptions.upToMessageId, priorForkCursor);
      const priorForkFinalText = successResultTexts(priorFork).at(-1) ?? "";
      assert.include(priorForkFinalText, "fork boundary alpha");
      assert.notInclude(priorForkFinalText, "fork boundary beta");

      const forkLocalRollback = yield* readClaudeTranscriptFixture(
        "thread_fork_native_fork_local_rollback",
      );
      assert.equal(forkLocalRollback.metadata?.queryMode, "fork_session_resume_at_fork_cursor");
      const forkLocalRollbackCursor = metadataString(forkLocalRollback, "resumeSessionAt");
      const forkLocalRollbackFrame = findEntryFrame(
        forkLocalRollback,
        "query.open:fork-resume-at-cursor",
      );
      const forkLocalRollbackOptions = forkLocalRollbackFrame.options;
      if (!isRecord(forkLocalRollbackOptions)) {
        throw new Error("Fork-local rollback resume query.open options must be an object.");
      }
      assert.equal(forkLocalRollbackOptions.resumeSessionAt, forkLocalRollbackCursor);
      const forkLocalRollbackFinalText = successResultTexts(forkLocalRollback).at(-1) ?? "";
      assert.include(forkLocalRollbackFinalText, "fork local source alpha");
      assert.include(forkLocalRollbackFinalText, "fork local first");
      assert.notInclude(forkLocalRollbackFinalText, "fork local second");
    }),
  );
});
