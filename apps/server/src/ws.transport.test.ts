import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc";
import type { FromServer } from "effect/unstable/rpc/RpcMessage";
import { WS_RPC_SERVER_OPTIONS } from "./ws.ts";

const Group = RpcGroup.make(
  Rpc.make("subscribe", { success: Schema.Finite, stream: true }),
  Rpc.make("denied", { success: Schema.Void, error: Schema.String }),
  Rpc.make("defect", { success: Schema.Void }),
  Rpc.make("probe", { success: Schema.String }),
);

it.effect("contains handler failures and defects without ending sibling subscriptions", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const changes = yield* Queue.unbounded<number>();
      const responses = yield* Queue.unbounded<FromServer<RpcGroup.Rpcs<typeof Group>>>();
      const server = yield* RpcServer.makeNoSerialization(Group, {
        ...WS_RPC_SERVER_OPTIONS,
        onFromServer: (response) => Queue.offer(responses, response).pipe(Effect.asVoid),
      }).pipe(
        Effect.provide(
          Group.toLayer({
            subscribe: () => Stream.fromQueue(changes),
            denied: () => Effect.fail("permission denied"),
            defect: () => Effect.die(new Error("handler defect")),
            probe: () => Effect.succeed("ok"),
          }),
        ),
      );
      const client = yield* RpcClient.makeNoSerialization(Group, {
        supportsAck: true,
        onFromClient: ({ message }) => server.write(0, message),
      });
      yield* Stream.fromQueue(responses).pipe(Stream.runForEach(client.write), Effect.forkScoped);
      const received = yield* Queue.unbounded<number>();
      const sibling = yield* client.client.subscribe().pipe(
        Stream.runForEach((value) => Queue.offer(received, value)),
        Effect.forkScoped,
      );
      yield* Queue.offer(changes, 1);
      expect(yield* Queue.take(received)).toBe(1);
      expect((yield* Effect.exit(client.client.denied()))._tag).toBe("Failure");
      expect((yield* Effect.exit(client.client.defect()))._tag).toBe("Failure");
      expect(yield* client.client.probe()).toBe("ok");
      yield* Queue.offer(changes, 2);
      expect(
        yield* Queue.take(received).pipe(
          Effect.raceFirst(Fiber.await(sibling).pipe(Effect.as("subscription ended"))),
        ),
      ).toBe(2);
      yield* Fiber.interrupt(sibling);
      expect(yield* client.client.probe()).toBe("ok");
    }),
  ),
);
