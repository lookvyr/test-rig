import type { AgentInfo, ModelInfo, ProviderInfo } from "@opencode/client";
import type { OpenCodeSettings, ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Stream from "effect/Stream";
import * as Effect from "effect/Effect";
import { buildServerProvider, providerModelsFromSettings } from "../providerSnapshot.ts";
import { openCodeRuntimeErrorDetail } from "../opencodeRuntime.ts";
import { type OpenCode2Runtime, runOpenCode2 } from "./OpenCode2Runtime.ts";

const presentation = { displayName: "OpenCode", showInteractionModeToggle: true } as const;
const defaultCapabilities = createModelCapabilities({ optionDescriptors: [] });

export function openCode2Models(
  models: ReadonlyArray<ModelInfo>,
  agents: ReadonlyArray<AgentInfo>,
  providers: ReadonlyArray<ProviderInfo>,
): ReadonlyArray<ServerProviderModel> {
  const primaryAgents = agents.filter((agent) => !agent.hidden && agent.mode !== "subagent");
  return models
    .filter((model) => model.enabled)
    .map((model) => ({
      slug: `${model.providerID}/${model.id}`,
      name: model.name,
      isCustom: false,
      subProvider:
        providers.find((provider) => provider.id === model.providerID)?.name ?? model.providerID,
      capabilities: createModelCapabilities({
        optionDescriptors: [
          ...(model.variants.length
            ? [
                {
                  id: "variant",
                  label: "Variant",
                  type: "select" as const,
                  options: model.variants.map((variant) => ({ id: variant.id, label: variant.id })),
                },
              ]
            : []),
          ...(primaryAgents.length
            ? [
                {
                  id: "agent",
                  label: "Agent",
                  type: "select" as const,
                  options: primaryAgents.map((agent) => ({
                    id: agent.id,
                    label: agent.name,
                    ...(agent.id === "build" ? { isDefault: true as const } : {}),
                  })),
                },
              ]
            : []),
        ],
      }),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export const makePendingOpenCode2Provider = (settings: OpenCodeSettings) =>
  Effect.gen(function* () {
    return buildServerProvider({
      presentation,
      enabled: settings.enabled,
      checkedAt: DateTime.formatIso(yield* DateTime.now),
      models: providerModelsFromSettings([], settings.customModels, defaultCapabilities),
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: settings.enabled
          ? "OpenCode 2 status has not been checked yet."
          : "OpenCode is disabled in Test Rig settings.",
      },
    });
  });

export const checkOpenCode2ProviderStatus = (
  settings: OpenCodeSettings,
  cwd: string,
  runtime: OpenCode2Runtime,
) =>
  Effect.gen(function* () {
    if (!settings.enabled) return yield* makePendingOpenCode2Provider(settings);
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    const result = yield* Effect.gen(function* () {
      const { client, version, subscribe } = yield* runtime.acquire;
      const modelReady = yield* Deferred.make<void>();
      const workspaceReady = yield* Deferred.make<void>();
      const pendingScan = new Set(["command.updated", "skill.updated"]);
      const events = yield* subscribe;
      yield* events.pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type === "model.updated") yield* Deferred.succeed(modelReady, undefined);
            if (event.type === "command.updated" || event.type === "skill.updated") {
              if (event.location?.directory !== cwd) return;
              pendingScan.delete(event.type);
              if (!pendingScan.size) yield* Deferred.succeed(workspaceReady, undefined);
            }
          }),
        ),
        Effect.ignore,
        Effect.forkScoped,
      );
      const location = { directory: cwd };
      let [models, agents, providers, commands, skills] = yield* Effect.all(
        [
          runOpenCode2("model.list", (signal) => client.model.list({ location }, { signal })),
          runOpenCode2("agent.list", (signal) => client.agent.list({ location }, { signal })),
          runOpenCode2("provider.list", (signal) => client.provider.list({ location }, { signal })),
          runOpenCode2("command.list", (signal) => client.command.list({ location }, { signal })),
          runOpenCode2("skill.list", (signal) => client.skill.list({ location }, { signal })),
        ],
        { concurrency: "unbounded" },
      );
      // A fresh server scans its catalog and workspace asynchronously. Its native
      // update events end that scan; no idle refresh loop is needed here.
      if (models.data.length === 0) {
        yield* Deferred.await(modelReady).pipe(Effect.timeoutOption("5 seconds"));
        models = yield* runOpenCode2("model.list", (signal) =>
          client.model.list({ location }, { signal }),
        );
      }
      if (commands.data.length === 0) {
        yield* Deferred.await(workspaceReady).pipe(Effect.timeoutOption("5 seconds"));
        [agents, providers, commands, skills] = yield* Effect.all(
          [
            runOpenCode2("agent.list", (signal) => client.agent.list({ location }, { signal })),
            runOpenCode2("provider.list", (signal) =>
              client.provider.list({ location }, { signal }),
            ),
            runOpenCode2("command.list", (signal) => client.command.list({ location }, { signal })),
            runOpenCode2("skill.list", (signal) => client.skill.list({ location }, { signal })),
          ],
          { concurrency: "unbounded" },
        );
      }
      const discovered = openCode2Models(models.data, agents.data, providers.data);
      return buildServerProvider({
        presentation,
        enabled: true,
        checkedAt,
        models: providerModelsFromSettings(discovered, settings.customModels, defaultCapabilities),
        slashCommands: [
          { name: "compact", description: "Compact conversation context" },
          ...commands.data.filter((command) => command.name !== "compact"),
        ],
        skills: skills.data.map((skill) => ({
          name: skill.id,
          displayName: skill.name,
          path: skill.path,
          enabled: true,
          ...(skill.description ? { description: skill.description } : {}),
        })),
        probe: {
          installed: true,
          version,
          status: discovered.length ? "ready" : "warning",
          auth: { status: discovered.length ? "authenticated" : "unknown", type: "opencode" },
          message: discovered.length
            ? "Connected to OpenCode 2."
            : "OpenCode 2 did not report any enabled models.",
        },
      });
    }).pipe(Effect.timeout("45 seconds"), Effect.scoped, Effect.exit);
    if (result._tag === "Success") return result.value;
    return buildServerProvider({
      presentation,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings([], settings.customModels, defaultCapabilities),
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: openCodeRuntimeErrorDetail(Cause.squash(result.cause)),
      },
    });
  });
