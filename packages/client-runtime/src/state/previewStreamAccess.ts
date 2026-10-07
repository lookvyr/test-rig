import * as Effect from "effect/Effect";
import type { PreparedConnection } from "../connection/model.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import type { DeviceHubAccess } from "../device/hubAccess.ts";
export type { DeviceHubAccess } from "../device/hubAccess.ts";

/** Stream tickets use the environment's existing cookie/bearer authentication. */
export const resolveDeviceHubAccess = Effect.fn("previewStreamAccess")(function* (input: {
  readonly prepared: PreparedConnection;
  readonly hubBasePath: string;
}) {
  const httpBase = environmentEndpointUrl(input.prepared.httpBaseUrl, input.hubBasePath);
  const wsBase = httpBase.replace(/^http/, "ws");
  if (input.prepared.httpAuthorization === null)
    return { httpBase, wsBase, query: {}, credentials: true } satisfies DeviceHubAccess;
  const ticket = yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared: input.prepared,
    group: "auth",
    method: "POST",
    timeoutMs: 8000,
    url: (base) => environmentEndpointUrl(base, "/api/auth/websocket-ticket"),
    request: ({ client, headers }) => client.webSocketTicket({ headers }),
  });
  return {
    httpBase,
    wsBase,
    query: { wsTicket: ticket.ticket },
    credentials: false,
  } satisfies DeviceHubAccess;
});
