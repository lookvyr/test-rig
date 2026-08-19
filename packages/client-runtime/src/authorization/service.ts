import { EnvironmentId, type ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as HttpClient from "effect/unstable/http/HttpClient";

import { environmentMismatchError, mapRemoteEnvironmentError } from "../connection/errors.ts";
import type { ConnectionAttemptError, PreparedHttpAuthorization } from "../connection/model.ts";
import { fetchRemoteEnvironmentDescriptor } from "../environment/descriptor.ts";
import { resolveRemoteWebSocketConnectionUrl } from "./remote.ts";

export interface AuthorizedRemoteEnvironment {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly socketUrl: string;
  readonly httpAuthorization: PreparedHttpAuthorization;
}

export class RemoteEnvironmentAuthorization extends Context.Service<
  RemoteEnvironmentAuthorization,
  {
    readonly authorizeBearer: (input: {
      readonly expectedEnvironmentId: EnvironmentId;
      readonly httpBaseUrl: string;
      readonly wsBaseUrl: string;
      readonly bearerToken: string;
    }) => Effect.Effect<AuthorizedRemoteEnvironment, ConnectionAttemptError>;
  }
>()("@t3tools/client-runtime/authorization/service/RemoteEnvironmentAuthorization") {}

const BEARER_DESCRIPTOR_CACHE_TTL_MS = 10_000;

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const descriptors = yield* Ref.make<
    ReadonlyMap<
      EnvironmentId,
      {
        readonly httpBaseUrl: string;
        readonly descriptor: ExecutionEnvironmentDescriptor;
        readonly validatedAtEpochMs: number;
      }
    >
  >(new Map());

  const authorizeBearer: RemoteEnvironmentAuthorization["Service"]["authorizeBearer"] = Effect.fn(
    "clientRuntime.connection.remote.authorizeBearer",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    const cached = (yield* Ref.get(descriptors)).get(input.expectedEnvironmentId);
    const canReuse =
      cached?.httpBaseUrl === input.httpBaseUrl &&
      cached.validatedAtEpochMs + BEARER_DESCRIPTOR_CACHE_TTL_MS > now;
    const descriptor = canReuse
      ? cached.descriptor
      : yield* fetchRemoteEnvironmentDescriptor({ httpBaseUrl: input.httpBaseUrl }).pipe(
          Effect.mapError(mapRemoteEnvironmentError),
          Effect.provideService(HttpClient.HttpClient, httpClient),
        );
    if (descriptor.environmentId !== input.expectedEnvironmentId) {
      return yield* environmentMismatchError({
        expected: input.expectedEnvironmentId,
        actual: descriptor.environmentId,
      });
    }
    if (!canReuse) {
      yield* Ref.update(descriptors, (current) =>
        new Map(current).set(input.expectedEnvironmentId, {
          httpBaseUrl: input.httpBaseUrl,
          descriptor,
          validatedAtEpochMs: now,
        }),
      );
    }
    const socketUrl = yield* resolveRemoteWebSocketConnectionUrl(input).pipe(
      Effect.mapError(mapRemoteEnvironmentError),
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );
    return {
      environmentId: descriptor.environmentId,
      label: descriptor.label,
      httpBaseUrl: input.httpBaseUrl,
      socketUrl,
      httpAuthorization: { _tag: "Bearer", token: input.bearerToken },
    };
  });

  return RemoteEnvironmentAuthorization.of({ authorizeBearer });
});

export const layer = Layer.effect(RemoteEnvironmentAuthorization, make);
