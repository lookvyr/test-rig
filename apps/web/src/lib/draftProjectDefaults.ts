import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ScopedProjectRef,
  type ResolvedServerSettings,
} from "@t3tools/contracts";
import { isModelSelectionProviderEnabled } from "@t3tools/shared/serverSettings";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { readProject } from "../state/entities";
import { type DraftId, useComposerDraftStore } from "../composerDraftStore";
import { hasExplicitComposerModelSelection } from "./chatThreadActions";
import { readT3ProjectFile } from "./t3ProjectFileDefaults";

export type DraftProjectDefaults = ResolvedServerSettings & {
  /** The resolved project model, used only when there is no configured or recent model. */
  readonly seedFallbackModelSelection?: ModelSelection | null;
};

/**
 * Resolve the destination environment and project before configuring a draft.
 * `defaultModelSelection` is only a model someone chose in Settings (environment default or a
 * stored project override); a model older clients saved on the project itself stays a fallback
 * so it cannot pin new threads over "Automatic".
 */
export async function resolveDraftProjectDefaults(
  projectRef: ScopedProjectRef,
): Promise<DraftProjectDefaults> {
  const project = readProject(projectRef);
  const config = appAtomRegistry.get(environmentServerConfigsAtom).get(projectRef.environmentId);
  const settings = config?.settings ?? DEFAULT_SERVER_SETTINGS;
  const resolved = resolveProjectSettings(settings, projectRef.projectId, project);
  const projectFile =
    project && resolved.settings.defaultThreadEnvMode === null
      ? await readT3ProjectFile(projectRef.environmentId, project.workspaceRoot)
      : null;
  const defaults = resolveProjectSettings(
    settings,
    projectRef.projectId,
    project,
    projectFile,
  ).settings;
  const chosen =
    settings.projectSettingsOverrides[projectRef.projectId]?.defaultModelSelection ??
    settings.defaultModelSelection;
  return {
    ...defaults,
    defaultModelSelection:
      chosen && isModelSelectionProviderEnabled(settings, chosen) ? chosen : null,
    seedFallbackModelSelection: defaults.defaultModelSelection,
  };
}

/** Retarget the same composer session, retaining its content and deliberate choices. */
export function retargetDraftProject(input: {
  draftId: DraftId;
  projectRef: ScopedProjectRef;
  logicalProjectKey: string;
  defaults: DraftProjectDefaults;
  scratch: boolean;
}) {
  const store = useComposerDraftStore.getState();
  const currentDraft = store.getComposerDraft(input.draftId);
  const envMode = input.scratch ? "local" : input.defaults.defaultThreadEnvMode;
  store.setLogicalProjectDraftThreadId(input.logicalProjectKey, input.projectRef, input.draftId, {
    branch: null,
    worktreePath: null,
    envMode,
    startFromOrigin: envMode === "worktree" && input.defaults.newWorktreesStartFromOrigin,
    runtimeMode: input.defaults.defaultRuntimeMode,
  });
  if (!hasExplicitComposerModelSelection(currentDraft)) {
    store.applyStickyState(
      input.draftId,
      input.defaults.defaultModelSelection,
      input.defaults.seedFallbackModelSelection,
    );
  }
}
