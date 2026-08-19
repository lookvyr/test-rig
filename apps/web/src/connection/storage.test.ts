import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import { ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import { makeCatalogBackend, makeCatalogStore } from "./storage";

const emptyCatalog = {
  schemaVersion: 2,
  targets: [],
  profiles: [],
  credentials: [],
} as const;
const decodeCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(ConnectionCatalogDocument));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("makeCatalogStore", () => {
  it.effect("quarantines malformed catalogs and starts from an empty document", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const quarantined: string[] = [];
      const store = yield* makeCatalogStore({
        read: Effect.succeed("{not-json"),
        write: (raw) => Effect.sync(() => writes.push(raw)),
        quarantine: (raw) => Effect.sync(() => quarantined.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(quarantined).toEqual(["{not-json"]);
      expect(writes).toHaveLength(1);
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
    }),
  );

  it.effect("does not hide catalog read failures", () =>
    Effect.gen(function* () {
      const failure = new ConnectionTransientError({
        reason: "remote-unavailable",
        detail: "permission denied",
      });
      const store = yield* makeCatalogStore({
        read: Effect.fail(failure),
        write: () => Effect.void,
      });

      expect(yield* Effect.flip(store.read)).toBe(failure);
    }),
  );

  it.effect("persists a sanitized v2 catalog after reading legacy relay data", () =>
    Effect.gen(function* () {
      const writes: string[] = [];
      const store = yield* makeCatalogStore({
        read: Effect.succeed(
          JSON.stringify({
            schemaVersion: 1,
            targets: [
              {
                _tag: "RelayConnectionTarget",
                environmentId: "env-relay",
                label: "Removed relay",
              },
            ],
            profiles: [],
            credentials: [],
            remoteDpopTokens: [{ accessToken: "removed-token" }],
          }),
        ),
        write: (raw) => Effect.sync(() => writes.push(raw)),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]!)).toEqual(emptyCatalog);
      expect(writes[0]).not.toContain("removed-token");
    }),
  );

  it.effect("recovers malformed legacy-shaped catalogs with only one handled write", () =>
    Effect.gen(function* () {
      let writes = 0;
      const store = yield* makeCatalogStore({
        read: Effect.succeed('{"schemaVersion":1,"targets":"invalid"}'),
        write: () => Effect.sync(() => void writes++),
      });

      expect(yield* store.read).toEqual(emptyCatalog);
      expect(writes).toBe(1);
    }),
  );
});

describe("makeCatalogBackend", () => {
  it.effect("fails writes when desktop secure storage declines the catalog", () =>
    Effect.gen(function* () {
      const setConnectionCatalog = vi.fn().mockResolvedValue(false);
      vi.stubGlobal("window", {
        desktopBridge: {
          getConnectionCatalog: vi.fn().mockResolvedValue(null),
          setConnectionCatalog,
        },
      });
      const backend = makeCatalogBackend({} as IDBDatabase);

      const error = yield* backend.write("{}").pipe(Effect.flip);

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("Desktop secure storage is unavailable");
      expect(setConnectionCatalog).toHaveBeenCalledWith("{}");
    }),
  );
});
