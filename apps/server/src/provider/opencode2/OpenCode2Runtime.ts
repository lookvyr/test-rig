import { OpenCode, type V2Event } from "@opencode/client";
import { parseSemver } from "@t3tools/shared/semver";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { OpenCodeRuntimeError } from "../opencodeRuntime.ts";
import type {
  OpenCode2Server,
  OpenCode2Connection as ServerConnection,
} from "./OpenCode2Server.ts";

export type OpenCode2Client = ReturnType<typeof OpenCode.make>;
export interface OpenCode2Connection {
  readonly client: OpenCode2Client;
  readonly version: string;
  readonly external: boolean;
  /** Opens the stream before returning, so prompts cannot outrun subscription. */
  readonly subscribe: Effect.Effect<
    Stream.Stream<V2Event, OpenCodeRuntimeError>,
    OpenCodeRuntimeError,
    Scope.Scope
  >;
}
export interface OpenCode2Runtime {
  readonly acquire: Effect.Effect<OpenCode2Connection, OpenCodeRuntimeError, Scope.Scope>;
}

export const runOpenCode2 = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new OpenCodeRuntimeError({ operation, detail: `OpenCode 2 ${operation} failed.`, cause }),
  });

export function requireOpenCode2Version(output: string): string | undefined {
  const version = /\bv?(\d+\.\d+\.\d+)\b/.exec(output)?.[1];
  const parsed = version ? parseSemver(version) : undefined;
  return parsed?.major === 2 ? (version ?? undefined) : undefined;
}

/** Lends the instance's upstream-owned server to legacy protocol consumers. */
export function makeOpenCode2Runtime(server: OpenCode2Server["Service"]): OpenCode2Runtime {
  return {
    acquire: Effect.gen(function* () {
      const lent = yield* Deferred.make<ServerConnection, OpenCodeRuntimeError>();
      yield* server
        .withConnection((connection) =>
          Deferred.succeed(lent, connection).pipe(Effect.andThen(Effect.never)),
        )
        .pipe(
          Effect.catch((error) => Deferred.fail(lent, error)),
          Effect.forkScoped,
        );
      const connection = yield* Deferred.await(lent);
      const client = connection.nativeClient;
      return {
        client,
        version: connection.version,
        external: connection.external,
        subscribe: Effect.gen(function* () {
          const controller = new AbortController();
          yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()));
          const subscription = client.event.subscribe({ signal: controller.signal });
          const iterator = subscription[Symbol.asyncIterator]();
          const first = yield* runOpenCode2("event.subscribe", () => iterator.next()).pipe(
            Effect.timeout("10 seconds"),
            Effect.mapError(
              (cause) =>
                new OpenCodeRuntimeError({
                  operation: "event.subscribe",
                  detail: "Could not subscribe to OpenCode 2 events.",
                  cause,
                }),
            ),
          );
          if (first.done)
            return yield* new OpenCodeRuntimeError({
              operation: "event.subscribe",
              detail: "OpenCode 2 closed its event stream.",
            });
          const source = { [Symbol.asyncIterator]: () => iterator };
          return Stream.concat(
            Stream.make(first.value),
            Stream.fromAsyncIterable(
              source,
              (cause) =>
                new OpenCodeRuntimeError({
                  operation: "events",
                  detail: "The OpenCode 2 event stream was lost.",
                  cause,
                }),
            ),
          );
        }),
      } satisfies OpenCode2Connection;
    }),
  };
}
