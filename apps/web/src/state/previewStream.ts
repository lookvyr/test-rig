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
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

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

const ACCESS_RETRY_INTERVAL_MS = 10_000;

// Only a surface the user is looking at retries a failed lookup; one-shot readers such as
// picture-in-picture see the failure at once.
const retryingPreviewStreamAccessAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const access = previewStreamAccessAtom(environmentId);
    const result = get(access);
    if (AsyncResult.isFailure(result)) {
      const timer = setTimeout(() => get.refresh(access), ACCESS_RETRY_INTERVAL_MS);
      get.addFinalizer(() => clearTimeout(timer));
    }
    return result;
  }),
);

export function usePreviewStreamAccess(
  environmentId: EnvironmentId,
  options?: { readonly retry: boolean },
): DeviceHubAccess | null {
  const result = useAtomValue(
    options?.retry
      ? retryingPreviewStreamAccessAtom(environmentId)
      : previewStreamAccessAtom(environmentId),
  );
  return AsyncResult.isSuccess(result) ? result.value : null;
}

export function readPreviewStreamAccess(
  environmentId: EnvironmentId,
  refresh: boolean,
): Promise<DeviceHubAccess | null> {
  const atom = previewStreamAccessAtom(environmentId);
  if (refresh) appAtomRegistry.refresh(atom);
  return Effect.runPromise(
    AtomRegistry.getResult(appAtomRegistry, atom, { suspendOnWaiting: true }).pipe(
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed(() => null),
    ),
  );
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
