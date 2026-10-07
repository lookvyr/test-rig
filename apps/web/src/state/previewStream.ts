import { useAtomValue } from "@effect/atom-react";
import { PREVIEW_STREAM_BASE_PATH } from "@t3tools/client-runtime/preview/server-browser-stream";
import {
  type DeviceHubAccess,
  resolveDeviceHubAccess,
} from "@t3tools/client-runtime/state/preview-stream-access";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/unstable/http";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentSession } from "./session";

// Re-pairing changes the prepared connection, invalidating its cached ticket.
const previewStreamAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  connectionAtomRuntime
    .atom((get) => {
      const prepared = Option.getOrNull(
        get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      if (prepared === null) return Effect.never;
      return resolveDeviceHubAccess({ prepared, hubBasePath: PREVIEW_STREAM_BASE_PATH });
    })
    .pipe(Atom.setIdleTTL(60_000), Atom.withLabel(`preview-stream-access:${environmentId}`)),
);

export function usePreviewStreamAccess(environmentId: EnvironmentId): DeviceHubAccess | null {
  const result = useAtomValue(previewStreamAccessAtom(environmentId));
  return AsyncResult.isSuccess(result) ? result.value : null;
}

export function refreshPreviewStreamAccess(environmentId: EnvironmentId): void {
  appAtomRegistry.refresh(previewStreamAccessAtom(environmentId));
}

/** HTTP transfers mint fresh access even when their viewing socket has stayed connected. */
export async function refreshPreviewMediaUrl(
  environmentId: EnvironmentId,
  value: string,
): Promise<string> {
  const prepared = Option.getOrNull(
    appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
  );
  if (!prepared) throw new Error("The browser connection is unavailable.");
  // Transfers get their own ticket without replacing the active stream's access.
  const access = await Effect.runPromise(
    resolveDeviceHubAccess({ prepared, hubBasePath: PREVIEW_STREAM_BASE_PATH }).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  );
  const url = new URL(value);
  url.searchParams.delete("wsTicket");
  for (const [name, value] of Object.entries(access.query)) url.searchParams.set(name, value);
  return url.toString();
}
