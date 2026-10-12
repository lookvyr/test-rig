import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { EnvironmentCacheStore } from "../platform/persistence.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createServerEnvironmentAtoms } from "./server.ts";

describe("skill library query invalidation", () => {
  it.effect(
    "refreshes current and cached workspace catalogues after successful library mutations",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const environmentId = EnvironmentId.make("library-refresh");
          const target = new PrimaryConnectionTarget({
            environmentId,
            label: "Skills",
            httpBaseUrl: "http://skills.test",
            wsBaseUrl: "ws://skills.test",
          });
          let enabled = false;
          let requests = 0;
          const client = {
            [WS_METHODS.serverGetProviderWorkspaceCatalog]: () =>
              Effect.sync(() => {
                requests += 1;
                return {
                  skills: enabled
                    ? [
                        {
                          name: "test-rig:12345678-1234-4234-8234-123456789abc",
                          enabled: true,
                          path: "/library/SKILL.md",
                        },
                      ]
                    : [],
                  slashCommands: [],
                };
              }),
            [WS_METHODS.skillLibraryUpsert]: () =>
              Effect.sync(() => {
                enabled = true;
                return {};
              }),
            [WS_METHODS.skillLibraryDelete]: () =>
              Effect.sync(() => {
                enabled = false;
              }),
            [WS_METHODS.skillLibraryImport]: () =>
              Effect.sync(() => {
                enabled = true;
                return {};
              }),
            [WS_METHODS.skillLibraryList]: () => Effect.succeed({ skills: [] }),
          } as unknown as WsRpcProtocolClient;
          const supervisor = EnvironmentSupervisor.of({
            target,
            state: yield* SubscriptionRef.make<SupervisorConnectionState>({
              ...AVAILABLE_CONNECTION_STATE,
              phase: "connected",
              generation: 1,
            }),
            session: yield* SubscriptionRef.make<Option.Option<RpcSession>>(
              Option.some({
                client,
                initialConfig: Effect.never,
                ready: Effect.void,
                probe: Effect.void,
                closed: Effect.never,
              }),
            ),
            prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
            connect: Effect.void,
            disconnect: Effect.void,
            retryNow: Effect.void,
          });
          const run: EnvironmentRegistry["Service"]["run"] = (_environmentId, effect) =>
            Effect.provideService(effect, EnvironmentSupervisor, supervisor);
          const followStream: EnvironmentRegistry["Service"]["followStream"] = (
            _environmentId,
            stream,
          ) => Stream.provideService(stream, EnvironmentSupervisor, supervisor);
          const runtime = Atom.runtime(
            Layer.merge(
              Layer.succeed(
                EnvironmentRegistry,
                EnvironmentRegistry.of({
                  run,
                  followStream,
                } as unknown as EnvironmentRegistry["Service"]),
              ),
              Layer.succeed(EnvironmentCacheStore, {} as EnvironmentCacheStore["Service"]),
            ),
          );
          const tasks = new Set<() => void>();
          const registry = yield* Effect.acquireRelease(
            Effect.sync(() =>
              AtomRegistry.make({
                scheduleTask: (task) => {
                  tasks.add(task);
                  return () => tasks.delete(task);
                },
              }),
            ),
            (registry) => Effect.sync(() => registry.dispose()),
          );
          const drain = () => {
            while (tasks.size) {
              const task = tasks.values().next().value!;
              tasks.delete(task);
              task();
            }
          };
          const server = createServerEnvironmentAtoms(runtime, {
            initialConfigValueAtom: () => Atom.make(null),
          });
          const query = server.providerWorkspaceCatalog({
            environmentId,
            input: { instanceId: ProviderInstanceId.make("codex"), cwd: "/repo" },
          });
          const unmount = registry.mount(query);
          expect((yield* AtomRegistry.getResult(registry, query)).skills).toEqual([]);
          const upsert = yield* Effect.promise(() =>
            server.upsertSkillLibrary.run(registry, {
              environmentId,
              input: {
                name: "Review",
                description: "",
                providers: ["codex"],
                assignment: { allProjects: true, projectIds: [], disabledProjectIds: [] },
                instructions: "Review changes",
              },
            }),
          );
          expect(AsyncResult.isSuccess(upsert)).toBe(true);
          expect(
            (yield* AtomRegistry.getResult(registry, query, { suspendOnWaiting: true })).skills,
          ).toHaveLength(1);
          expect(requests).toBe(2);
          unmount();
          drain();
          const id = "12345678-1234-4234-8234-123456789abc";
          yield* Effect.promise(() =>
            server.deleteSkillLibrary.run(registry, { environmentId, input: { id } }),
          );
          const stop = registry.mount(query);
          expect(
            (yield* AtomRegistry.getResult(registry, query, { suspendOnWaiting: true })).skills,
          ).toEqual([]);
          expect(requests).toBe(3);
          yield* Effect.promise(() =>
            server.importSkillLibrary.run(registry, {
              environmentId,
              input: {
                instanceId: ProviderInstanceId.make("codex"),
                cwd: "/repo",
                sourcePath: "/native/SKILL.md",
                providers: ["codex"],
                assignment: { allProjects: true, projectIds: [], disabledProjectIds: [] },
              },
            }),
          );
          expect(
            (yield* AtomRegistry.getResult(registry, query, { suspendOnWaiting: true })).skills,
          ).toHaveLength(1);
          expect(requests).toBe(4);
          stop();
        }),
      ),
  );
});
