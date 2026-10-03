import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import { ServerConfig } from "../config.ts";
import { makeOpenCode2Fixture } from "../provider/opencode2/OpenCode2TestFixture.ts";
import { makeOpenCodeTextGeneration } from "./OpenCodeTextGeneration.ts";

const layer = ServerConfig.layerTest(process.cwd(), { prefix: "opencode2-text-test-" }).pipe(
  Layer.provideMerge(NodeServices.layer),
);
const input = {
  cwd: "/tmp",
  message: "Improve caching",
  modelSelection: { instanceId: ProviderInstanceId.make("opencode"), model: "opencode/big-pickle" },
};
it.layer(layer)("OpenCode 2 text generation", (it) => {
  it.effect("uses a subscribed temporary session and removes it after structured output", () =>
    Effect.gen(function* () {
      const fixture = yield* makeOpenCode2Fixture;
      fixture.behavior.onPrompt = (id) => {
        fixture.emit(fixture.text(id, '{"title":"Improve caching"}'));
        fixture.emit(fixture.terminal(id));
      };
      const service = yield* makeOpenCodeTextGeneration(fixture.runtime);
      assert.deepStrictEqual(yield* service.generateThreadTitle(input), {
        title: "Improve caching",
      });
      assert.strictEqual(fixture.leases(), 0);
      assert.strictEqual(fixture.sessions.size, 0);
      assert.deepStrictEqual(fixture.requests[0]?.body, {
        title: "Test Rig generateThreadTitle",
        model: { providerID: "opencode", id: "big-pickle" },
        location: { directory: "/tmp" },
        permissions: [{ action: "*", resource: "*", effect: "ask" }],
      });
      assert.isTrue(fixture.requests.some((r) => r.method === "DELETE"));
    }),
  );
  it.effect("fails and cleans up when the native stream closes", () =>
    Effect.gen(function* () {
      const fixture = yield* makeOpenCode2Fixture;
      const service = yield* makeOpenCodeTextGeneration(fixture.runtime);
      const fiber = yield* service.generateThreadTitle(input).pipe(Effect.forkChild);
      yield* Queue.take(fixture.calls);
      yield* Queue.take(fixture.calls);
      yield* Queue.end(fixture.events);
      assert.isTrue(Exit.isFailure(yield* Fiber.await(fiber)));
      assert.strictEqual(fixture.sessions.size, 0);
      assert.strictEqual(fixture.leases(), 0);
    }),
  );
  it.effect("cleans up after a prompt failure", () =>
    Effect.gen(function* () {
      const fixture = yield* makeOpenCode2Fixture;
      fixture.behavior.failPrompt = true;
      const service = yield* makeOpenCodeTextGeneration(fixture.runtime);
      assert.isTrue(Exit.isFailure(yield* Effect.exit(service.generateThreadTitle(input))));
      assert.strictEqual(fixture.sessions.size, 0);
      assert.strictEqual(fixture.leases(), 0);
    }),
  );
  it.effect("cleans up an interrupted pending generation", () =>
    Effect.gen(function* () {
      const fixture = yield* makeOpenCode2Fixture;
      const service = yield* makeOpenCodeTextGeneration(fixture.runtime);
      const fiber = yield* service.generateThreadTitle(input).pipe(Effect.forkChild);
      yield* Queue.take(fixture.calls); // session.create
      yield* Queue.take(fixture.calls); // session.prompt
      yield* Fiber.interrupt(fiber);
      assert.strictEqual(fixture.sessions.size, 0);
      assert.strictEqual(fixture.leases(), 0);
      assert.isTrue(fixture.requests.some((r) => r.path.endsWith("/interrupt")));
    }),
  );
  it.effect("rejects malformed structured output after releasing its temporary session", () =>
    Effect.gen(function* () {
      const fixture = yield* makeOpenCode2Fixture;
      fixture.behavior.onPrompt = (id) => {
        fixture.emit(fixture.text(id, "not JSON"));
        fixture.emit(fixture.terminal(id));
      };
      const service = yield* makeOpenCodeTextGeneration(fixture.runtime);
      assert.isTrue(Exit.isFailure(yield* Effect.exit(service.generateThreadTitle(input))));
      assert.strictEqual(fixture.sessions.size, 0);
    }),
  );
});
