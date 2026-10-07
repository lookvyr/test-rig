import { ConnectionTransientError } from "@t3tools/client-runtime/connection";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { EnvironmentCacheStore, ConnectionCatalogDocument } from "@t3tools/client-runtime/platform";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, vi } from "vite-plus/test";

import { connectionStorageLayer, makeCatalogBackend, makeCatalogStore } from "./storage";

const emptyCatalog = {
  schemaVersion: 2,
  targets: [],
  profiles: [],
  credentials: [],
} as const;
const encodeLegacyCatalog = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
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
          encodeLegacyCatalog({
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
      expect(decodeCatalog(writes[0]!)).toEqual(emptyCatalog);
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

const fixedHandle = (database: IDBDatabase) => ({
  get: Effect.succeed(database),
  invalidate: () => Effect.void,
});

describe("makeCatalogBackend", () => {
  it.effect("returns a typed failure after exactly one stale-operation retry", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      const transaction = vi.fn(() => {
        throw new DOMException("closed connection", "InvalidStateError");
      });
      const backend = makeCatalogBackend(fixedHandle({ transaction } as unknown as IDBDatabase));
      expect(yield* Effect.flip(backend.read)).toBeInstanceOf(ConnectionTransientError);
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(yield* Effect.flip(backend.write("{}"))).toBeInstanceOf(ConnectionTransientError);
      expect(transaction).toHaveBeenCalledTimes(4);
    }),
  );
  it.effect("returns a typed quota failure when a write transaction only aborts", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      const database = {
        transaction: () => {
          const transaction = Object.assign(new EventTarget(), {
            error: new DOMException("Storage full", "QuotaExceededError"),
            objectStore: () => ({
              put: () => queueMicrotask(() => transaction.dispatchEvent(new Event("abort"))),
            }),
          });
          return transaction;
        },
      } as unknown as IDBDatabase;
      const error = yield* Effect.flip(makeCatalogBackend(fixedHandle(database)).write("{}"));
      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("Storage full");
    }),
  );

  it.effect("fails writes when desktop secure storage declines the catalog", () =>
    Effect.gen(function* () {
      const setConnectionCatalog = vi.fn().mockResolvedValue(false);
      vi.stubGlobal("window", {
        desktopBridge: {
          getConnectionCatalog: vi.fn().mockResolvedValue(null),
          setConnectionCatalog,
        },
      });
      const backend = makeCatalogBackend(fixedHandle({} as IDBDatabase));

      const error = yield* backend.write("{}").pipe(Effect.flip);

      expect(error).toBeInstanceOf(ConnectionTransientError);
      expect(error.message).toContain("Desktop secure storage is unavailable");
      expect(setConnectionCatalog).toHaveBeenCalledWith("{}");
    }),
  );
});

describe("environment cache removal", () => {
  it.effect("fails both removal operations when IndexedDB aborts their commits", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      vi.stubGlobal("IDBKeyRange", { bound: () => ({}) });
      const database = Object.assign(new EventTarget(), {
        transaction: () => {
          const transaction = Object.assign(new EventTarget(), {
            error: new DOMException("Commit aborted", "AbortError"),
            objectStore: () => ({
              delete: () => queueMicrotask(() => transaction.dispatchEvent(new Event("abort"))),
              openCursor: () => {
                queueMicrotask(() => transaction.dispatchEvent(new Event("abort")));
                return new EventTarget();
              },
            }),
          });
          return transaction;
        },
        close: vi.fn(),
      }) as unknown as IDBDatabase;
      const openRequest = Object.assign(new EventTarget(), { result: database, error: null });
      vi.stubGlobal("indexedDB", {
        open: () => {
          queueMicrotask(() => openRequest.dispatchEvent(new Event("success")));
          return openRequest;
        },
      });

      const [threadError, refsError] = yield* Effect.gen(function* () {
        const cache = yield* EnvironmentCacheStore;
        return [
          yield* Effect.flip(
            cache.removeThread(EnvironmentId.make("env"), ThreadId.make("thread")),
          ),
          yield* Effect.flip(cache.clearVcsRefs(EnvironmentId.make("env"))),
        ] as const;
      }).pipe(Effect.provide(connectionStorageLayer));

      expect(threadError.message).toContain("Commit aborted");
      expect(refsError.message).toContain("Commit aborted");
      expect(database.close).toHaveBeenCalledOnce();
    }),
  );
});

describe("IndexedDB connection recovery", () => {
  it.effect("reports an initial open failure from the cache operation", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      const open = vi.fn(() => {
        throw new DOMException("Storage is unavailable", "InvalidStateError");
      });
      vi.stubGlobal("indexedDB", { open });

      yield* Effect.gen(function* () {
        const cache = yield* EnvironmentCacheStore;
        expect(open).not.toHaveBeenCalled();
        const error = yield* Effect.flip(
          cache.loadThread(EnvironmentId.make("env"), ThreadId.make("thread")),
        );
        expect(error.message).toContain("Storage is unavailable");
      }).pipe(Effect.provide(connectionStorageLayer));

      expect(open).toHaveBeenCalledOnce();
    }),
  );

  it.effect.each(["close", "versionchange"] as const)(
    "reopens after %s and finalizes the current connection",
    (event) =>
      Effect.gen(function* () {
        vi.stubGlobal("window", {});
        const makeDatabase = () =>
          Object.assign(new EventTarget(), {
            close: vi.fn(),
            transaction: () => ({
              objectStore: () => ({
                get: () => {
                  const request = Object.assign(new EventTarget(), {
                    result: undefined,
                    error: null,
                  });
                  queueMicrotask(() => request.dispatchEvent(new Event("success")));
                  return request;
                },
              }),
            }),
          }) as unknown as IDBDatabase;
        const first = makeDatabase();
        const second = makeDatabase();
        const databases = [first, second];
        let openCount = 0;
        const open = vi.fn(() => {
          const request = Object.assign(new EventTarget(), {
            result: databases[openCount++],
            error: null,
          });
          queueMicrotask(() => request.dispatchEvent(new Event("success")));
          return request;
        });
        vi.stubGlobal("indexedDB", { open });

        yield* Effect.gen(function* () {
          const cache = yield* EnvironmentCacheStore;
          const environmentId = EnvironmentId.make("env");
          const threadId = ThreadId.make("thread");
          expect(
            (yield* Effect.all(
              [
                cache.loadThread(environmentId, threadId),
                cache.loadThread(environmentId, threadId),
              ],
              { concurrency: 2 },
            )).every(Option.isNone),
          ).toBe(true);
          expect(open).toHaveBeenCalledTimes(1);

          first.dispatchEvent(new Event(event));
          const recovered = yield* Effect.all(
            [cache.loadThread(environmentId, threadId), cache.loadThread(environmentId, threadId)],
            { concurrency: 2 },
          );
          expect(recovered.every(Option.isNone)).toBe(true);
          expect(open).toHaveBeenCalledTimes(2);
        }).pipe(Effect.provide(connectionStorageLayer));

        expect(first.close).toHaveBeenCalledTimes(event === "versionchange" ? 1 : 0);
        expect(second.close).toHaveBeenCalledOnce();
      }),
  );
});

describe("IndexedDB connection closed without a close event", () => {
  it.effect("reopens and retries the failing operation once", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {});
      const closing = Object.assign(new EventTarget(), {
        close: vi.fn(),
        transaction: () => {
          // Chromium force-closed this connection; this tab never saw "close".
          throw new DOMException("The database connection is closing.", "InvalidStateError");
        },
      }) as unknown as IDBDatabase;
      const fresh = Object.assign(new EventTarget(), {
        close: vi.fn(),
        transaction: () => ({
          objectStore: () => ({
            get: () => {
              const request = Object.assign(new EventTarget(), { result: undefined, error: null });
              queueMicrotask(() => request.dispatchEvent(new Event("success")));
              return request;
            },
          }),
        }),
      }) as unknown as IDBDatabase;
      const databases = [closing, fresh];
      let openCount = 0;
      const open = vi.fn(() => {
        const request = Object.assign(new EventTarget(), {
          result: databases[openCount++],
          error: null,
        });
        queueMicrotask(() => request.dispatchEvent(new Event("success")));
        return request;
      });
      vi.stubGlobal("indexedDB", { open });

      yield* Effect.gen(function* () {
        const cache = yield* EnvironmentCacheStore;
        const loaded = yield* cache.loadThread(EnvironmentId.make("env"), ThreadId.make("thread"));
        expect(Option.isNone(loaded)).toBe(true);
        expect(open).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(connectionStorageLayer));
    }),
  );
});
