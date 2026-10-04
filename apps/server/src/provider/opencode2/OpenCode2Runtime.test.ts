import { it, assert } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { OpenCodeRuntimeError } from "../opencodeRuntime.ts";
import type { OpenCode2Connection } from "./OpenCode2Server.ts";
import { makeOpenCode2Runtime } from "./OpenCode2Runtime.ts";

it.effect("keeps the shared server lease until the consumer scope closes", () =>
  Effect.gen(function* () {
    const released = yield* Deferred.make<void>();
    const nativeClient = {} as OpenCode2Connection["nativeClient"];
    const connection = { nativeClient, version: "2.0.18", external: true } as OpenCode2Connection;
    const runtime = makeOpenCode2Runtime({
      withConnection: (use) =>
        use(connection).pipe(Effect.ensuring(Deferred.succeed(released, undefined))),
    });
    const scope = yield* Scope.make();
    const acquired = yield* runtime.acquire.pipe(Effect.provideService(Scope.Scope, scope));
    assert.strictEqual(acquired.client, nativeClient);
    assert.strictEqual(acquired.version, "2.0.18");
    assert.isTrue(acquired.external);
    assert.isFalse(yield* Deferred.isDone(released));
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(yield* Deferred.isDone(released));
  }),
);

it.effect("propagates connection failures to the borrower", () =>
  Effect.gen(function* () {
    const error = new OpenCodeRuntimeError({ operation: "connect", detail: "unavailable" });
    const runtime = makeOpenCode2Runtime({ withConnection: () => Effect.fail(error) });
    const failure = yield* Effect.scoped(runtime.acquire).pipe(Effect.flip);
    assert.strictEqual(failure, error);
  }),
);
