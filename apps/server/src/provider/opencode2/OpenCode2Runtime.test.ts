import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";
import { OpenCodeSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import { vi } from "vite-plus/test";
import { OpenCodeRuntime } from "../opencodeRuntime.ts";
import { makeOpenCode2Runtime } from "./OpenCode2Runtime.ts";

const decodeSettings = Schema.decodeEffect(OpenCodeSettings);

it.layer(NodeServices.layer)("OpenCode 2 runtime", (it) => {
  it.effect("rejects a local v1 executable before spawning a server", () =>
    Effect.gen(function* () {
      const args: Array<ReadonlyArray<string>> = [];
      const runtime = yield* makeOpenCode2Runtime(
        yield* decodeSettings({
          enabled: true,
          binaryPath: "never-spawn-this",
        }),
        {},
      ).pipe(
        Effect.provideService(OpenCodeRuntime, {
          runOpenCodeCommand: (input) =>
            Effect.sync(() => {
              args.push(input.args);
              return { stdout: "1.14.19", stderr: "", code: 0 };
            }),
        }),
      );
      assert.isTrue(Exit.isFailure(yield* Effect.exit(Effect.scoped(runtime.acquire))));
      assert.deepStrictEqual(args, [["--version"]]);
    }),
  );
  it.effect("shares authenticated external connections without owning their server", () =>
    Effect.gen(function* () {
      const headers: Array<string | null> = [];
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        headers.push(new Headers(init?.headers).get("Authorization"));
        return Response.json({ version: "2.0.18", pid: 1, urls: [], paths: { tmp: "/tmp" } });
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => fetchMock.mockRestore()));
      const runtime = yield* makeOpenCode2Runtime(
        yield* decodeSettings({
          enabled: true,
          serverUrl: "http://external.invalid",
          serverPassword: "tést",
        }),
        {},
      ).pipe(
        Effect.provideService(OpenCodeRuntime, {
          runOpenCodeCommand: () =>
            Effect.die("External connections must not launch an executable"),
        }),
      );
      const one = yield* Scope.make();
      const two = yield* Scope.make();
      const a = yield* runtime.acquire.pipe(Effect.provideService(Scope.Scope, one));
      const b = yield* runtime.acquire.pipe(Effect.provideService(Scope.Scope, two));
      assert.strictEqual(a, b);
      assert.strictEqual(headers.length, 1);
      assert.strictEqual(headers[0], `Basic ${Buffer.from("opencode:tést").toString("base64")}`);
      yield* Scope.close(one, Exit.void);
      assert.strictEqual(headers.length, 1);
      yield* Scope.close(two, Exit.void);
      yield* Effect.scoped(runtime.acquire);
      assert.strictEqual(headers.length, 2);
    }),
  );
});
