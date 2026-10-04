import * as Effect from "effect/Effect";
import { FetchHttpClient } from "effect/unstable/http";

import type { PreparedHttpAuthorization } from "../connection/model.ts";
import type { PreparedConnection } from "../connection/model.ts";
import {
  ORCHESTRATION_PROTOCOL_HEADER,
  ORCHESTRATION_PROTOCOL_VERSION_TEXT,
} from "@t3tools/contracts";
import { executeEnvironmentHttpRequest, makeEnvironmentHttpApiClient } from "../rpc/http.ts";

export interface EnvironmentHttpAuthHeaders {
  readonly authorization?: string;
}

export const withEnvironmentCredentials = <A, E, R>(
  authorization: PreparedHttpAuthorization | null,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  authorization === null
    ? request.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
    : request;

export const buildEnvironmentAuthHeaders = (
  authorization: PreparedHttpAuthorization | null,
): EnvironmentHttpAuthHeaders =>
  authorization === null ? {} : { authorization: `Bearer ${authorization.token}` };

export function withOrchestrationProtocolHeader(headers: EnvironmentHttpAuthHeaders) {
  return {
    ...headers,
    [ORCHESTRATION_PROTOCOL_HEADER]: ORCHESTRATION_PROTOCOL_VERSION_TEXT,
  } as const;
}

type EnvironmentClient = Effect.Success<ReturnType<typeof makeEnvironmentHttpApiClient>>;

/** Shared cookie/bearer authorization for bounded HTTP snapshots and history. */
export const executeAuthenticatedEnvironmentHttpRequest = Effect.fn(
  "executeAuthenticatedEnvironmentHttpRequest",
)(function* <Group extends keyof EnvironmentClient, A, E, R>(input: {
  readonly prepared: PreparedConnection;
  readonly method: "GET" | "POST";
  readonly url: (baseUrl: string) => string;
  readonly timeoutMs: number;
  readonly group: Group;
  readonly request: (input: {
    readonly client: EnvironmentClient[Group];
    readonly headers: EnvironmentHttpAuthHeaders;
  }) => Effect.Effect<A, E, R>;
}) {
  const client = yield* makeEnvironmentHttpApiClient(input.prepared.httpBaseUrl);
  return yield* executeEnvironmentHttpRequest(
    input.url(input.prepared.httpBaseUrl),
    input.timeoutMs,
    withEnvironmentCredentials(
      input.prepared.httpAuthorization,
      input.request({
        client: client[input.group],
        headers: buildEnvironmentAuthHeaders(input.prepared.httpAuthorization),
      }),
    ),
  );
});
