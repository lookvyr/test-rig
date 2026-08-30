import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";

import { makeClaudeSessionForker } from "./ClaudeSessionFork.ts";

const SOURCE_ID = "0a10a165-947d-4c4e-a447-01fbde869df6";
const USER_ID = "c478da95-a754-4bc9-b3d5-ae818cc2a103";
const ASSISTANT_ID = "574e46f9-d035-4e7d-a1bc-f96fc7b722e6";
const LATER_ID = "4c6b879f-3afb-4a80-9d41-dd5608b9bba3";
const QUEUED_ID = "4da9deea-39df-4555-86b2-54160e30ff83";
const COMPACT_ID = "b030128d-c8cc-4471-8d7c-2b682827583f";
const SUMMARY_ID = "18ad7e92-af98-4cee-81a0-239d8bf92c66";
const MISSING_ID = "c6e8e49c-e4dc-496f-be2e-98aab571020a";
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeEntry = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      type: Schema.String,
      uuid: Schema.optional(Schema.String),
      parentUuid: Schema.optional(Schema.NullOr(Schema.String)),
      sessionId: Schema.optional(Schema.String),
    }),
  ),
);

const makeFixture = Effect.fn("makeClaudeForkFixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "test-rig-claude-fork-" });
  const cwd = path.join(yield* fs.realPath(root), "project");
  yield* fs.makeDirectory(cwd);
  const homes = yield* Effect.forEach(["ALPHA", "BETA"], (marker) =>
    Effect.gen(function* () {
      const home = path.join(root, marker);
      const directory = path.join(home, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
      yield* fs.makeDirectory(directory, { recursive: true });
      const common = {
        sessionId: SOURCE_ID,
        cwd,
        timestamp: "2026-08-01T00:00:00.000Z",
        isSidechain: false,
      };
      const source =
        [
          {
            ...common,
            type: "user",
            uuid: USER_ID,
            parentUuid: null,
            message: { role: "user", content: `Remember ${marker}.` },
          },
          {
            ...common,
            type: "assistant",
            uuid: ASSISTANT_ID,
            parentUuid: USER_ID,
            message: {
              id: `msg_${ASSISTANT_ID}`,
              type: "message",
              role: "assistant",
              model: "claude-sonnet-5",
              content: [{ type: "text", text: `Remembered ${marker}.` }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            },
          },
        ]
          .map((entry) => encodeJson(entry))
          .join("\n") + "\n";
      const sourcePath = path.join(directory, `${SOURCE_ID}.jsonl`);
      yield* fs.writeFileString(sourcePath, source);
      const fork = yield* makeClaudeSessionForker({ CLAUDE_CONFIG_DIR: home });
      return { home, directory, sourcePath, source, common, fork };
    }),
  );
  return { fs, path, cwd, homes };
});

it.layer(NodeServices.layer)("Claude native session forks", (it) => {
  it.effect("isolates concurrent instance homes and freezes a remapped native child", () =>
    Effect.gen(function* () {
      const { fs, path, cwd, homes } = yield* makeFixture();
      const ambientHome = process.env.CLAUDE_CONFIG_DIR;
      const children = yield* Effect.forEach(
        homes,
        (home) =>
          home.fork({
            sessionId: SOURCE_ID,
            cwd,
            upToMessageId: ASSISTANT_ID,
          }),
        { concurrency: "unbounded" },
      );
      assert.equal(new Set([SOURCE_ID, ...children]).size, 3);
      assert.equal(process.env.CLAUDE_CONFIG_DIR, ambientHome);
      for (const [index, home] of homes.entries()) {
        const childPath = path.join(home.directory, `${children[index]}.jsonl`);
        const child = yield* fs.readFileString(childPath);
        assert.include(child, index === 0 ? "ALPHA" : "BETA");
        assert.notInclude(child, index === 0 ? "BETA" : "ALPHA");
        const entries = child
          .trim()
          .split("\n")
          .map((entry) => decodeEntry(entry))
          .filter((entry) => entry.type === "user" || entry.type === "assistant");
        assert.equal(entries.length, 2);
        assert.equal(entries[0]!.parentUuid, null);
        assert.equal(entries[1]!.parentUuid, entries[0]!.uuid);
        for (const entry of entries) {
          assert.notInclude([USER_ID, ASSISTANT_ID], entry.uuid);
          assert.equal(entry.sessionId, children[index]);
        }
        assert.equal(yield* fs.readFileString(home.sourcePath), home.source);
        yield* fs.writeFileString(
          home.sourcePath,
          home.source +
            encodeJson({
              ...home.common,
              type: "user",
              uuid: LATER_ID,
              parentUuid: ASSISTANT_ID,
              message: { role: "user", content: "Later parent request" },
            }) +
            "\n",
        );
        assert.equal(yield* fs.readFileString(childPath), child);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("honors an exact boundary even when newer parent messages already exist", () =>
    Effect.gen(function* () {
      const {
        fs,
        path,
        cwd,
        homes: [home],
      } = yield* makeFixture();
      yield* fs.writeFileString(
        home!.sourcePath,
        home!.source +
          encodeJson({
            ...home!.common,
            type: "user",
            uuid: LATER_ID,
            parentUuid: ASSISTANT_ID,
            message: { role: "user", content: "Excluded later request" },
          }) +
          "\n",
      );
      const child = yield* home!.fork({ sessionId: SOURCE_ID, cwd, upToMessageId: ASSISTANT_ID });
      assert.notInclude(
        yield* fs.readFileString(path.join(home!.directory, `${child}.jsonl`)),
        "Excluded later request",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("selects the native tail for legacy history with no supplied boundary", () =>
    Effect.gen(function* () {
      const {
        fs,
        path,
        cwd,
        homes: [home],
      } = yield* makeFixture();
      yield* fs.writeFileString(
        home!.sourcePath,
        home!.source +
          encodeJson({
            ...home!.common,
            type: "user",
            uuid: LATER_ID,
            parentUuid: ASSISTANT_ID,
            message: { role: "user", content: "Latest unanswered request" },
          }) +
          "\n",
      );
      const child = yield* home!.fork({ sessionId: SOURCE_ID, cwd });
      assert.include(
        yield* fs.readFileString(path.join(home!.directory, `${child}.jsonl`)),
        "Latest unanswered request",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("rejects forks that would omit an accepted parent request before writing a child", () =>
    Effect.gen(function* () {
      const {
        fs,
        cwd,
        homes: [home],
      } = yield* makeFixture();
      const before = yield* fs.readDirectory(home!.directory);
      const missingQueuedRequest = yield* home!
        .fork({
          sessionId: SOURCE_ID,
          cwd,
          upToMessageId: ASSISTANT_ID,
          afterMessageId: LATER_ID,
        })
        .pipe(Effect.result);
      assert.equal(missingQueuedRequest._tag, "Failure");
      assert.deepEqual(yield* fs.readDirectory(home!.directory), before);

      yield* fs.writeFileString(
        home!.sourcePath,
        home!.source +
          encodeJson({
            ...home!.common,
            type: "user",
            uuid: LATER_ID,
            parentUuid: ASSISTANT_ID,
            message: { role: "user", content: "Accepted parent steer" },
          }) +
          "\n",
      );
      for (const upToMessageId of [ASSISTANT_ID, MISSING_ID]) {
        const result = yield* home!
          .fork({
            sessionId: SOURCE_ID,
            cwd,
            upToMessageId,
            afterMessageId: LATER_ID,
          })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        assert.deepEqual(yield* fs.readDirectory(home!.directory), before);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("forks at or after the accepted request, including native tail selection", () =>
    Effect.gen(function* () {
      const {
        fs,
        path,
        cwd,
        homes: [home],
      } = yield* makeFixture();
      const entries = [
        {
          ...home!.common,
          type: "user",
          uuid: LATER_ID,
          parentUuid: ASSISTANT_ID,
          message: { role: "user", content: "Accepted parent steer" },
        },
        {
          ...home!.common,
          type: "assistant",
          uuid: SUMMARY_ID,
          parentUuid: LATER_ID,
          message: {
            id: `msg_${SUMMARY_ID}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: [{ type: "text", text: "Steer acknowledged" }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        },
      ];
      yield* fs.writeFileString(
        home!.sourcePath,
        home!.source + entries.map((entry) => encodeJson(entry)).join("\n") + "\n",
      );
      for (const upToMessageId of [LATER_ID, SUMMARY_ID, undefined]) {
        const child = yield* home!.fork({
          sessionId: SOURCE_ID,
          cwd,
          afterMessageId: LATER_ID,
          ...(upToMessageId ? { upToMessageId } : {}),
        });
        assert.include(
          yield* fs.readFileString(path.join(home!.directory, `${child}.jsonl`)),
          "Accepted parent steer",
        );
      }
    }).pipe(Effect.scoped),
  );

  it.effect("includes queued-command attachments at exact and descendant boundaries", () =>
    Effect.gen(function* () {
      const { fs, path, cwd, homes } = yield* makeFixture();
      for (const home of homes) {
        const entries = [
          {
            ...home.common,
            type: "attachment",
            uuid: QUEUED_ID,
            parentUuid: ASSISTANT_ID,
            attachment: {
              type: "queued_command",
              source_uuid: LATER_ID,
              prompt: [{ type: "text", text: "Remember queued context" }],
              commandMode: "prompt",
            },
          },
          {
            ...home.common,
            type: "assistant",
            uuid: SUMMARY_ID,
            parentUuid: QUEUED_ID,
            message: {
              id: `msg_${SUMMARY_ID}`,
              role: "assistant",
              content: [{ type: "text", text: "Queued context acknowledged" }],
            },
          },
        ];
        const source = home.source + entries.map((entry) => encodeJson(entry)).join("\n") + "\n";
        yield* fs.writeFileString(home.sourcePath, source);
        for (const upToMessageId of [LATER_ID, QUEUED_ID, SUMMARY_ID, undefined]) {
          const child = yield* home.fork({
            sessionId: SOURCE_ID,
            cwd,
            afterMessageId: LATER_ID,
            ...(upToMessageId ? { upToMessageId } : {}),
          });
          const childRaw = yield* fs.readFileString(path.join(home.directory, `${child}.jsonl`));
          assert.include(childRaw, "Remember queued context");
          assert.include(childRaw, LATER_ID);
          assert.include(
            childRaw,
            home.home.endsWith("ALPHA") ? "Remember ALPHA" : "Remember BETA",
          );
          if (upToMessageId === LATER_ID || upToMessageId === QUEUED_ID) {
            assert.notInclude(childRaw, "Queued context acknowledged");
          } else {
            assert.include(childRaw, "Queued context acknowledged");
          }
          assert.equal(yield* fs.readFileString(home.sourcePath), source);
        }
      }
    }).pipe(Effect.scoped),
  );

  it.effect("rejects requests outside the retained ancestry without writing a child", () =>
    Effect.gen(function* () {
      const {
        fs,
        cwd,
        homes: [home],
      } = yield* makeFixture();
      const queued = {
        ...home!.common,
        type: "attachment",
        uuid: QUEUED_ID,
        parentUuid: ASSISTANT_ID,
        attachment: { type: "queued_command", source_uuid: LATER_ID, prompt: "Queued request" },
      };
      const response = {
        ...home!.common,
        type: "assistant",
        uuid: SUMMARY_ID,
        parentUuid: QUEUED_ID,
        message: { id: `msg_${SUMMARY_ID}`, role: "assistant", content: "Response" },
      };
      const compact = {
        ...home!.common,
        type: "system",
        subtype: "compact_boundary",
        uuid: COMPACT_ID,
        parentUuid: null,
        compactMetadata: { trigger: "manual", preTokens: 1000 },
      };
      const cases = [
        { entries: [queued, response], boundary: ASSISTANT_ID },
        { entries: [queued, { ...response, parentUuid: ASSISTANT_ID }], boundary: SUMMARY_ID },
        { entries: [{ ...queued, isSidechain: true }, response], boundary: SUMMARY_ID },
        { entries: [queued, { ...response, parentUuid: MISSING_ID }], boundary: SUMMARY_ID },
        { entries: [queued, { ...response, parentUuid: SUMMARY_ID }], boundary: SUMMARY_ID },
        {
          entries: [queued, compact, { ...response, parentUuid: COMPACT_ID }],
          boundary: SUMMARY_ID,
        },
        // The first occurrence bounds the SDK fork; a later rewrite cannot prove inclusion.
        {
          entries: [{ ...response, parentUuid: ASSISTANT_ID }, queued, response],
          boundary: SUMMARY_ID,
        },
        {
          entries: [
            { ...response, parentUuid: ASSISTANT_ID },
            {
              ...home!.common,
              type: "user",
              uuid: LATER_ID,
              parentUuid: ASSISTANT_ID,
              message: { role: "user", content: "Later ordinary request" },
            },
            { ...response, parentUuid: LATER_ID },
          ],
          boundary: SUMMARY_ID,
        },
      ];
      const before = yield* fs.readDirectory(home!.directory);
      for (const testCase of cases) {
        const source =
          home!.source + testCase.entries.map((entry) => encodeJson(entry)).join("\n") + "\n";
        yield* fs.writeFileString(home!.sourcePath, source);
        const result = yield* home!
          .fork({
            sessionId: SOURCE_ID,
            cwd,
            upToMessageId: testCase.boundary,
            afterMessageId: LATER_ID,
          })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        assert.deepEqual(yield* fs.readDirectory(home!.directory), before);
        assert.equal(yield* fs.readFileString(home!.sourcePath), source);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("does not advance a saved tail to an unresolved queued request", () =>
    Effect.gen(function* () {
      const {
        fs,
        cwd,
        homes: [home],
      } = yield* makeFixture();
      const before = yield* fs.readDirectory(home!.directory);
      const source =
        home!.source +
        encodeJson({
          ...home!.common,
          type: "attachment",
          uuid: QUEUED_ID,
          parentUuid: ASSISTANT_ID,
          attachment: { type: "queued_command", source_uuid: LATER_ID, prompt: "Queued request" },
        }) +
        "\n";
      for (const content of [home!.source, source, source + '{"type":']) {
        yield* fs.writeFileString(home!.sourcePath, content);
        const result = yield* home!
          .fork({
            sessionId: SOURCE_ID,
            cwd,
            afterMessageId: LATER_ID,
          })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        assert.deepEqual(yield* fs.readDirectory(home!.directory), before);
      }
    }).pipe(Effect.scoped),
  );

  it.effect(
    "rejects missing boundaries, empty history, and invalid sources without a child write",
    () =>
      Effect.gen(function* () {
        const {
          fs,
          cwd,
          homes: [home],
        } = yield* makeFixture();
        const before = yield* fs.readDirectory(home!.directory);
        for (const input of [
          { sessionId: SOURCE_ID, cwd, upToMessageId: MISSING_ID },
          { sessionId: MISSING_ID, cwd },
          { sessionId: "invalid-session-id", cwd, upToMessageId: ASSISTANT_ID },
        ]) {
          const result = yield* home!.fork(input).pipe(Effect.result);
          assert.equal(result._tag, "Failure");
          if (result._tag === "Failure")
            assert.equal(result.failure._tag, "ProviderAdapterRequestError");
          assert.deepEqual(yield* fs.readDirectory(home!.directory), before);
        }
        yield* fs.writeFileString(home!.sourcePath, "");
        const empty = yield* home!.fork({ sessionId: SOURCE_ID, cwd }).pipe(Effect.result);
        assert.equal(empty._tag, "Failure");
        assert.deepEqual(yield* fs.readDirectory(home!.directory), before);
      }).pipe(Effect.scoped),
  );

  it.effect("accepts a compact boundary UUID but excludes a following compacted summary", () =>
    Effect.gen(function* () {
      const {
        fs,
        path,
        cwd,
        homes: [home],
      } = yield* makeFixture();
      const compact = {
        type: "system",
        subtype: "compact_boundary",
        ...home!.common,
        uuid: COMPACT_ID,
        parentUuid: null,
        compactMetadata: { trigger: "manual", preTokens: 1000 },
      };
      const summary = {
        ...home!.common,
        type: "user",
        uuid: SUMMARY_ID,
        parentUuid: COMPACT_ID,
        isCompactSummary: true,
        message: { role: "user", content: "Compacted summary of ALPHA" },
      };
      yield* fs.writeFileString(
        home!.sourcePath,
        home!.source + [compact, summary].map((entry) => encodeJson(entry)).join("\n") + "\n",
      );
      const atBoundary = yield* home!.fork({
        sessionId: SOURCE_ID,
        cwd,
        upToMessageId: COMPACT_ID,
      });
      const boundaryRaw = yield* fs.readFileString(
        path.join(home!.directory, `${atBoundary}.jsonl`),
      );
      assert.include(boundaryRaw, "compact_boundary");
      assert.notInclude(boundaryRaw, "Compacted summary of ALPHA");
      const afterSummary = yield* home!.fork({ sessionId: SOURCE_ID, cwd });
      assert.include(
        yield* fs.readFileString(path.join(home!.directory, `${afterSummary}.jsonl`)),
        "Compacted summary of ALPHA",
      );
    }).pipe(Effect.scoped),
  );

  it.effect("recovers the saved conversation when a lone compaction marker follows it", () =>
    Effect.gen(function* () {
      const {
        fs,
        path,
        cwd,
        homes: [home],
      } = yield* makeFixture();
      yield* fs.writeFileString(
        home!.sourcePath,
        home!.source +
          encodeJson({
            type: "system",
            subtype: "compact_boundary",
            ...home!.common,
            uuid: COMPACT_ID,
            parentUuid: null,
            compactMetadata: { trigger: "manual", preTokens: 1000 },
          }) +
          "\n",
      );

      // The SDK selects the latest user/assistant chain, not the detached marker.
      const child = yield* home!.fork({ sessionId: SOURCE_ID, cwd, afterMessageId: USER_ID });
      const childRaw = yield* fs.readFileString(path.join(home!.directory, `${child}.jsonl`));
      assert.include(childRaw, "Remember ALPHA.");
      assert.include(childRaw, "Remembered ALPHA.");
      assert.notInclude(childRaw, "compact_boundary");

      const before = yield* fs.readDirectory(home!.directory);
      const missingRequest = yield* home!
        .fork({
          sessionId: SOURCE_ID,
          cwd,
          afterMessageId: MISSING_ID,
        })
        .pipe(Effect.result);
      assert.equal(missingRequest._tag, "Failure");
      assert.deepEqual(yield* fs.readDirectory(home!.directory), before);
    }).pipe(Effect.scoped),
  );
});

it.effect("rejects malformed or unchanged helper identities", () =>
  Effect.gen(function* () {
    for (const stdout of [
      "not-json",
      encodeJson({ sessionId: "invalid" }),
      encodeJson({ sessionId: SOURCE_ID }),
    ]) {
      const spawner = ChildProcessSpawner.make((command) => {
        assert.equal(command._tag, "StandardCommand");
        if (command._tag === "StandardCommand") {
          assert.equal(command.options.env?.ELECTRON_RUN_AS_NODE, "1");
          assert.equal(command.options.extendEnv, false);
        }
        return Effect.succeed(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            stdin: Sink.drain,
            stdout: Stream.make(new TextEncoder().encode(stdout)),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
            unref: Effect.succeed(Effect.void),
          }),
        );
      });
      const fork = yield* makeClaudeSessionForker({}).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );
      const result = yield* fork({ sessionId: SOURCE_ID, cwd: "/unused" }).pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure")
        assert.equal(result.failure._tag, "ProviderAdapterRequestError");
    }
  }),
);
