import {
  isAtomCommandInterrupted,
  mapAtomCommandResult,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectId,
  ProjectScript,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import { clearProjectSettingsOverrides } from "@t3tools/shared/projectSettings";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRef, useState } from "react";

import { isElectron } from "../../env";
import { decodeProjectScriptKeybindingRule } from "../../lib/projectScriptKeybindings";
import {
  buildProjectScript,
  commandForProjectScript,
  nextProjectScriptId,
  releaseClaimedRoles,
} from "../../projectScripts";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import type { NewProjectScriptInput } from "../ProjectScriptsControl";
import { toastManager } from "../ui/toast";

export interface ProjectScriptTarget {
  readonly environmentId: EnvironmentId;
  readonly settings: ServerSettings;
  readonly project: { readonly id: ProjectId; readonly scripts: readonly ProjectScript[] };
}

/** The patch that gives one project `next` as its own actions, or drops its override for null. */
export function projectScriptsPatch(
  settings: ServerSettings,
  projectId: ProjectId,
  next: readonly ProjectScript[] | null,
): ServerSettingsPatch {
  return {
    projectSettingsOverrides: {
      [projectId]:
        next === null
          ? clearProjectSettingsOverrides(settings, projectId, ["defaultProjectScripts"])
          : { ...settings.projectSettingsOverrides[projectId], defaultProjectScripts: next },
    },
  };
}

function reportScriptFailure(result: AtomCommandResult<unknown, unknown>) {
  if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
    const error = squashAtomCommandFailure(result);
    toastManager.add({
      type: "error",
      title: "Failed to save project actions",
      description: error instanceof Error ? error.message : "An error occurred.",
    });
  }
  return mapAtomCommandResult(result, () => undefined);
}

/**
 * Edits the actions of every checkout the Projects page selects. Each one
 * stores its list as its project's override, built from what it resolves to
 * now, so adding an action to several checkouts keeps their own lists.
 */
export function useProjectScriptSettings(targets: readonly ProjectScriptTarget[]) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const upsertKeybinding = useAtomCommand(serverEnvironment.upsertKeybinding, {
    reportFailure: false,
  });

  async function writeTargets(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
    scriptId: string | undefined,
    keybinding: string | null | undefined,
  ): Promise<AtomCommandResult<void, unknown>> {
    const boundEnvironments = new Set<EnvironmentId>();
    for (const { environmentId, settings, project } of targets) {
      const next = transform(resolveProjectScripts(settings, project));
      const result = await updateSettings({
        environmentId,
        input: { patch: projectScriptsPatch(settings, project.id, next) },
      });
      if (result._tag === "Failure") return reportScriptFailure(result);
      if (scriptId === undefined || boundEnvironments.has(environmentId)) continue;
      boundEnvironments.add(environmentId);
      const rule = decodeProjectScriptKeybindingRule({
        keybinding,
        command: commandForProjectScript(scriptId),
      });
      if (isElectron && rule) {
        const bindingResult = await upsertKeybinding({ environmentId, input: rule });
        if (bindingResult._tag === "Failure") return reportScriptFailure(bindingResult);
      }
    }
    return AsyncResult.success(undefined);
  }

  async function persist(
    transform: (current: readonly ProjectScript[]) => readonly ProjectScript[] | null,
    scriptId?: string,
    keybinding?: string | null,
  ): Promise<AtomCommandResult<void, unknown>> {
    if (savingRef.current || targets.length === 0) {
      const message = "Connect a checkout of this project, or wait for the last change to save.";
      toastManager.add({ type: "error", title: "Actions not saved", description: message });
      return AsyncResult.failure(Cause.fail(new Error(message)));
    }
    savingRef.current = true;
    setSaving(true);
    return writeTargets(transform, scriptId, keybinding).finally(() => {
      savingRef.current = false;
      setSaving(false);
    });
  }

  /** Adds an action (`scriptId` null) or replaces one, releasing roles another action held. */
  function submit(scriptId: string | null, input: NewProjectScriptInput) {
    const existingIds = targets.flatMap(({ settings, project }) =>
      resolveProjectScripts(settings, project).map((script) => script.id),
    );
    const id = scriptId ?? nextProjectScriptId(input.name, existingIds);
    return persist(
      (current) => {
        const previous = current.find((script) => script.id === id);
        const next = buildProjectScript(id, input, previous);
        const updated = current.map((script) =>
          script.id === id ? next : releaseClaimedRoles(script, input),
        );
        return previous ? updated : [...updated, next];
      },
      id,
      input.keybinding,
    );
  }

  return { saving, persist, submit };
}
