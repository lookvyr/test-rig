import type { ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient } from "effect/unstable/http";

import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";
import * as ThreadSnapshotLoader from "./threadSnapshotHttp.ts";

// Same cold-open budget as the full snapshot path; bounded payloads should fit.
const DEFAULT_BOUNDED_THREAD_SNAPSHOT_TIMEOUT_MS = 6_000;

/** Load a bounded recent-window thread snapshot over HTTP. */
export const fetchEnvironmentBoundedThreadSnapshot = Effect.fn(
  "clientRuntime.state.fetchEnvironmentBoundedThreadSnapshot",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly timeoutMs?: number;
}) {
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    ...input,
    group: "orchestration",
    method: "GET",
    url: (httpBaseUrl) =>
      environmentEndpointUrl(httpBaseUrl, `/api/orchestration/threads/${input.threadId}/bounded`),
    timeoutMs: input.timeoutMs ?? DEFAULT_BOUNDED_THREAD_SNAPSHOT_TIMEOUT_MS,
    request: ({ client, headers }) =>
      client.threadBoundedSnapshot({
        params: { threadId: input.threadId },
        headers: withOrchestrationProtocolHeader(headers),
      }),
  });
});

/** Loads recent history; connectivity failures may use the bounded socket snapshot. */
export const boundedThreadSnapshotLoaderLayer: Layer.Layer<
  ThreadSnapshotLoader.ThreadSnapshotLoader,
  never,
  HttpClient.HttpClient
> = Layer.effect(
  ThreadSnapshotLoader.ThreadSnapshotLoader,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;

    return ThreadSnapshotLoader.ThreadSnapshotLoader.of({
      load: (prepared: PreparedConnection, threadId: ThreadId) => {
        return fetchEnvironmentBoundedThreadSnapshot({
          prepared,
          threadId,
        }).pipe(
          Effect.map((bounded): ThreadSnapshotLoader.ThreadSnapshotLoadResult => ({
            _tag: "present",
            snapshot: {
              snapshotSequence: bounded.snapshotSequence,
              projection: bounded.projection,
              latestLocalTurnOrdinal: bounded.latestLocalTurnOrdinal,
            },
            history: {
              historyCursor: bounded.historyCursor,
              hasMoreHistory: bounded.hasMoreHistory,
              latestLocalTurnOrdinal: bounded.latestLocalTurnOrdinal,
            },
          })),
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.catchTags({
            EnvironmentResourceNotFoundError: () =>
              Effect.logDebug(
                "Bounded thread snapshot not found over HTTP; treating the thread as deleted.",
              ).pipe(
                Effect.annotateLogs({ threadId }),
                Effect.as({
                  _tag: "missing",
                } satisfies ThreadSnapshotLoader.ThreadSnapshotLoadResult),
              ),
          }),
          Effect.catchCause((cause) =>
            Effect.logWarning(
              "Could not load the bounded thread snapshot over HTTP; using the socket snapshot instead.",
            ).pipe(
              Effect.annotateLogs({ threadId, cause: Cause.pretty(cause) }),
              Effect.as({
                _tag: "unavailable",
              } satisfies ThreadSnapshotLoader.ThreadSnapshotLoadResult),
            ),
          ),
        );
      },
    });
  }),
);
