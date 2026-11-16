import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ProjectId,
  type OrchestrationV2ServerCommand,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "./SecretRequests.ts";

const threadId = ThreadId.make("thread-files");
const turnItemId = TurnItemId.make("turn-item:secret-request:file");
const projectId = ProjectId.make("project-1");

/** Runs `body` with a real secrets directory and a thread holding one request. */
const withFiles = <A, E>(
  delivery: "file" | undefined,
  body: (input: {
    readonly service: SecretRequests.SecretRequests["Service"];
    readonly stored: Map<string, Uint8Array>;
    readonly fs: FileSystem.FileSystem;
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const secretsDir = yield* fs.makeTempDirectoryScoped({ prefix: "secret-files-" });
    const stored = new Map<string, Uint8Array>();
    let secretStatus = "pending";
    const dependencies = Layer.mergeAll(
      NodeCrypto.layer,
      NodeServices.layer,
      Layer.succeed(ServerConfig.ServerConfig, {
        secretsDir,
      } as ServerConfig.ServerConfig["Service"]),
      Layer.succeed(
        ServerSecretStore.ServerSecretStore,
        ServerSecretStore.ServerSecretStore.of({
          get: (name) => Effect.sync(() => Option.fromNullishOr(stored.get(name))),
          set: (name, value) => Effect.sync(() => void stored.set(name, value)),
          create: (name, value) => Effect.sync(() => void stored.set(name, value)),
          getOrCreateRandom: (name, bytes) =>
            Effect.sync(() => {
              const value = stored.get(name) ?? new Uint8Array(bytes).fill(7);
              stored.set(name, value);
              return value;
            }),
          remove: (name) => Effect.sync(() => void stored.delete(name)),
        }),
      ),
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadRecords: () =>
          Effect.sync(
            () =>
              ({
                thread: { projectId },
                runs: [{ id: "run-1", status: "running" }],
                turnItems: [
                  {
                    id: turnItemId,
                    threadId,
                    runId: "run-1",
                    nodeId: "node-root",
                    type: "secret_request",
                    label: "Pairing code",
                    reason: "Pairs the device.",
                    ...(delivery === undefined ? {} : { delivery }),
                    secretStatus,
                  },
                ],
              }) as never,
          ),
        dispatch: (command: OrchestrationV2ServerCommand) =>
          Effect.sync(() => {
            if (command.type === "secret_request.record" && secretStatus === "pending") {
              secretStatus = command.secretStatus;
            }
            return {} as never;
          }),
      }),
    );
    return yield* Effect.gen(function* () {
      const service = yield* SecretRequests.SecretRequests;
      return yield* body({ service, stored, fs });
    }).pipe(Effect.provide(SecretRequests.layer.pipe(Layer.provide(dependencies))));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const valuesOf = (stored: Map<string, Uint8Array>) =>
  [...stored.entries()]
    .filter(([name]) => name !== "secret-request-salt")
    .map(([, bytes]) => new TextDecoder().decode(bytes));

it.live("a file request moves its value to an owner-only file, once", () =>
  withFiles("file", ({ service, stored, fs }) =>
    Effect.gen(function* () {
      yield* service.answer({ threadId, turnItemId, answer: { type: "save", secret: "123456" } });
      const file = yield* service.saveToFile({ threadId, turnItemId });
      assert.equal(yield* fs.readFileString(file), "123456");
      const info = yield* fs.stat(file);
      assert.equal(info.mode & 0o777, 0o600);
      // The stored copy is gone, so no ref can hand the value out again.
      assert.isFalse(valuesOf(stored).some((value) => value.includes("123456")));
      // A retry gets the same file.
      assert.equal(yield* service.saveToFile({ threadId, turnItemId }), file);
    }),
  ),
);

it.live("a secretRef request cannot be written to a file", () =>
  withFiles(undefined, ({ service }) =>
    Effect.gen(function* () {
      yield* service.answer({ threadId, turnItemId, answer: { type: "save", secret: "ghp_x" } });
      const error = yield* service.saveToFile({ threadId, turnItemId }).pipe(Effect.flip);
      assert.equal(error.reason, "not_a_file_request");
    }),
  ),
);

it.live("a pasted value gets one file per retry key and never changes", () =>
  withFiles(undefined, ({ service, fs }) =>
    Effect.gen(function* () {
      const input = { threadId, requestNamespace: "session-1", requestKey: "key-1" };
      const file = yield* service.savePasted({ ...input, value: "first" });
      assert.equal(yield* fs.readFileString(file), "first");
      assert.equal(yield* service.savePasted({ ...input, value: "second" }), file);
      assert.equal(yield* fs.readFileString(file), "first");
      const other = yield* service.savePasted({
        ...input,
        requestNamespace: "session-2",
        value: "x",
      });
      assert.notEqual(other, file);
    }),
  ),
);
