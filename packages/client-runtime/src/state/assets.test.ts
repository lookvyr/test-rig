import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Layer from "effect/Layer";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type NetworkStatus,
  type PreparedConnection,
} from "../connection/model.ts";
import type { ConnectionCatalogEntry } from "../connection/catalog.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  createAssetEnvironmentAtoms,
  InvalidAssetCollectionKeyError,
  parseAssetCollectionKey,
} from "./assets.ts";

describe("asset collection keys", () => {
  it("preserves malformed JSON and its native cause", () => {
    const key = "not-json";
    let error: unknown;

    try {
      parseAssetCollectionKey(key);
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(InvalidAssetCollectionKeyError);
    expect(error).toMatchObject({ key, cause: expect.any(SyntaxError) });
  });

  it("rejects invalid asset collection shapes", () => {
    const key = JSON.stringify(["environment-1", [{ _tag: "unknown" }]]);

    expect(() => parseAssetCollectionKey(key)).toThrowError(InvalidAssetCollectionKeyError);
  });
});

describe("createAssetEnvironmentAtoms", () => {
  it.effect("prepares each video upload in the requested environment without caching tickets", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("remote-recording");
      const input = {
        threadId: ThreadId.make("recording-thread"),
        upload: {
          type: "file" as const,
          name: "walkthrough.webm",
          mimeType: "video/webm",
          sizeBytes: 1024,
        },
      };
      const calls: unknown[] = [];
      const routedEnvironments: EnvironmentId[] = [];
      const client = {
        [WS_METHODS.assetsCreateAttachmentUploadUrl]: (uploadInput: typeof input) =>
          Effect.sync(() => {
            calls.push(uploadInput);
            return {
              attachmentId: `pending-${calls.length}`,
              relativeUrl: `/api/attachments/upload/token-${calls.length}`,
              expiresAt: 1000,
            };
          }),
      } as unknown as WsRpcProtocolClient;
      const supervisor = Layer.mock(EnvironmentSupervisor)({
        target: new PrimaryConnectionTarget({
          environmentId,
          label: "Remote recording",
          httpBaseUrl: "https://recording.test",
          wsBaseUrl: "wss://recording.test",
        }),
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        session: yield* SubscriptionRef.make(Option.some({ client } as RpcSession)),
      });
      const runtime = Atom.runtime(
        Layer.mock(EnvironmentRegistry)({
          entries: yield* SubscriptionRef.make<ReadonlyMap<EnvironmentId, ConnectionCatalogEntry>>(
            new Map(),
          ),
          networkStatus: yield* SubscriptionRef.make<NetworkStatus>("online"),
          run: (requestedEnvironmentId, effect) => {
            routedEnvironments.push(requestedEnvironmentId);
            return effect.pipe(Effect.provide(supervisor));
          },
        }),
      );
      const assets = createAssetEnvironmentAtoms(runtime);
      const registry = yield* Effect.acquireRelease(
        Effect.sync(() => AtomRegistry.make()),
        (registry) => Effect.sync(() => registry.dispose()),
      );
      const first = yield* Effect.promise(() =>
        assets.createAttachmentUploadUrl.run(registry, { environmentId, input }),
      );
      const second = yield* Effect.promise(() =>
        assets.createAttachmentUploadUrl.run(registry, { environmentId, input }),
      );
      expect(first).toMatchObject({ _tag: "Success", value: { attachmentId: "pending-1" } });
      expect(second).toMatchObject({ _tag: "Success", value: { attachmentId: "pending-2" } });
      expect(calls).toEqual([input, input]);
      expect(routedEnvironments).toEqual([environmentId, environmentId]);
    }).pipe(Effect.scoped),
  );

  it("keys asset URL queries by environment and resource", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const assets = createAssetEnvironmentAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");
    const originalTarget = {
      environmentId,
      input: {
        resource: {
          _tag: "project-favicon" as const,
          cwd: "/repo/original",
        },
      },
    };

    expect(assets.createUrl(originalTarget)).toBe(
      assets.createUrl({
        environmentId,
        input: {
          resource: {
            _tag: "project-favicon",
            cwd: "/repo/original",
          },
        },
      }),
    );
    expect(
      assets.createUrl({
        environmentId,
        input: {
          resource: {
            _tag: "project-favicon",
            cwd: "/repo/next",
          },
        },
      }),
    ).not.toBe(assets.createUrl(originalTarget));
    expect(
      assets.createUrl({
        environmentId: EnvironmentId.make("environment-2"),
        input: originalTarget.input,
      }),
    ).not.toBe(assets.createUrl(originalTarget));
  });

  it("keys collections while preserving independent resource queries", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const assets = createAssetEnvironmentAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");
    const resources = [
      { _tag: "attachment" as const, attachmentId: "attachment-1" },
      { _tag: "attachment" as const, attachmentId: "attachment-2" },
    ];

    expect(assets.createUrls({ environmentId, resources })).toBe(
      assets.createUrls({
        environmentId,
        resources: resources.map((resource) => ({ ...resource })),
      }),
    );
    expect(
      assets.createUrls({
        environmentId,
        resources: [...resources].toReversed(),
      }),
    ).not.toBe(assets.createUrls({ environmentId, resources }));
  });
});
