import { EnvironmentId } from "@t3tools/contracts";
import { DEFAULT_RESOLVED_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { resolveProjectScripts } from "@t3tools/shared/projectScripts";
import * as Equal from "effect/Equal";

import { useT3ProjectFileState } from "../../hooks/useT3ProjectFileScripts";
import ProjectScriptsControl from "../ProjectScriptsControl";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { type ProjectScriptTarget, useProjectScriptSettings } from "./useProjectScriptSettings";

const NO_ACTIONS: ReturnType<typeof resolveProjectScripts> = [];
// The t3.json query stays disabled without a checkout, so this id is never requested.
const NO_ENVIRONMENT = EnvironmentId.make("none");

/** The selected project's actions, stored as its override of the environment's default actions. */
export function ProjectActionsSettings() {
  const { scope, connectedEnvironments, target } = useSettingsScope();
  const members = scope.kind === "project" || scope.kind === "checkout" ? scope.members : [];
  const targets: ProjectScriptTarget[] = members.flatMap((member) => {
    const environment = connectedEnvironments.find(
      (candidate) => candidate.environmentId === member.environmentId,
    );
    return environment?.serverConfig
      ? [
          {
            environmentId: member.environmentId,
            settings: environment.serverConfig.settings,
            project: member,
          },
        ]
      : [];
  });
  const representative =
    targets.find(
      (candidate) =>
        candidate.environmentId === target?.environmentId &&
        candidate.project.id === target?.projectId,
    ) ?? targets[0];
  const scripts = representative
    ? resolveProjectScripts(representative.settings, representative.project)
    : NO_ACTIONS;
  const mixed = targets.some(
    (candidate) =>
      !Equal.equals(resolveProjectScripts(candidate.settings, candidate.project), scripts),
  );
  const keybindings =
    connectedEnvironments.find(
      (environment) => environment.environmentId === representative?.environmentId,
    )?.serverConfig?.keybindings ?? DEFAULT_RESOLVED_KEYBINDINGS;
  const { saving, persist, submit } = useProjectScriptSettings(targets);
  const representativeMember = members.find(
    (member) =>
      member.environmentId === representative?.environmentId &&
      member.id === representative?.project.id,
  );
  const t3File = useT3ProjectFileState(
    representativeMember?.environmentId ?? NO_ENVIRONMENT,
    representativeMember?.workspaceRoot ?? null,
  );

  return (
    <SettingsSection id="project-actions" title="Actions">
      <ProjectScriptsControl
        displayMode="list"
        disabled={saving || targets.length === 0}
        scripts={mixed ? NO_ACTIONS : scripts}
        fileScripts={t3File.scripts}
        keybindings={keybindings}
        onRunScript={() => undefined}
        onAddScript={(input) => submit(null, input)}
        onUpdateScript={(scriptId, input) => submit(scriptId, input)}
        onDeleteScript={(scriptId) =>
          persist((current) => current.filter((script) => script.id !== scriptId))
        }
        listHeader={(controls) => (
          <SettingsRow
            serverScoped
            settingKeys={["defaultProjectScripts"]}
            mixed={mixed}
            title="Actions"
            description="Commands that run in this project's checkout or its worktree, with optional shortcuts. Unchanged projects use the environment's default actions."
            onResetOverride={() => void persist(() => null)}
            control={controls}
          />
        )}
      />
      {mixed ? (
        <SettingsRow
          title="Different actions across checkouts"
          description="Narrow the selection above to one checkout to edit its list. Adding an action here adds it to every selected checkout."
        />
      ) : null}
      {t3File.status === "invalid" ? (
        <SettingsRow
          title="t3.json is invalid"
          description="This checkout has a t3.json that fails to parse, so the scripts and settings it declares are ignored. Check its JSON syntax and values."
          className="[&_h3]:text-warning"
        />
      ) : null}
    </SettingsSection>
  );
}
