import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  bootstrapRemoteBearerSession,
  fetchRemoteSessionState,
  resolveRemoteWebSocketConnectionUrl,
} from "./remote.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";

type FetchCall = readonly [input: RequestInfo | URL, init: RequestInit];

function recordedFetch(...responses: ReadonlyArray<Response>) {
  const calls: Array<FetchCall> = [];
  let responseIndex = 0;
  const fetchFn = ((input, init) => {
    calls.push([input, init ?? {}]);
    const response = responses[responseIndex++];
    return response
      ? Promise.resolve(response)
      : Promise.reject(new Error("Unexpected fetch call"));
  }) satisfies typeof fetch;
  return { calls, fetchFn };
}

const provideRemoteHttp = (fetchFn: typeof fetch) => Effect.provide(remoteHttpClientLayer(fetchFn));

describe("remote environment authorization", () => {
  it.effect("bootstraps only bearer authentication against a remote backend", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(
        Response.json({
          access_token: "bearer-token",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "orchestration:read access:read",
        }),
      );

      const result = yield* bootstrapRemoteBearerSession({
        httpBaseUrl: "https://remote.example.com/",
        credential: "pairing-token",
      }).pipe(provideRemoteHttp(fetch.fetchFn));

      expect(result).toMatchObject({ token_type: "Bearer", access_token: "bearer-token" });
      expect(String(fetch.calls[0]?.[0])).toBe("https://remote.example.com/oauth/token");
      expect(fetch.calls[0]?.[1].headers).not.toEqual(
        expect.objectContaining({ dpop: expect.anything() }),
      );
    }),
  );

  it.effect("uses Bearer for session admission and websocket tickets", () =>
    Effect.gen(function* () {
      const fetch = recordedFetch(
        Response.json({
          authenticated: true,
          auth: {
            policy: "remote-reachable",
            bootstrapMethods: ["one-time-token"],
            sessionMethods: ["browser-session-cookie", "bearer-access-token"],
            sessionCookieName: "t3-session",
          },
          sessionMethod: "bearer-access-token",
        }),
        Response.json({ ticket: "ws-ticket", expiresAt: "2026-08-15T21:00:00.000Z" }),
      );

      yield* fetchRemoteSessionState({
        httpBaseUrl: "https://remote.example.com",
        bearerToken: "bearer-token",
      }).pipe(provideRemoteHttp(fetch.fetchFn));
      const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
        httpBaseUrl: "https://remote.example.com",
        wsBaseUrl: "wss://remote.example.com",
        bearerToken: "bearer-token",
      }).pipe(provideRemoteHttp(fetch.fetchFn));

      expect(socketUrl).toBe("wss://remote.example.com/ws?wsTicket=ws-ticket");
      for (const [, init] of fetch.calls) {
        expect(init.headers).toEqual(
          expect.objectContaining({ authorization: "Bearer bearer-token" }),
        );
        expect(init.headers).not.toEqual(expect.objectContaining({ dpop: expect.anything() }));
      }
    }),
  );
});
